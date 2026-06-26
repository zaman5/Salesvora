import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, authedQuery, callerQuery } from "./middleware";
import { isSuperAdmin } from "./lib/authz";
import {
  findAllUsers, findUsersByCompany, findUserById,
  createUser, updateUser, deleteUser, findCallersByAdmin,
} from "./queries/users";

// A non-superadmin may only act on users inside their own company.
async function assertUserInScope(ctx: { user: { role: string; companyId?: number | null } }, targetId: number) {
  if (isSuperAdmin(ctx.user)) return;
  const target = await findUserById(targetId);
  if (!target || (target as { companyId?: number | null }).companyId !== ctx.user.companyId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this user." });
  }
}

export const userRouter = createRouter({
  list: adminQuery.query(async ({ ctx }) => {
    if (isSuperAdmin(ctx.user)) return findAllUsers();
    if (!ctx.user.companyId) return [];
    return findUsersByCompany(ctx.user.companyId);
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
      role: z.enum(["admin", "caller", "viewer"]),
      unionId: z.string().optional(),
      companyId: z.number().optional(),
      extension: z.string().optional(),
      dailyCallLimit: z.number().default(200).optional(),
      permissions: z.array(z.string()).optional(),
      password: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { password, ...rest } = input;
      const finalUnionId = input.unionId || `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      // Only a superadmin may place a user into an arbitrary company; everyone
      // else creates users strictly inside their own company.
      const companyId = isSuperAdmin(ctx.user)
        ? (input.companyId || ctx.user.companyId || 1)
        : (ctx.user.companyId || 1);
      const id = await createUser({
        ...rest,
        unionId: finalUnionId,
        companyId,
        createdBy: ctx.user.id,
        role: input.role,
        status: "active",
        password: password || undefined,
        sipCredentials: password ? { username: input.email, password, domain: "local" } : undefined,
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
      if (input.data.role === "superadmin" && !isSuperAdmin(ctx.user)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only a superadmin can grant the superadmin role." });
      }
      const { sipUsername, sipTelnyxPassword, ...rest } = input.data;
      const updateData: Record<string, unknown> = { ...rest };

      // Login password → local sipCredentials (for authentication)
      if (updateData.password) {
        updateData.sipCredentials = {
          username: (updateData.email as string) || "",
          password: updateData.password,
          domain: "local",
        };
      }

      // Per-caller Telnyx SIP credential → domain = "telnyx" so getDialerConfig
      // picks it up for independent WebRTC registration (concurrent calling).
      if (sipUsername || sipTelnyxPassword) {
        const existing = await findUserById(input.id);
        const cur = (existing as any)?.sipCredentials ?? {};
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
      await deleteUser(input.id);
      return { success: true };
    }),

  me: authedQuery.query(async ({ ctx }) => {
    return ctx.user;
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
