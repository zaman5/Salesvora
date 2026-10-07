import { z } from "zod";
import { createRouter, adminQuery, superAdminQuery } from "./middleware";
import { findAllCompanies, findCompanyById, createCompany, updateCompany, deleteCompany } from "./queries/companies";
import { isSuperAdmin, assertSameCompany } from "./lib/authz";
import { maskTelnyxConfig, type TelnyxConfig } from "./lib/telnyxConfig";

// The raw company row stores the Telnyx API key and SIP password in
// settings.telnyx. Never ship those to a browser — replace the subtree with
// the same masked shape integration.getTelnyx returns.
function sanitizeCompany<T>(company: T): T {
  if (!company || typeof company !== "object") return company;
  const settings = (company as { settings?: unknown }).settings;
  if (!settings || typeof settings !== "object") return company;
  const s = settings as Record<string, unknown>;
  if (!("telnyx" in s)) return company;
  return {
    ...(company as Record<string, unknown>),
    settings: { ...s, telnyx: maskTelnyxConfig((s.telnyx as TelnyxConfig | null) ?? null) },
  } as T;
}

export const companyRouter = createRouter({
  // Superadmin sees every company; a company admin only ever sees their own.
  list: adminQuery.query(async ({ ctx }) => {
    if (isSuperAdmin(ctx.user)) {
      const all = (await findAllCompanies()) as unknown[];
      return all.map(sanitizeCompany);
    }
    if (!ctx.user.companyId) return [];
    const own = await findCompanyById(ctx.user.companyId);
    return own ? [sanitizeCompany(own)] : [];
  }),

  getById: adminQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      assertSameCompany(ctx.user, input.id);
      const company = await findCompanyById(input.id);
      return company ? sanitizeCompany(company) : company;
    }),

  // Creating brand-new tenant companies is a platform-level (superadmin) action.
  create: superAdminQuery
    .input(z.object({
      name: z.string().min(1),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      address: z.string().optional(),
      website: z.string().optional(),
      industry: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await createCompany(input);
      return { id, success: true };
    }),

  update: adminQuery
    .input(z.object({
      id: z.number(),
      data: z.object({
        name: z.string().min(1).optional(),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        address: z.string().optional(),
        website: z.string().optional(),
        industry: z.string().optional(),
        customFields: z.record(z.string(), z.string()).optional(),
        settings: z.record(z.string(), z.any()).optional(),
        isActive: z.boolean().optional(),
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      assertSameCompany(ctx.user, input.id);
      const data: Record<string, unknown> = { ...input.data };
      if (data.settings) {
        // settings is a free-form blob, so a plain overwrite would let an admin
        // clobber the Telnyx credentials / webhook public key (or inject their
        // own) through this generic route. Telephony config is owned
        // exclusively by the integration router — carry the stored subtrees
        // over verbatim and drop whatever the client sent for them.
        const existing = await findCompanyById(input.id);
        const existingSettings = ((existing as { settings?: unknown } | null)?.settings ?? {}) as Record<string, unknown>;
        const protectedKeys = ["telnyx", "signalwire", "activeTelephonyProvider", "phoneNumbers"];
        const rest = { ...(data.settings as Record<string, unknown>) };
        for (const key of protectedKeys) {
          delete rest[key];
          if (key in existingSettings) rest[key] = existingSettings[key];
        }
        data.settings = rest;
      }
      await updateCompany(input.id, data);
      return { success: true };
    }),

  delete: superAdminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteCompany(input.id);
      return { success: true };
    }),
});
