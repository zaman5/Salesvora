import { z } from "zod";
import { createRouter, adminQuery, superAdminQuery } from "./middleware";
import { findAllCompanies, findCompanyById, createCompany, updateCompany, deleteCompany } from "./queries/companies";
import { isSuperAdmin, assertSameCompany } from "./lib/authz";

export const companyRouter = createRouter({
  // Superadmin sees every company; a company admin only ever sees their own.
  list: adminQuery.query(async ({ ctx }) => {
    if (isSuperAdmin(ctx.user)) {
      return findAllCompanies();
    }
    if (!ctx.user.companyId) return [];
    const own = await findCompanyById(ctx.user.companyId);
    return own ? [own] : [];
  }),

  getById: adminQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      assertSameCompany(ctx.user, input.id);
      return findCompanyById(input.id);
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
      await updateCompany(input.id, input.data);
      return { success: true };
    }),

  delete: superAdminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteCompany(input.id);
      return { success: true };
    }),
});
