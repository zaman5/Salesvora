import { z } from "zod";
import { createRouter, superAdminQuery, authedQuery } from "./middleware";
import { requireCompanyScope, resolveCompanyScope } from "./lib/authz";
import {
  listConnections, ensureOutboundVoiceProfile, attachVoiceProfileToConnection,
  listMessagingProfiles, createMessagingProfile, updateMessagingProfileWebhook,
  listAccountPhoneNumbers, setPhoneNumberConnection, setPhoneNumberMessagingProfile,
} from "./lib/telnyx";
import { getTelnyxConfig, saveTelnyxConfig, maskTelnyxConfig } from "./lib/telnyxConfig";
import { sameNumber } from "./lib/telnyxWebhook";
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

  // One-click fix for "clients' texts and calls never arrive": buying a number
  // doesn't route its inbound traffic anywhere. This repairs both directions —
  //   SMS:   ensures a "Salesvora Inbound" messaging profile whose webhook is
  //          <origin>/api/webhooks/telnyx and attaches every app-managed
  //          number to it, so client replies land in the SMS inbox.
  //   Calls: points each number's voice connection at the credential
  //          connection its assigned agent registers on (falling back to the
  //          company's shared connection), so inbound calls ring the browser.
  // The browser sends its origin because the PHP proxy on Hostinger rewrites
  // the Host header — the server can't derive the public URL from the request.
  repairInboundSetup: superAdminQuery
    .input(z.object({ origin: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = companyScope(ctx.user);
      const cfg = await getTelnyxConfig(companyId);
      if (!cfg?.apiKey) {
        return { ok: false as const, message: "Save your Telnyx API key first (Settings → Integration).", actions: [] as string[] };
      }

      const actions: string[] = [];
      const failures: string[] = [];
      const webhookUrl = `${input.origin.replace(/\/+$/, "")}/api/webhooks/telnyx`;

      // 1. Ensure a messaging profile that delivers inbound SMS to us.
      let profileId = cfg.messagingProfileId ?? null;
      const profiles = await listMessagingProfiles(cfg.apiKey);
      if (!profiles.ok) return { ok: false as const, message: profiles.message, actions };
      const existing =
        profiles.data.find((p) => p.id === profileId) ??
        profiles.data.find((p) => p.name === "Salesvora Inbound") ??
        profiles.data.find((p) => p.webhookUrl === webhookUrl);
      if (existing) {
        profileId = existing.id;
        if (existing.webhookUrl !== webhookUrl) {
          const upd = await updateMessagingProfileWebhook(cfg.apiKey, existing.id, webhookUrl);
          if (upd.ok) actions.push(`Pointed messaging profile "${existing.name}" at ${webhookUrl}.`);
          else failures.push(`Messaging profile webhook: ${upd.message}`);
        }
      } else {
        const created = await createMessagingProfile(cfg.apiKey, { name: "Salesvora Inbound", webhookUrl });
        if (!created.ok) return { ok: false as const, message: created.message, actions };
        profileId = created.data.id;
        actions.push(`Created messaging profile "Salesvora Inbound" → ${webhookUrl}.`);
      }
      if (profileId && cfg.messagingProfileId !== profileId) {
        await saveTelnyxConfig(companyId, { messagingProfileId: profileId });
      }

      // 2. Collect every number the app knows about, remembering who each
      //    pool number is assigned to so calls ring the right agent.
      const pool = await listPhoneNumbers(companyId);
      const assignedTo = new Map<string, number>();
      const known: string[] = [];
      for (const p of pool) {
        if (p.status === "inactive" || !p.number) continue;
        known.push(p.number);
        if (p.assignedTo) assignedTo.set(p.number, p.assignedTo);
      }
      if (cfg.defaultCallerId) known.push(cfg.defaultCallerId);
      for (const n of cfg.assignedNumbers ?? []) known.push(n);

      // Per-agent credential connections are named "Salesvora — <name> (#<userId>)"
      // by provisionTelnyxCredential — resolve userId → connectionId from that.
      const conns = await listConnections(cfg.apiKey);
      const userConn = new Map<number, string>();
      if (conns.ok) {
        for (const c of conns.data) {
          const m = /^Salesvora — .*\(#(\d+)\)$/.exec(c.connectionName || "");
          if (m) userConn.set(Number(m[1]), c.id);
        }
      }

      // 3. Walk the account's real numbers and fix routing on each known one.
      const accountNumbers = await listAccountPhoneNumbers(cfg.apiKey);
      if (!accountNumbers.ok) return { ok: false as const, message: accountNumbers.message, actions };

      let matched = 0;
      for (const num of accountNumbers.data) {
        const knownMatch = known.find((k) => sameNumber(k, num.phoneNumber));
        if (!knownMatch) continue;
        matched++;

        if (profileId && num.messagingProfileId !== profileId) {
          const res = await setPhoneNumberMessagingProfile(cfg.apiKey, num.id, profileId);
          if (res.ok) actions.push(`${num.phoneNumber}: inbound SMS now delivered to the app.`);
          else failures.push(`${num.phoneNumber} (SMS): ${res.message}`);
        }

        const ownerId = assignedTo.get(knownMatch);
        const wantConn = (ownerId && userConn.get(ownerId)) || cfg.connectionId || null;
        if (wantConn && num.connectionId !== wantConn) {
          const res = await setPhoneNumberConnection(cfg.apiKey, num.id, wantConn);
          if (res.ok) actions.push(`${num.phoneNumber}: inbound calls now ring ${ownerId && userConn.get(ownerId) ? `user #${ownerId}'s connection` : "the company connection"}.`);
          else failures.push(`${num.phoneNumber} (calls): ${res.message}`);
        }
      }

      const message =
        failures.length > 0
          ? `Could not fix: ${failures.join("; ")}`
          : matched === 0
            ? "No Telnyx number on the account matches the numbers saved in Settings → Phone Numbers — add your Telnyx number there first, then run this again."
            : actions.length > 0
              ? `Fixed inbound routing on ${matched} number(s). Ask a client to text/call again — SMS land in the inbox, calls ring registered agents.`
              : `All ${matched} number(s) already route inbound SMS and calls to the app. If calls still don't ring, make sure the agent's browser shows "registered" (green) in the dialer.`;
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
