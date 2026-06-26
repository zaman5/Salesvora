import { z } from "zod";
import { createRouter, adminQuery, authedQuery } from "./middleware";
import { requireCompanyScope, resolveCompanyScope } from "./lib/authz";
import { listConnections } from "./lib/telnyx";
import { getTelnyxConfig, saveTelnyxConfig, maskTelnyxConfig } from "./lib/telnyxConfig";
import { listPhoneNumbers, addPhoneNumber, updatePhoneNumber, removePhoneNumber, togglePhoneNumber, assignPhoneNumber, numbersForCaller } from "./lib/phoneNumbers";

export const integrationRouter = createRouter({
  // ─── Phone numbers (caller IDs) ───
  listPhoneNumbers: adminQuery.query(async ({ ctx }) => {
    const companyId = requireCompanyScope(ctx.user);
    return listPhoneNumbers(companyId);
  }),

  addPhoneNumber: adminQuery
    .input(z.object({ number: z.string().min(3), label: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user);
      return addPhoneNumber(companyId, input);
    }),

  updatePhoneNumber: adminQuery
    .input(z.object({ id: z.number(), label: z.string().optional(), number: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user);
      return updatePhoneNumber(companyId, input.id, { label: input.label, number: input.number });
    }),

  assignPhoneNumber: adminQuery
    .input(z.object({ id: z.number(), callerId: z.number().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user);
      return assignPhoneNumber(companyId, input.id, input.callerId);
    }),

  removePhoneNumber: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user);
      return removePhoneNumber(companyId, input.id);
    }),

  togglePhoneNumber: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user);
      return togglePhoneNumber(companyId, input.id);
    }),

  // Caller-safe: outbound caller IDs for the dialer (no secrets, any authed user).
  getDialerConfig: authedQuery.query(async ({ ctx }) => {
    const companyId = resolveCompanyScope(ctx.user, ctx.user.companyId ?? undefined);
    const cfg = companyId ? await getTelnyxConfig(companyId) : null;
    const isCaller = ctx.user.role === "caller";
    const numbers = new Set<string>();

    // Build the visible from-number list.
    // Admins see every number (global defaults + all phone numbers).
    // Callers see ONLY their assigned numbers — if none are assigned yet,
    // they see unassigned pool numbers but NEVER numbers assigned to others
    // and NEVER the global admin defaults.
    if (!isCaller) {
      if (cfg?.defaultCallerId) numbers.add(cfg.defaultCallerId);
      for (const n of cfg?.assignedNumbers ?? []) numbers.add(n);
    }

    if (companyId) {
      const phones = await listPhoneNumbers(companyId);
      const visible = isCaller
        ? numbersForCaller(phones, ctx.user.id)       // strict per-caller filtering
        : phones.filter((p) => p.status !== "inactive" && p.number).map((p) => p.number);
      for (const n of visible) numbers.add(n);
    }

    // If caller still has no numbers (nothing assigned, no pool) fall back to
    // the global default so they can at least make calls.
    if (isCaller && numbers.size === 0 && cfg?.defaultCallerId) {
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
  getTelnyx: adminQuery.query(async ({ ctx }) => {
    const companyId = requireCompanyScope(ctx.user);
    const cfg = await getTelnyxConfig(companyId);
    return maskTelnyxConfig(cfg);
  }),

  // Validate an API key against Telnyx and return the account's SIP connections.
  // If apiKey is omitted, the already-saved key is used.
  testTelnyx: adminQuery
    .input(z.object({ apiKey: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user);
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

  // Persist the Telnyx configuration for the caller's company.
  saveTelnyx: adminQuery
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
      enabled: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user);
      const saved = await saveTelnyxConfig(companyId, input);
      return maskTelnyxConfig(saved);
    }),
});
