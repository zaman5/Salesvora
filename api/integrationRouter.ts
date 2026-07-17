import { z } from "zod";
import { createRouter, superAdminQuery, authedQuery } from "./middleware";
import { requireCompanyScope, resolveCompanyScope } from "./lib/authz";
import { nanoid } from "nanoid";
import {
  listConnections, ensureOutboundVoiceProfile, attachVoiceProfileToConnection,
  listMessagingProfiles, createMessagingProfile, updateMessagingProfileWebhook,
  listAccountPhoneNumbers, setPhoneNumberConnection, setPhoneNumberMessagingProfile,
  listCredentialConnections, createCredentialConnection,
} from "./lib/telnyx";
import { findAllUsers, updateUser } from "./queries/users";
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
  //   Calls: strict per-person routing — an assigned number's voice
  //          connection points at its owner's dedicated credential
  //          connection (provisioned automatically if missing), and
  //          unassigned numbers route to the superadmin's connection only.
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

      // ── Strict routing policy ─────────────────────────────────────────
      //   assigned number   → rings ONLY the assigned person
      //   unassigned number → rings ONLY the superadmin
      // Each person needs their own Telnyx credential connection for that;
      // anyone missing one (including the superadmin) gets it provisioned
      // here automatically.

      // Resolve each user's dedicated credential connection. The SIP
      // username stored on the user is authoritative; the legacy
      // "Salesvora — <name> (#<id>)" connection-name pattern is a fallback.
      const creds = await listCredentialConnections(cfg.apiKey);
      const credByUsername = new Map<string, string>();
      if (creds.ok) for (const c of creds.data) if (c.userName) credByUsername.set(c.userName, c.id);

      const allUsers = (await findAllUsers()) as Array<{
        id: number; name?: string; role?: string; companyId?: number | null;
        sipCredentials?: { username?: string; password?: string; domain?: string };
      }>;
      const companyUsers = allUsers.filter((u) => u.companyId == companyId || u.role === "superadmin");
      const userConn = new Map<number, string>();
      for (const u of companyUsers) {
        const un = u.sipCredentials?.domain === "telnyx" ? u.sipCredentials.username : undefined;
        if (un && credByUsername.has(un)) userConn.set(u.id, credByUsername.get(un)!);
      }
      const conns = await listConnections(cfg.apiKey);
      if (conns.ok) {
        for (const c of conns.data) {
          const m = /^Salesvora — .*\(#(\d+)\)$/.exec(c.connectionName || "");
          if (m && !userConn.has(Number(m[1]))) userConn.set(Number(m[1]), c.id);
        }
      }

      // Create a dedicated credential connection for a user and store the
      // SIP credential on their account (they pick it up on next refresh).
      const provisionFor = async (userId: number): Promise<string | null> => {
        const owner = companyUsers.find((u) => u.id === userId);
        const username = `sv_${companyId}_${userId}_${nanoid(6)}`.toLowerCase();
        const password = nanoid(20);
        const created = await createCredentialConnection(cfg.apiKey, {
          connectionName: `Salesvora — ${owner?.name || "agent"} (#${userId})`,
          username,
          password,
          outboundVoiceProfileId: cfg.outboundVoiceProfileId,
        });
        if (!created.ok) {
          failures.push(`Could not create a calling credential for ${owner?.name || `user #${userId}`}: ${created.message}`);
          return null;
        }
        await updateUser(userId, { sipCredentials: { username, password, domain: "telnyx" } });
        userConn.set(userId, created.data.connectionId);
        actions.push(`Created a dedicated calling credential for ${owner?.name || `user #${userId}`} — they must refresh the app once.`);
        return created.data.connectionId;
      };

      const superUser = companyUsers.find((u) => u.role === "superadmin");

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

        // Route the number's voice to its owner (assigned person, or the
        // superadmin for unassigned numbers), provisioning a credential if
        // the owner doesn't have one yet.
        const ownerId = assignedTo.get(knownMatch) ?? superUser?.id;
        if (!ownerId) {
          failures.push(`${num.phoneNumber} (calls): no assigned user and no superadmin account found.`);
          continue;
        }
        const wantConn = userConn.get(ownerId) ?? (await provisionFor(ownerId));
        const ownerName = companyUsers.find((u) => u.id === ownerId)?.name || `user #${ownerId}`;
        const routeNote = assignedTo.get(knownMatch) ? ownerName : `the superadmin (${ownerName}) — number is unassigned`;
        if (wantConn && num.connectionId !== wantConn) {
          const res = await setPhoneNumberConnection(cfg.apiKey, num.id, wantConn);
          if (res.ok) actions.push(`${num.phoneNumber}: inbound calls now ring ${routeNote}.`);
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
