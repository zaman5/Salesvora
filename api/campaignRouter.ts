import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, authedQuery, callerQuery } from "./middleware";
import {
  findCampaignsByCompany, findCampaignById, createCampaign, updateCampaign, deleteCampaign,
  addLeadsToCampaign, getCampaignLeads, getNextCampaignLead, updateCampaignLeadStatus, getCampaignProgress,
} from "./queries/campaigns";
import { findLeadsByList } from "./queries/leads";
import { listCompanyScope, assertSameCompany } from "./lib/authz";

// Every by-id endpoint must verify the campaign belongs to the requester's
// company — without this, any authenticated user could read or modify another
// company's campaigns just by guessing ids.
async function campaignInScope(user: { role: string; companyId?: number | null }, id: number) {
  const campaign = await findCampaignById(id);
  if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found." });
  assertSameCompany(user, (campaign as { companyId?: number | null }).companyId);
  return campaign;
}

export const campaignRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    const scope = listCompanyScope(ctx.user);
    if (scope === null) return [];
    return findCampaignsByCompany(scope);
  }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      return campaignInScope(ctx.user, input.id);
    }),

  create: callerQuery
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
    .mutation(async ({ ctx, input }) => {
      await campaignInScope(ctx.user, input.id);
      const updateData: any = { ...input.data };
      if (input.data.startDate) updateData.startDate = new Date(input.data.startDate);
      if (input.data.endDate) updateData.endDate = new Date(input.data.endDate);
      await updateCampaign(input.id, updateData);
      return { success: true };
    }),

  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await campaignInScope(ctx.user, input.id);
      await deleteCampaign(input.id);
      return { success: true };
    }),

  // ─── Campaign Leads ───
  addLeads: adminQuery
    .input(z.object({
      campaignId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const campaign = await campaignInScope(ctx.user, input.campaignId);

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
    .query(async ({ ctx, input }) => {
      await campaignInScope(ctx.user, input.campaignId);
      return getCampaignLeads(input.campaignId, input.status);
    }),

  getNextLead: callerQuery
    .input(z.object({
      campaignId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      await campaignInScope(ctx.user, input.campaignId);
      // Do not filter by callerId — campaign leads are created without one,
      // so passing the user ID would match nothing and return null forever.
      return getNextCampaignLead(input.campaignId);
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
    .query(async ({ ctx, input }) => {
      await campaignInScope(ctx.user, input.id);
      return getCampaignProgress(input.id);
    }),

  start: callerQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await campaignInScope(ctx.user, input.id);
      await updateCampaign(input.id, { status: "running" });
      return { success: true };
    }),

  pause: callerQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await campaignInScope(ctx.user, input.id);
      await updateCampaign(input.id, { status: "paused" });
      return { success: true };
    }),
});
