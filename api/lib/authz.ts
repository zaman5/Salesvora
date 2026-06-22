import { TRPCError } from "@trpc/server";

type ScopedUser = { role: string; companyId?: number | null };

export function isSuperAdmin(user: ScopedUser): boolean {
  return user.role === "superadmin";
}

/**
 * Resolve the company a request is allowed to act on.
 *
 * - Superadmin: may target any company. Returns the requested companyId, or
 *   `null` (meaning "all companies") when none is requested.
 * - Everyone else: is hard-locked to their own company. Any client-supplied
 *   companyId is ignored — this prevents cross-tenant access by passing a
 *   different id. Returns their own companyId, or `null` if they have none.
 */
export function resolveCompanyScope(
  user: ScopedUser,
  requested?: number,
): number | null {
  if (isSuperAdmin(user)) {
    return requested ?? null;
  }
  return user.companyId ?? null;
}

/**
 * Variant for list endpoints: superadmin sees everything (`undefined` => no
 * company filter), other roles are scoped to their own company, and a user
 * with no company yields `null` (caller should return an empty list).
 */
export function listCompanyScope(
  user: ScopedUser,
): number | undefined | null {
  if (isSuperAdmin(user)) return undefined;
  return user.companyId ?? null;
}

/** Require a concrete company id, throwing a clear error otherwise. */
export function requireCompanyScope(
  user: ScopedUser,
  requested?: number,
): number {
  const companyId = resolveCompanyScope(user, requested);
  if (companyId == null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A companyId is required for this operation.",
    });
  }
  return companyId;
}

/** Throw FORBIDDEN unless the caller is a superadmin or owns the resource's company. */
export function assertSameCompany(
  user: ScopedUser,
  resourceCompanyId: number | null | undefined,
): void {
  if (isSuperAdmin(user)) return;
  if (!resourceCompanyId || resourceCompanyId !== user.companyId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this resource.",
    });
  }
}
