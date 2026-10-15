import { z } from "zod";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, superAdminQuery, authedQuery, callerQuery } from "./middleware";
import { isSuperAdmin, requireCompanyScope } from "./lib/authz";
import { getTelnyxConfig, saveTelnyxConfig } from "./lib/telnyxConfig";
import { createCredentialConnection, ensureOutboundVoiceProfile, toE164 } from "./lib/telnyx";
import {
  findAllUsers, findUsersCreatedBy, findUserById,
  createUser, updateUser, deleteUser, findCallersByAdmin, hashPassword,
} from "./queries/users";

// A non-superadmin may only act on users inside their own company AND that
// they personally created — one admin's team stays invisible/untouchable to
// another admin. Acting on your own account is always allowed.
async function assertUserInScope(ctx: { user: { id: number; role: string; companyId?: number | null } }, targetId: number) {
  if (isSuperAdmin(ctx.user)) return;
  if (targetId === ctx.user.id) return;
  const target = await findUserById(targetId) as { companyId?: number | null; createdBy?: number | null } | null;
  if (!target || target.companyId !== ctx.user.companyId || target.createdBy !== ctx.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this user." });
  }
}

export const userRouter = createRouter({
  list: adminQuery.query(async ({ ctx }) => {
    if (isSuperAdmin(ctx.user)) return findAllUsers();
    if (!ctx.user.companyId) return [];
    return findUsersCreatedBy(ctx.user.companyId, ctx.user.id);
  }),

  listCallers: adminQuery.query(async ({ ctx }) => {
    return findCallersByAdmin(ctx.user.id);
  }),

  getById: adminQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertUserInScope(ctx, input.id);
      return findUserById(input.id);
    }),

  create: adminQuery
    .input(z.object({
      name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
      // Superadmin accounts can never be created from the app — the role is
      // deliberately absent from this enum (seeded/platform-level only).
      role: z.enum(["admin", "caller", "viewer"]),
      unionId: z.string().optional(),
      companyId: z.number().optional(),
      extension: z.string().optional(),
      dailyCallLimit: z.number().default(200).optional(),
      permissions: z.array(z.string()).optional(),
      password: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.role === "admin" && !isSuperAdmin(ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only a superadmin can create admin accounts." });
      }
      const { password, ...rest } = input;
      const finalUnionId = input.unionId || `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      // Only a superadmin may place a user into an arbitrary company; everyone
      // else creates users strictly inside their own company.
      const companyId = isSuperAdmin(ctx.user)
        ? (input.companyId || ctx.user.companyId || 1)
        : (ctx.user.companyId || 1);
      // Passwords are stored as bcrypt digests only — the plaintext never
      // reaches the database, including the "local" sipCredentials mirror that
      // the login path falls back to.
      const passwordHash = password ? await hashPassword(password) : undefined;
      const id = await createUser({
        ...rest,
        unionId: finalUnionId,
        companyId,
        createdBy: ctx.user.id,
        role: input.role,
        status: "active",
        password: passwordHash,
        sipCredentials: passwordHash ? { username: input.email, password: passwordHash, domain: "local" } : undefined,
      });
      return { id, success: true };
    }),

  update: adminQuery
    .input(z.object({
      id: z.number(),
      data: z.object({
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        role: z.enum(["admin", "caller", "viewer", "superadmin"]).optional(),
        status: z.enum(["active", "inactive", "suspended"]).optional(),
        extension: z.string().optional(),
        dailyCallLimit: z.number().optional(),
        permissions: z.array(z.string()).optional(),
        password: z.string().optional(),
        // Per-caller Telnyx SIP credentials for concurrent WebRTC calling
        sipUsername: z.string().optional(),
        sipTelnyxPassword: z.string().optional(),
      }).partial(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertUserInScope(ctx, input.id);
      const target = await findUserById(input.id) as { role?: string; sipCredentials?: { username?: string; password?: string } } | null;
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      // Superadmin accounts can't be modified into a lower role by anyone but
      // themselves/another superadmin — and nobody may self-serve their way
      // into admin/superadmin. Only block on an actual escalation, not a
      // no-op resubmit of the role the user already has.
      const roleChanging = input.data.role !== undefined && input.data.role !== target.role;
      // Nobody — superadmins included — can promote an account to superadmin
      // from the app; the role stays in the enum only so a no-op resubmit of
      // an existing superadmin's profile still validates.
      if (roleChanging && input.data.role === "superadmin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Superadmin accounts cannot be created from the app." });
      }
      if (roleChanging && input.data.role === "admin" && !isSuperAdmin(ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only a superadmin can grant the admin role." });
      }
      if (target.role === "superadmin" && roleChanging && !isSuperAdmin(ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only a superadmin can change a superadmin's role." });
      }
      // A superadmin account must always be able to log in — suspending or
      // deactivating it would lock the platform operator out with no recovery
      // path from the app. Nobody can set a superadmin to anything but active.
      if (target.role === "superadmin" && input.data.status !== undefined && input.data.status !== "active") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Superadmin accounts cannot be suspended or deactivated." });
      }
      const { sipUsername, sipTelnyxPassword, ...rest } = input.data;
      const updateData: Record<string, unknown> = { ...rest };

      // Login password → bcrypt digest, mirrored into the "local"
      // sipCredentials slot that the login fallback reads. Plaintext is never
      // persisted.
      if (typeof updateData.password === "string" && updateData.password.length > 0) {
        const passwordHash = await hashPassword(updateData.password);
        updateData.password = passwordHash;
        updateData.sipCredentials = {
          username: (updateData.email as string) || "",
          password: passwordHash,
          domain: "local",
        };
      }

      // Per-caller Telnyx SIP credential → domain = "telnyx" so getDialerConfig
      // picks it up for independent WebRTC registration (concurrent calling).
      if (sipUsername || sipTelnyxPassword) {
        const cur = target.sipCredentials ?? {};
        updateData.sipCredentials = {
          username: sipUsername ?? cur.username ?? "",
          password: sipTelnyxPassword ?? cur.password ?? "",
          domain: "telnyx",
        };
      }

      await updateUser(input.id, updateData);
      return { success: true };
    }),

  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertUserInScope(ctx, input.id);
      const target = await findUserById(input.id) as { role?: string } | null;
      if (target?.role === "superadmin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Superadmin accounts cannot be deleted." });
      }
      await deleteUser(input.id);
      return { success: true };
    }),

  // Auto-provision a dedicated Telnyx Credential Connection for this caller so
  // they register their own independent WebRTC session instead of sharing one
  // SIP credential with every other agent (which is what blocks 2+ agents
  // from dialing/receiving on the same number at the same time).
  provisionTelnyxCredential: superAdminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user, ctx.user.companyId ?? undefined);
      const telnyx = await getTelnyxConfig(companyId);
      if (!telnyx?.apiKey) {
        return { success: false, error: "Configure your company's Telnyx API key in Settings first." };
      }
      const target = await findUserById(input.id);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });

      // Resolve an outbound voice profile BEFORE creating the connection — a
      // credential connection without one can't place outbound calls (every
      // attempt fails with SIP 480). Persist the resolved id so future
      // provisions and the repair tool reuse it.
      let ovpId = telnyx.outboundVoiceProfileId;
      if (!ovpId) {
        const ensured = await ensureOutboundVoiceProfile(telnyx.apiKey);
        if (ensured.ok) {
          ovpId = ensured.data;
          await saveTelnyxConfig(companyId, { outboundVoiceProfileId: ovpId });
        }
      }

      const username = `sv_${companyId}_${input.id}_${nanoid(6)}`.toLowerCase();
      const password = nanoid(20);
      const result = await createCredentialConnection(telnyx.apiKey, {
        connectionName: `Salesvora — ${(target as { name?: string }).name || "agent"} (#${input.id})`,
        username,
        password,
        outboundVoiceProfileId: ovpId,
      });
      if (!result.ok) {
        return { success: false, error: result.message };
      }
      await updateUser(input.id, {
        sipCredentials: { username: result.data.username, password: result.data.password, domain: "telnyx" },
      });
      return { success: true, username: result.data.username };
    }),

  me: authedQuery.query(async ({ ctx }) => {
    return ctx.user;
  }),

  // Presence heartbeat — every logged-in browser pings this every ~30s so
  // teammates can see who's online right now and whether they're on a call.
  // "Online" = lastSeenAt within the last ~90s (survives background-tab
  // timer throttling); anything older shows as offline / last seen.
  heartbeat: authedQuery
    .input(z.object({ activity: z.enum(["online", "on-call"]).default("online") }))
    .mutation(async ({ ctx, input }) => {
      await updateUser(ctx.user.id, {
        presence: { lastSeenAt: new Date().toISOString(), activity: input.activity },
      });
      return { success: true };
    }),

  // ─── Android app devices ───
  // The Salesvora Android app registers its Firebase token after login so the
  // server can ring it (full-screen call push) and notify it of SMS/missed calls.
  registerPushToken: authedQuery
    .input(z.object({ token: z.string().min(20).max(4096), platform: z.enum(["android"]).default("android") }))
    .mutation(async ({ ctx, input }) => {
      // A device token belongs to exactly one account: drop it from anyone else
      // first, so a shared/handed-over phone stops ringing for the old user.
      const everyone = (await findAllUsers()) as Array<{ id: number; pushTokens?: Array<{ token: string }> }>;
      for (const u of everyone) {
        if (u.id !== ctx.user.id && u.pushTokens?.some((t) => t.token === input.token)) {
          await updateUser(u.id, { pushTokens: u.pushTokens.filter((t) => t.token !== input.token) });
        }
      }
      const me = (await findUserById(ctx.user.id)) as { pushTokens?: Array<{ token: string; platform?: string; updatedAt?: string }> } | null;
      const others = (me?.pushTokens ?? []).filter((t) => t.token !== input.token);
      // Keep the five most recent devices per user.
      const pushTokens = [{ token: input.token, platform: input.platform, updatedAt: new Date().toISOString() }, ...others].slice(0, 5);
      await updateUser(ctx.user.id, { pushTokens });
      return { success: true, devices: pushTokens.length };
    }),

  unregisterPushToken: authedQuery
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const me = (await findUserById(ctx.user.id)) as { pushTokens?: Array<{ token: string }> } | null;
      await updateUser(ctx.user.id, { pushTokens: (me?.pushTokens ?? []).filter((t) => t.token !== input.token) });
      return { success: true };
    }),

  // ─── Per-user inbound call routing ───
  getCallSettings: authedQuery
    .input(z.object({ userId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const id = input?.userId ?? ctx.user.id;
      if (id !== ctx.user.id) {
        if (ctx.user.role === "caller") throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this user." });
        await assertUserInScope(ctx, id);
      }
      const u = (await findUserById(id)) as {
        callSettings?: { fallbackNumber?: string; dnd?: boolean; voicemailGreeting?: string };
        pushTokens?: Array<{ updatedAt?: string }>;
      } | null;
      if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      return {
        fallbackNumber: u.callSettings?.fallbackNumber ?? "",
        dnd: Boolean(u.callSettings?.dnd),
        voicemailGreeting: u.callSettings?.voicemailGreeting ?? "",
        androidDevices: u.pushTokens?.length ?? 0,
      };
    }),

  updateCallSettings: authedQuery
    .input(z.object({
      userId: z.number().optional(),
      fallbackNumber: z.string().max(30).optional(),
      dnd: z.boolean().optional(),
      voicemailGreeting: z.string().max(300).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = input.userId ?? ctx.user.id;
      if (id !== ctx.user.id) {
        if (ctx.user.role === "caller") throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this user." });
        await assertUserInScope(ctx, id);
      }
      const fallback = input.fallbackNumber?.trim();
      if (fallback && !/^\+?[0-9 ()-]{7,20}$/.test(fallback)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Fallback number must be a phone number, e.g. +15551234567." });
      }
      const u = (await findUserById(id)) as { callSettings?: Record<string, unknown> } | null;
      if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      const callSettings = {
        ...(u.callSettings ?? {}),
        ...(input.fallbackNumber !== undefined ? { fallbackNumber: fallback ? toE164(fallback) : "" } : {}),
        ...(input.dnd !== undefined ? { dnd: input.dnd } : {}),
        ...(input.voicemailGreeting !== undefined ? { voicemailGreeting: input.voicemailGreeting.trim() } : {}),
      };
      await updateUser(id, { callSettings });
      return { success: true };
    }),

  updateMe: authedQuery
    .input(z.object({
      name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await updateUser(ctx.user.id, input);
      return { success: true };
    }),

  // For callers to see their own profile
  myProfile: callerQuery.query(async ({ ctx }) => {
    return findUserById(ctx.user.id);
  }),
});
