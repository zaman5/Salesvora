import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, authedQuery, callerQuery, superAdminQuery } from "./middleware";
import { listCompanyScope, assertSameCompany } from "./lib/authz";
import { getTelnyxConfig } from "./lib/telnyxConfig";
import { sendSMS, toE164 } from "./lib/telnyx";
import { listPhoneNumbers } from "./lib/phoneNumbers";
import { sameNumber } from "./lib/telnyxWebhook";
import { listContacts, setContactName } from "./lib/contacts";

/**
 * The numbers whose conversations this user may read, or null when
 * unrestricted (only for accounts with no company scope at all).
 *
 * Strict per-account separation, matching the call-routing policy:
 *   assigned number   → its owner (and ONLY its owner) sees the chats
 *   unassigned number → ONLY the superadmin sees the chats
 * One admin's client conversations never appear in another account's inbox;
 * the superadmin oversees everything via sms.allRecords instead of reading
 * other people's chats here.
 */
async function assignedNumbersOf(user: { id: number; role: string; companyId?: number | null }): Promise<string[] | null> {
  if (!user.companyId) return null;
  const phones = await listPhoneNumbers(user.companyId);
  const active = phones.filter((p) => p.status !== "inactive" && p.number);
  if (user.role === "superadmin") {
    return active.filter((p) => !p.assignedTo || p.assignedTo === user.id).map((p) => p.number);
  }
  return active.filter((p) => p.assignedTo === user.id).map((p) => p.number);
}

/** The company-side number of a log row (our number, not the client's). */
function ownNumberOf(log: { direction?: string; toNumber?: string; fromNumber?: string }): string | undefined {
  return log.direction === "inbound" ? log.toNumber : log.fromNumber;
}

// Every by-id endpoint must verify the campaign belongs to the requester's
// company — otherwise any authenticated user could read or modify another
// company's SMS campaigns and logs by guessing ids.
async function smsCampaignInScope(user: { role: string; companyId?: number | null }, id: number) {
  const campaign = await findSMSCampaignById(id);
  if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "SMS campaign not found." });
  assertSameCompany(user, (campaign as { companyId?: number | null }).companyId);
  return campaign;
}
import {
  findSMSCampaignsByCompany, findSMSCampaignById, createSMSCampaign, updateSMSCampaign,
  findSMSLogsByCampaign, createSMSLog, updateSMSLogStatus, incrementSMSStats,
  findSMSLogsByCompany, findSMSConversation, markConversationRead,
} from "./queries/sms";

