import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery } from "./middleware";
import { requireCompanyScope, assertSameCompany } from "./lib/authz";
import { findCampaignById } from "./queries/campaigns";
import {
  getDashboardStats, getCallVolumeByDate, getDispositionBreakdown,
  getAgentPerformance, getCampaignReport,
} from "./queries/reports";

export const reportRouter = createRouter({
  // ─── Dashboard Stats ───
  dashboard: adminQuery
    .input(z.object({
      companyId: z.number(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user, input.companyId);
      const from = input.dateFrom ? new Date(input.dateFrom) : undefined;
      const to = input.dateTo ? new Date(input.dateTo) : undefined;
      return getDashboardStats(companyId, from, to);
    }),

  // ─── Call Volume Chart ───
  callVolume: adminQuery
    .input(z.object({
      companyId: z.number(),
      days: z.number().default(7),
    }))
    .query(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user, input.companyId);
      return getCallVolumeByDate(companyId, input.days);
    }),

  // ─── Disposition Breakdown ───
  dispositionBreakdown: adminQuery
    .input(z.object({
      companyId: z.number(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const from = input.dateFrom ? new Date(input.dateFrom) : undefined;
      const to = input.dateTo ? new Date(input.dateTo) : undefined;
      const companyId = requireCompanyScope(ctx.user, input.companyId);
      return getDispositionBreakdown(companyId, from, to);
    }),

  // ─── Agent Performance ───
  agentPerformance: adminQuery
    .input(z.object({
      companyId: z.number(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const from = input.dateFrom ? new Date(input.dateFrom) : undefined;
      const to = input.dateTo ? new Date(input.dateTo) : undefined;
      const companyId = requireCompanyScope(ctx.user, input.companyId);
      return getAgentPerformance(companyId, from, to);
    }),

  // ─── Campaign Report ───
  campaignReport: adminQuery
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ ctx, input }) => {
      // The report is keyed by campaign id, not companyId — load the campaign
      // and confirm it belongs to the caller's company before reporting on it.
      const campaign = await findCampaignById(input.campaignId);
      if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found." });
      assertSameCompany(ctx.user, (campaign as { companyId?: number | null }).companyId);
      return getCampaignReport(input.campaignId);
    }),

  // ─── Export Data ───
  exportCalls: adminQuery
    .input(z.object({
      companyId: z.number(),
      format: z.enum(["csv", "json"]).default("csv"),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      campaignId: z.number().optional(),
      callerId: z.number().optional(),
      status: z.string().optional(),
      dispositionId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user, input.companyId);
      // Returns filter params for frontend to generate export
      return {
        success: true,
        filters: { ...input, companyId },
        generatedAt: new Date().toISOString(),
      };
    }),
});
