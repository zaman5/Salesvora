import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

function requireRole(roles: string[]) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || !roles.includes(ctx.user.role)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

export const authedQuery = t.procedure.use(requireAuth);

// Admin + Superadmin only
export const adminQuery = authedQuery.use(requireRole(["admin", "superadmin"]));

// Superadmin only
export const superAdminQuery = authedQuery.use(requireRole(["superadmin"]));

// Any authenticated user (admin, caller, viewer)
export const anyAuthQuery = authedQuery.use(requireRole(["admin", "superadmin", "caller", "viewer"]));

// Caller + Admin
export const callerQuery = authedQuery.use(requireRole(["admin", "superadmin", "caller"]));
