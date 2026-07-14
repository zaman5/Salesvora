import { z } from "zod";
import { createRouter, adminQuery, authedQuery, callerQuery } from "./middleware";
import { listCompanyScope } from "./lib/authz";
import { getTelnyxConfig } from "./lib/telnyxConfig";
import { sendSMS, toE164 } from "./lib/telnyx";
import {
  findSMSCampaignsByCompany, findSMSCampaignById, createSMSCampaign, updateSMSCampaign,
  findSMSLogsByCampaign, createSMSLog, updateSMSLogStatus, incrementSMSStats,
  findSMSLogsByCompany, findSMSConversation,
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
    .query(async ({ input }) => {
      return findSMSCampaignById(input.id);
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
    .mutation(async ({ input }) => {
      const updateData: any = { ...input.data };
      if (input.data.scheduledAt) updateData.scheduledAt = new Date(input.data.scheduledAt);
      await updateSMSCampaign(input.id, updateData);
      return { success: true };
    }),

  // ─── Send / Pause / Resume Campaign ───
  send: callerQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await updateSMSCampaign(input.id, { status: "sending" });
      return { success: true, message: "Campaign queued for sending" };
    }),

  pause: callerQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await updateSMSCampaign(input.id, { status: "paused" });
      return { success: true };
    }),

  resume: callerQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
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

      // Attempt real SMS delivery via Telnyx if configured
      try {
        const cfg = companyId ? await getTelnyxConfig(companyId) : null;
        if (cfg?.apiKey && cfg?.enabled) {
          const from = input.fromNumber || cfg.defaultCallerId || "";
          if (from) {
            const result = await sendSMS(cfg.apiKey, {
              from: toE164(from),
              to:   toE164(input.toNumber),
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
          toNumber: input.toNumber,
          message:  input.message,
          fromNumber: input.fromNumber,
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
    .query(async ({ input }) => {
      return findSMSLogsByCampaign(input.campaignId);
    }),

  // ─── Inbox: every message (sent + received) for the company, newest first ───
  inbox: authedQuery.query(async ({ ctx }) => {
    const companyId = (ctx.user as any).companyId;
    if (!companyId) return [];
    return findSMSLogsByCompany(companyId);
  }),

  // ─── Full two-way thread with one phone number ───
  conversation: authedQuery
    .input(z.object({ number: z.string().min(3) }))
    .query(async ({ ctx, input }) => {
      const companyId = (ctx.user as any).companyId;
      if (!companyId) return [];
      return findSMSConversation(companyId, toE164(input.number));
    }),

  sendSingle: adminQuery
    .input(z.object({
      campaignId: z.number(),
      leadId: z.number(),
      toNumber: z.string(),
      message: z.string(),
      fromNumber: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const campaign = await findSMSCampaignById(input.campaignId);
      const id = await createSMSLog({
        smsCampaignId: input.campaignId,
        leadId: input.leadId,
        companyId: (campaign as any)?.companyId,
        direction: "outbound",
        toNumber: input.toNumber,
        message: input.message,
        fromNumber: input.fromNumber,
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