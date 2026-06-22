import { z } from "zod";
import { createRouter, adminQuery, authedQuery } from "./middleware";
import { listCompanyScope } from "./lib/authz";
import {
  findSMSCampaignsByCompany, findSMSCampaignById, createSMSCampaign, updateSMSCampaign,
  findSMSLogsByCampaign, createSMSLog, updateSMSLogStatus, incrementSMSStats,
} from "./queries/sms";

export const smsRouter = createRouter({
  // ─── SMS Campaign CRUD ───
  list: authedQuery.query(async ({ ctx }) => {
    const scope = listCompanyScope(ctx.user);
    if (scope === null) return [];
    return findSMSCampaignsByCompany(scope);
  }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return findSMSCampaignById(input.id);
    }),

  create: adminQuery
    .input(z.object({
      name: z.string().min(1),
      leadListId: z.number(),
      messageTemplate: z.string().min(1),
      fromNumber: z.string().optional(),
      scheduledAt: z.string().optional(),
      settings: z.record(z.string(), z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const companyId = ctx.user.companyId;
      if (!companyId) throw new Error("No company");
      const id = await createSMSCampaign({
        ...input,
        companyId,
        createdBy: ctx.user.id,
        status: input.scheduledAt ? "scheduled" : "draft",
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
      });
      return { id, success: true };
    }),

  update: adminQuery
    .input(z.object({
      id: z.number(),
      data: z.object({
        name: z.string().optional(),
        messageTemplate: z.string().optional(),
        fromNumber: z.string().optional(),
        status: z.enum(["draft", "scheduled", "sending", "completed", "paused"]).optional(),
        scheduledAt: z.string().optional(),
        settings: z.record(z.string(), z.any()).optional(),
      }).partial(),
    }))
    .mutation(async ({ input }) => {
      const updateData: any = { ...input.data };
      if (input.data.scheduledAt) updateData.scheduledAt = new Date(input.data.scheduledAt);
      await updateSMSCampaign(input.id, updateData);
      return { success: true };
    }),

  // ─── Send SMS Campaign ───
  send: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await updateSMSCampaign(input.id, { status: "sending" });
      // In a real implementation, this would queue messages for sending via Twilio
      return { success: true, message: "Campaign queued for sending" };
    }),

  pause: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await updateSMSCampaign(input.id, { status: "paused" });
      return { success: true };
    }),

  resume: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await updateSMSCampaign(input.id, { status: "sending" });
      return { success: true };
    }),

  // ─── SMS Logs ───
  logs: authedQuery
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      return findSMSLogsByCampaign(input.campaignId);
    }),

  sendSingle: adminQuery
    .input(z.object({
      campaignId: z.number(),
      leadId: z.number(),
      toNumber: z.string(),
      message: z.string(),
      fromNumber: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await createSMSLog({
        smsCampaignId: input.campaignId,
        leadId: input.leadId,
        toNumber: input.toNumber,
        message: input.message,
        fromNumber: input.fromNumber,
        status: "sent",
        sentAt: new Date(),
      });
      await incrementSMSStats(input.campaignId, "sentMessages");
      return { id, success: true };
    }),

  updateLogStatus: adminQuery
    .input(z.object({
      logId: z.number(),
      status: z.enum(["pending", "sent", "delivered", "failed", "replied"]),
      twilioSid: z.string().optional(),
      errorMessage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await updateSMSLogStatus(input.logId, input.status, input.twilioSid, input.errorMessage);
      return { success: true };
    }),
});