export const smsRouter = createRouter({
  // ─── SMS Campaign CRUD ───
  list: authedQuery.query(async ({ ctx }) => {
    const scope = listCompanyScope(ctx.user);
    if (scope === null) return [];
    return findSMSCampaignsByCompany(scope);
  }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      return smsCampaignInScope(ctx.user, input.id);
    }),

  create: callerQuery
    .input(z.object({
      name: z.string().min(1),
      leadListId: z.number(),
      messageTemplate: z.string().min(1),
      fromNumber: z.string().optional(),
      scheduledAt: z.string().optional(),
      settings: z.record(z.string(), z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const companyId = (ctx.user as any).companyId;
      if (!companyId) throw new Error("No company");
      const id = await createSMSCampaign({
        ...input,
        companyId,
        createdBy: ctx.user.id,
        status: input.scheduledAt ? "scheduled" : "draft",
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
      });
      return { id, success: true };
    }),

  update: adminQuery
    .input(z.object({
      id: z.number(),
      data: z.object({
        name: z.string().optional(),
        messageTemplate: z.string().optional(),
        fromNumber: z.string().optional(),
        status: z.enum(["draft", "scheduled", "sending", "completed", "paused"]).optional(),
        scheduledAt: z.string().optional(),
        settings: z.record(z.string(), z.any()).optional(),
      }).partial(),
    }))
    .mutation(async ({ ctx, input }) => {
      await smsCampaignInScope(ctx.user, input.id);
      const updateData: any = { ...input.data };
      if (input.data.scheduledAt) updateData.scheduledAt = new Date(input.data.scheduledAt);
      await updateSMSCampaign(input.id, updateData);
      return { success: true };
    }),

  // ─── Send / Pause / Resume Campaign ───
  send: callerQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await smsCampaignInScope(ctx.user, input.id);
      await updateSMSCampaign(input.id, { status: "sending" });
      return { success: true, message: "Campaign queued for sending" };
    }),

  pause: callerQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await smsCampaignInScope(ctx.user, input.id);
      await updateSMSCampaign(input.id, { status: "paused" });
      return { success: true };
    }),

  resume: callerQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await smsCampaignInScope(ctx.user, input.id);
      await updateSMSCampaign(input.id, { status: "sending" });
      return { success: true };
    }),

  // ─── Send a single SMS directly (no campaign required) ───
  sendDirect: callerQuery
    .input(z.object({
      toNumber: z.string().min(3),
      message:  z.string().min(1),
      fromNumber: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const companyId = (ctx.user as any).companyId;
      let success = true;
      let error: string | undefined;
      let providerMsgId: string | undefined;

      // Normalize up front so both the Telnyx send AND the stored log use
      // the same E.164 form — logging the raw input fragmented one client
      // into several inbox conversations ("3022403311" vs "+13022403311").
      const to = toE164(input.toNumber);
      const fromRaw = input.fromNumber || "";

      // Attempt real SMS delivery via Telnyx if configured
      try {
        const cfg = companyId ? await getTelnyxConfig(companyId) : null;
        if (cfg?.apiKey && cfg?.enabled) {
          const from = fromRaw || cfg.defaultCallerId || "";
          if (from) {
            const result = await sendSMS(cfg.apiKey, {
              from: toE164(from),
              to,
              text: input.message,
            });
            if (result.ok) {
              providerMsgId = result.data.id;
            } else {
              success = false;
              error = result.message;
            }
          }
        }
      } catch (err) {
        error = err instanceof Error ? err.message : "Failed to send SMS";
        success = false;
      }

      // Best-effort log — don't bubble errors if DB is unavailable
      try {
        await createSMSLog({
          smsCampaignId: null,
          leadId: null,
          companyId,
          direction: "outbound",
          toNumber: to,
          message:  input.message,
          fromNumber: fromRaw ? toE164(fromRaw) : fromRaw,
          status: success ? "sent" : "failed",
          twilioSid: providerMsgId,
          sentAt: new Date(),
        });
      } catch { /* noop */ }

      return { success, error };
    }),

  // ─── SMS Logs (per campaign) ───
  logs: authedQuery
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ ctx, input }) => {
      await smsCampaignInScope(ctx.user, input.campaignId);
      return findSMSLogsByCampaign(input.campaignId);
    }),

  // ─── Inbox: every message (sent + received) for the company, newest first.
  // Users with assigned numbers only see messages on their own numbers. ───
  inbox: authedQuery.query(async ({ ctx }) => {
    const companyId = (ctx.user as any).companyId;
    if (!companyId) return [];
    const logs = await findSMSLogsByCompany(companyId);
    const mine = await assignedNumbersOf(ctx.user as any);
    if (!mine) return logs;
    return (logs as any[]).filter((l) => mine.some((n) => sameNumber(n, ownNumberOf(l))));
  }),

  // ─── Full two-way thread with one phone number ───
  conversation: authedQuery
    .input(z.object({ number: z.string().min(3) }))
    .query(async ({ ctx, input }) => {
      const companyId = (ctx.user as any).companyId;
      if (!companyId) return [];
      const logs = await findSMSConversation(companyId, toE164(input.number));
      const mine = await assignedNumbersOf(ctx.user as any);
      if (!mine) return logs;
      return (logs as any[]).filter((l) => mine.some((n) => sameNumber(n, ownNumberOf(l))));
    }),

  // ─── Superadmin oversight: EVERY message in the company as a flat,
  // read-only record list. The superadmin's own inbox is scoped to their own
  // numbers like everyone else's — this is where they audit all traffic. ───
  allRecords: superAdminQuery.query(async ({ ctx }) => {
    const companyId = (ctx.user as any).companyId;
    if (!companyId) return [];
    return findSMSLogsByCompany(companyId);
  }),

  // ─── Mark a client's unread inbound messages as read (clears the badge) ───
  markConversationRead: authedQuery
    .input(z.object({ number: z.string().min(3) }))
    .mutation(async ({ ctx, input }) => {
      const companyId = (ctx.user as any).companyId;
      if (!companyId) return { success: false };
      await markConversationRead(companyId, toE164(input.number));
      return { success: true };
    }),

  // ─── SMS contact names: label a client's number with a real name ───
  contacts: authedQuery.query(async ({ ctx }) => {
    const companyId = (ctx.user as any).companyId;
    if (!companyId) return [];
    return listContacts(companyId);
  }),

  setContactName: callerQuery
    .input(z.object({ number: z.string().min(3), name: z.string().max(80) }))
    .mutation(async ({ ctx, input }) => {
      const companyId = (ctx.user as any).companyId;
      if (!companyId) throw new TRPCError({ code: "FORBIDDEN", message: "No company." });
      await setContactName(companyId, input.number, input.name);
      return { success: true };
    }),

  sendSingle: adminQuery
    .input(z.object({
      campaignId: z.number(),
      leadId: z.number(),
      toNumber: z.string(),
      message: z.string(),
      fromNumber: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const campaign = await smsCampaignInScope(ctx.user, input.campaignId);
      const id = await createSMSLog({
        smsCampaignId: input.campaignId,
        leadId: input.leadId,
        companyId: (campaign as any)?.companyId,
        direction: "outbound",
        toNumber: toE164(input.toNumber),
        message: input.message,
        fromNumber: input.fromNumber ? toE164(input.fromNumber) : input.fromNumber,
        status: "sent",
        sentAt: new Date(),
      });
      await incrementSMSStats(input.campaignId, "sentMessages");
      return { id, success: true };
    }),

  updateLogStatus: adminQuery
    .input(z.object({
      logId: z.number(),
      status: z.enum(["pending", "sent", "delivered", "failed", "replied"]),
      twilioSid: z.string().optional(),
      errorMessage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await updateSMSLogStatus(input.logId, input.status, input.twilioSid, input.errorMessage);
      return { success: true };
    }),
});