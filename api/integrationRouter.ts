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
    const numbers = new Set<string>();
    if (cfg?.defaultCallerId) numbers.add(cfg.defaultCallerId);
    for (const n of cfg?.assignedNumbers ?? []) numbers.add(n);
    // Include numbers from Settings → Phone Numbers. Callers only see numbers
    // assigned to them (plus unassigned ones); admins/superadmins see all.
    if (companyId) {
      const phones = await listPhoneNumbers(companyId);
      const visible =
        ctx.user.role === "caller"
          ? numbersForCaller(phones, ctx.user.id)
          : phones.filter((p) => p.status !== "inactive" && p.number).map((p) => p.number);
      for (const n of visible) numbers.add(n);
    }
    return {
      enabled: Boolean(cfg?.enabled && cfg?.apiKey && cfg?.connectionId),
      defaultCallerId: cfg?.defaultCallerId ?? "",
      fromNumbers: Array.from(numbers),
      connectionName: cfg?.connectionName ?? "",
      // Browser calling (WebRTC). The browser SIP client needs these to register.
      webrtc: {
        enabled: Boolean(cfg?.webrtcEnabled && cfg?.sipUsername && cfg?.sipPassword),
        login: cfg?.sipUsername ?? "",
        password: cfg?.sipPassword ?? "",
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
