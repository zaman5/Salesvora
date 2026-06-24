import { z } from "zod";
import { createRouter, adminQuery, authedQuery, callerQuery } from "./middleware";
import {
  findCampaignsByCompany, findCampaignById, createCampaign, updateCampaign, deleteCampaign,
  addLeadsToCampaign, getCampaignLeads, getNextCampaignLead, updateCampaignLeadStatus, getCampaignProgress,
} from "./queries/campaigns";
import { findLeadsByList } from "./queries/leads";
import { listCompanyScope } from "./lib/authz";

export const campaignRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    const scope = listCompanyScope(ctx.user);
    if (scope === null) return [];
    return findCampaignsByCompany(scope);
  }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return findCampaignById(input.id);
    }),

  create: adminQuery
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      type: z.enum(["manual", "auto", "ai", "sms"]),
      leadListId: z.number(),
      assignedCallers: z.array(z.number()).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      dailyStartTime: z.string().optional(),
      dailyEndTime: z.string().optional(),
      timezone: z.string().optional(),
      callDelay: z.number().optional(),
      maxAttempts: z.number().optional(),
      settings: z.record(z.string(), z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const companyId = ctx.user.companyId;
      if (!companyId) throw new Error("No company");

      const campaignId = await createCampaign({
        ...input,
        companyId,
        createdBy: ctx.user.id,
        status: "draft",
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      });

      // Automatically link all leads from the selected list to this campaign
      // so it's immediately usable in the Auto Dialer without a separate step.
      if (campaignId && input.leadListId) {
        try {
          const listLeads = await findLeadsByList(input.leadListId);
          const leadsArray = Array.isArray(listLeads) ? listLeads : (listLeads as { items?: unknown[] })?.items ?? [];
          if (leadsArray.length > 0) {
            const campaignLeadData = leadsArray.map((lead: { id: number }, index: number) => ({
              campaignId,
              leadId: lead.id,
              sequenceOrder: index + 1,
              status: "pending" as const,
            }));
            await addLeadsToCampaign(campaignLeadData);
          }
        } catch (err) {
          // Non-fatal: campaign was created; leads can be added later
          console.error("[campaign.create] Failed to auto-add leads:", err);
        }
      }

      return { id: campaignId, success: true };
    }),

  update: adminQuery
    .input(z.object({
      id: z.number(),
      data: z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["draft", "running", "paused", "completed", "scheduled"]).optional(),
        assignedCallers: z.array(z.number()).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        dailyStartTime: z.string().optional(),
        dailyEndTime: z.string().optional(),
        timezone: z.string().optional(),
        callDelay: z.number().optional(),
        maxAttempts: z.number().optional(),
        settings: z.record(z.string(), z.any()).optional(),
      }).partial(),
    }))
    .mutation(async ({ input }) => {
      const updateData: any = { ...input.data };
      if (input.data.startDate) updateData.startDate = new Date(input.data.startDate);
      if (input.data.endDate) updateData.endDate = new Date(input.data.endDate);
      await updateCampaign(input.id, updateData);
      return { success: true };
    }),

  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteCampaign(input.id);
      return { success: true };
    }),

  // ─── Campaign Leads ───
  addLeads: adminQuery
    .input(z.object({
      campaignId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const campaign = await findCampaignById(input.campaignId);
      if (!campaign) throw new Error("Campaign not found");
      
      const leads = await findLeadsByList(campaign.leadListId);
      if (!leads || !Array.isArray(leads) || leads.length === 0) {
        return { count: 0, success: true };
      }
      
      const campaignLeadData = leads.map((lead, index) => ({
        campaignId: input.campaignId,
        leadId: lead.id,
        sequenceOrder: index + 1,
        status: "pending" as const,
      }));
      
      const ids = await addLeadsToCampaign(campaignLeadData);
      return { count: ids.length, success: true };
    }),

  getLeads: authedQuery
    .input(z.object({
      campaignId: z.number(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return getCampaignLeads(input.campaignId, input.status);
    }),

  getNextLead: callerQuery
    .input(z.object({
      campaignId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      return getNextCampaignLead(input.campaignId, ctx.user.id);
    }),

  updateLeadStatus: callerQuery
    .input(z.object({
      campaignLeadId: z.number(),
      status: z.enum(["pending", "in_progress", "completed", "failed", "skipped", "callback"]),
      callerId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      await updateCampaignLeadStatus(input.campaignLeadId, input.status, {
        callerId: input.callerId,
        completedAt: input.status === "completed" || input.status === "failed" || input.status === "skipped" ? new Date() : undefined,
      });
      return { success: true };
    }),

  progress: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getCampaignProgress(input.id);
    }),

  start: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await updateCampaign(input.id, { status: "running" });
      return { success: true };
    }),

  pause: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await updateCampaign(input.id, { status: "paused" });
      return { success: true };
    }),
});
