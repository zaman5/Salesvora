import { z } from "zod";
import { createRouter, adminQuery, authedQuery, callerQuery } from "./middleware";
import { listCompanyScope, resolveCompanyScope } from "./lib/authz";
import {
  findLeadListsByCompany, findLeadListById, createLeadList, updateLeadList, deleteLeadList,
  findLeadsByList, findLeadById,
  createLead, createLeadsBatch, updateLead, deleteLead, searchLeads,
  assignListToCaller, getAssignedListsForCaller,
} from "./queries/leads";

export const leadRouter = createRouter({
  // ─── Lead Lists ───
  listLists: adminQuery.query(async ({ ctx }) => {
    const scope = listCompanyScope(ctx.user);
    if (scope === null) return [];
    return findLeadListsByCompany(scope);
  }),

  getList: adminQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return findLeadListById(input.id);
    }),

  createList: adminQuery
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      customFieldSchema: z.array(z.object({
        name: z.string(),
        type: z.string(),
        required: z.boolean().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const companyId = ctx.user.companyId;
      if (!companyId) throw new Error("No company");
      const id = await createLeadList({
        ...input,
        companyId,
        createdBy: ctx.user.id,
      });
      return { id, success: true };
    }),

  updateList: adminQuery
    .input(z.object({
      id: z.number(),
      data: z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["active", "inactive", "archived"]).optional(),
        customFieldSchema: z.array(z.object({
          name: z.string(),
          type: z.string(),
          required: z.boolean().optional(),
        })).optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      await updateLeadList(input.id, input.data);
      return { success: true };
    }),

  deleteList: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteLeadList(input.id);
      return { success: true };
    }),

  // ─── Leads ───
  list: authedQuery
    .input(z.object({
      leadListId: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ input }) => {
      if (input.page && input.limit) {
        return findLeadsByList(input.leadListId, input.page, input.limit);
      }
      return findLeadsByList(input.leadListId);
    }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return findLeadById(input.id);
    }),

  create: authedQuery
    .input(z.object({
      leadListId: z.number(),
      companyName: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      phone: z.string(),
      phone2: z.string().optional(),
      email: z.string().optional(),
      designation: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
      zipCode: z.string().optional(),
      website: z.string().optional(),
      customFields: z.record(z.string(), z.any()).optional(),
      notes: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      assignedTo: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const list = await findLeadListById(input.leadListId);
      if (!list) throw new Error("Lead list not found");
      const id = await createLead({
        ...input,
        companyId: list.companyId,
      });
      return { id, success: true };
    }),

  createBatch: authedQuery
    .input(z.object({
      leadListId: z.number(),
      leads: z.array(z.object({
        companyName: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string(),
        phone2: z.string().optional(),
        email: z.string().optional(),
        designation: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        country: z.string().optional(),
        zipCode: z.string().optional(),
        website: z.string().optional(),
        customFields: z.record(z.string(), z.any()).optional(),
        notes: z.string().optional(),
        assignedTo: z.number().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const list = await findLeadListById(input.leadListId);
      if (!list) throw new Error("Lead list not found");
      
      const leadData = input.leads.map(l => ({
        ...l,
        leadListId: input.leadListId,
        companyId: list.companyId,
      }));
      
      const ids = await createLeadsBatch(leadData);
      return { ids, count: ids.length, success: true };
    }),

  update: authedQuery
    .input(z.object({
      id: z.number(),
      data: z.object({
        companyName: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        phone2: z.string().optional(),
        email: z.string().optional(),
        designation: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        country: z.string().optional(),
        zipCode: z.string().optional(),
        website: z.string().optional(),
        customFields: z.record(z.string(), z.any()).optional(),
        notes: z.string().optional(),
        status: z.enum(["new", "contacted", "qualified", "converted", "unqualified", "callback", "dnc"]).optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        assignedTo: z.number().optional(),
      }).partial(),
    }))
    .mutation(async ({ input }) => {
      await updateLead(input.id, input.data);
      return { success: true };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteLead(input.id);
      return { success: true };
    }),

  search: authedQuery
    .input(z.object({
      companyId: z.number().optional(),
      query: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const companyId = resolveCompanyScope(ctx.user, input.companyId);
      if (companyId == null) return [];
      return searchLeads(companyId, input.query);
    }),

  // ─── List Assignment ───
  assignList: adminQuery
    .input(z.object({
      leadListId: z.number(),
      callerId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assignListToCaller({
        ...input,
        assignedBy: ctx.user.id,
      });
      return { success: true };
    }),

  // Admin: view which lists are assigned to a specific caller
  getCallerLists: adminQuery
    .input(z.object({ callerId: z.number() }))
    .query(async ({ ctx, input }) => {
      const assignments = await getAssignedListsForCaller(input.callerId);
      if (!assignments.length) return [];
      const listIds = new Set(assignments.map((a: any) => a.leadListId));
      const scope = listCompanyScope(ctx.user);
      const allLists = scope === null ? [] : await findLeadListsByCompany(scope);
      return allLists.filter((l: any) => listIds.has(l.id));
    }),

  // Caller: get own assigned lists as full list objects (not raw assignment records)
  myLists: callerQuery.query(async ({ ctx }) => {
    const assignments = await getAssignedListsForCaller(ctx.user.id);
    if (!assignments.length) return [];
    const listIds = new Set(assignments.map((a: any) => a.leadListId));
    const scope = listCompanyScope(ctx.user);
    const allLists = scope === null ? [] : await findLeadListsByCompany(scope);
    return allLists.filter((l: any) => listIds.has(l.id));
  }),
});
