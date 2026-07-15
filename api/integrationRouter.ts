import { z } from "zod";
import { createRouter, superAdminQuery, authedQuery } from "./middleware";
import { requireCompanyScope, resolveCompanyScope } from "./lib/authz";
import { listConnections, ensureOutboundVoiceProfile, attachVoiceProfileToConnection } from "./lib/telnyx";
import { getTelnyxConfig, saveTelnyxConfig, maskTelnyxConfig } from "./lib/telnyxConfig";
import { listPhoneNumbers, addPhoneNumber, updatePhoneNumber, removePhoneNumber, togglePhoneNumber, assignPhoneNumber, numbersForCaller } from "./lib/phoneNumbers";

// A superadmin isn't tied to one company (they can operate across many), so
// requireCompanyScope alone would reject them here with no companyId at all.
// These endpoints only ever manage the superadmin's own company today, so
// fall back to it explicitly rather than leaving them locked out.
function companyScope(user: { role: string; companyId?: number | null }) {
  return requireCompanyScope(user, user.companyId ?? undefined);
}

export const integrationRouter = createRouter({
  // ─── Phone numbers (caller IDs) — superadmin-only: connecting phone
  // numbers to Telnyx/SIP and assigning them to admins/callers is a
  // platform-level action, not something individual admins configure. ───
  listPhoneNumbers: superAdminQuery.query(async ({ ctx }) => {
    const companyId = companyScope(ctx.user);
    return listPhoneNumbers(companyId);
  }),

  addPhoneNumber: superAdminQuery
    .input(z.object({ number: z.string().min(3), label: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = companyScope(ctx.user);
      return addPhoneNumber(companyId, input);
    }),

  updatePhoneNumber: superAdminQuery
    .input(z.object({ id: z.number(), label: z.string().optional(), number: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = companyScope(ctx.user);
      return updatePhoneNumber(companyId, input.id, { label: input.label, number: input.number });
    }),

  // callerId here is really "assignedTo" — any user id (admin or caller).
  assignPhoneNumber: superAdminQuery
    .input(z.object({ id: z.number(), callerId: z.number().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = companyScope(ctx.user);
      return assignPhoneNumber(companyId, input.id, input.callerId);
    }),

  removePhoneNumber: superAdminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = companyScope(ctx.user);
      return removePhoneNumber(companyId, input.id);
    }),

  togglePhoneNumber: superAdminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = companyScope(ctx.user);
      return togglePhoneNumber(companyId, input.id);
    }),

  // Caller-safe: outbound caller IDs for the dialer (no secrets, any authed user).
  getDialerConfig: authedQuery.query(async ({ ctx }) => {
    const companyId = resolveCompanyScope(ctx.user, ctx.user.companyId ?? undefined);
    const cfg = companyId ? await getTelnyxConfig(companyId) : null;
    const isSuper = ctx.user.role === "superadmin";
    const numbers = new Set<string>();

    // Build the visible from-number list.
    // Superadmin sees every number (global defaults + all phone numbers).
    // Admins and callers see ONLY the numbers assigned to them — if none are
    // assigned yet, they see unassigned pool numbers but NEVER numbers
    // assigned to someone else and NEVER the global defaults.
    if (isSuper) {
      if (cfg?.defaultCallerId) numbers.add(cfg.defaultCallerId);
      for (const n of cfg?.assignedNumbers ?? []) numbers.add(n);
    }

    if (companyId) {
      const phones = await listPhoneNumbers(companyId);
      const visible = isSuper
        ? phones.filter((p) => p.status !== "inactive" && p.number).map((p) => p.number)
        : numbersForCaller(phones, ctx.user.id);      // strict per-user filtering
      for (const n of visible) numbers.add(n);
    }

    // If a non-superadmin still has no numbers (nothing assigned, no pool)
    // fall back to the global default so they can at least make calls.
    if (!isSuper && numbers.size === 0 && cfg?.defaultCallerId) {
      numbers.add(cfg.defaultCallerId);
    }
    // Per-caller SIP credentials — each caller registers independently so
    // multiple callers can be on calls at the same time without kicking each
    // other off. If the user has their own Telnyx SIP credential stored
    // (domain !== "local"), use it; otherwise fall back to the global one.
    const userSip = (ctx.user as any)?.sipCredentials as
      { username?: string; password?: string; domain?: string } | undefined | null;
    const hasDedicatedSip =
      Boolean(userSip?.username && userSip?.password && userSip?.domain === "telnyx");

    const webrtcLogin    = hasDedicatedSip ? (userSip!.username ?? "") : (cfg?.sipUsername ?? "");
    const webrtcPassword = hasDedicatedSip ? (userSip!.password ?? "") : (cfg?.sipPassword ?? "");

    return {
      enabled: Boolean(cfg?.enabled && cfg?.apiKey && cfg?.connectionId),
      defaultCallerId: cfg?.defaultCallerId ?? "",
      fromNumbers: Array.from(numbers),
      connectionName: cfg?.connectionName ?? "",
      channelLimit: cfg?.channelLimit ?? null,
      // Per-caller WebRTC credentials — each caller registers with their own
      // SIP username so concurrent calls don't interfere.
      webrtc: {
        enabled: Boolean(cfg?.webrtcEnabled && webrtcLogin && webrtcPassword),
        login:    webrtcLogin,
        password: webrtcPassword,
        isShared: !hasDedicatedSip, // true = all callers share one credential (risky)
      },
    };
  }),

  // Current saved Telnyx config for the caller's company (API key masked).
  getTelnyx: superAdminQuery.query(async ({ ctx }) => {
    const companyId = companyScope(ctx.user);
    const cfg = await getTelnyxConfig(companyId);
    return maskTelnyxConfig(cfg);
  }),

  // Validate an API key against Telnyx and return the account's SIP connections.
  // If apiKey is omitted, the already-saved key is used.
  testTelnyx: superAdminQuery
    .input(z.object({ apiKey: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = companyScope(ctx.user);
      let apiKey = input.apiKey?.trim();
      if (!apiKey) {
        const saved = await getTelnyxConfig(companyId);
        apiKey = saved?.apiKey;
      }
      if (!apiKey) {
        return { ok: false as const, message: "Enter an API key first." };
      }
      const result = await listConnections(apiKey);
      if (!result.ok) {
        return { ok: false as const, message: result.message };
      }
      return {
        ok: true as const,
        connections: result.data.map((c) => ({
          id: c.id,
          name: c.connectionName,
          active: c.active,
          recordType: c.recordType,
          outboundVoiceProfileId: c.outboundVoiceProfileId ?? null,
        })),
      };
    }),

  // One-click fix for SIP 480 "Destination temporarily unavailable": a
  // connection with no Outbound Voice Profile cannot place outbound calls.
  // This ensures a profile exists on the account (creating "Salesvora
  // Outbound" if needed), saves its id in settings, and attaches it to the
  // configured connection plus every per-caller "Salesvora — …" credential
  // connection that's missing one.
  repairVoiceSetup: superAdminQuery.mutation(async ({ ctx }) => {
    const companyId = companyScope(ctx.user);
    const cfg = await getTelnyxConfig(companyId);
    if (!cfg?.apiKey) {
      return { ok: false as const, message: "Save your Telnyx API key first (Settings → Integration)." };
    }

    const actions: string[] = [];

    const ensured = await ensureOutboundVoiceProfile(cfg.apiKey);
    if (!ensured.ok) return { ok: false as const, message: ensured.message, actions };
    const ovpId = ensured.data;
    if (cfg.outboundVoiceProfileId !== ovpId) {
      await saveTelnyxConfig(companyId, { outboundVoiceProfileId: ovpId });
      actions.push("Saved the outbound voice profile to settings.");
    }

    const conns = await listConnections(cfg.apiKey);
    if (!conns.ok) return { ok: false as const, message: conns.message, actions };

    let repaired = 0;
    const failures: string[] = [];
    for (const conn of conns.data) {
      const isCredential = conn.recordType === "credential_connection";
      const isOurs = conn.id === cfg.connectionId || /salesvora/i.test(conn.connectionName || "");
      if (!isCredential || !isOurs || conn.outboundVoiceProfileId) continue;
      const res = await attachVoiceProfileToConnection(cfg.apiKey, conn.id, ovpId);
      if (res.ok) {
        repaired++;
        actions.push(`Attached voice profile to "${conn.connectionName}".`);
      } else {
        failures.push(`"${conn.connectionName}": ${res.message}`);
      }
    }

    const message =
      failures.length > 0
        ? `Could not fix: ${failures.join("; ")}`
        : repaired > 0
          ? `Fixed ${repaired} connection(s) that couldn't place outbound calls. Try calling again.`
          : "All Salesvora connections already have an outbound voice profile. If calls still fail with SIP 480, the from-number may not belong to your Telnyx account — check Settings → Phone Numbers.";
    return { ok: failures.length === 0, message, actions };
  }),

  // Persist the Telnyx configuration for the caller's company.
  saveTelnyx: superAdminQuery
    .input(z.object({
      apiKey: z.string().optional(), // omit to keep the existing key
      connectionId: z.string().default(""),
      connectionName: z.string().optional(),
      outboundVoiceProfileId: z.string().nullable().optional(),
      outboundVoiceProfile: z.string().optional(),
      defaultCallerId: z.string().optional(),
      webrtcEnabled: z.boolean().optional(),
      sipUsername: z.string().optional(),
      sipPassword: z.string().optional(),
      sipHost: z.string().optional(),
      ipAddress: z.string().optional(),
      port: z.number().optional(),
      channelLimit: z.number().optional(),
      destinationFormat: z.string().optional(),
      originationFormat: z.string().optional(),
      assignedNumbers: z.array(z.string()).optional(),
      webhookPublicKey: z.string().optional(),
      enabled: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const companyId = companyScope(ctx.user);
      const saved = await saveTelnyxConfig(companyId, input);
      return maskTelnyxConfig(saved);
    }),
});
