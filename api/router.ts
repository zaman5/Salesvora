import { authRouter } from "./auth-router";
import { companyRouter } from "./companyRouter";
import { userRouter } from "./userRouter";
import { leadRouter } from "./leadRouter";
import { campaignRouter } from "./campaignRouter";
import { callRouter } from "./callRouter";
import { monitoringRouter } from "./monitoringRouter";
import { reportRouter } from "./reportRouter";
import { aiAgentRouter } from "./aiAgentRouter";
import { smsRouter } from "./smsRouter";
import { integrationRouter } from "./integrationRouter";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  company: companyRouter,
  user: userRouter,
  lead: leadRouter,
  campaign: campaignRouter,
  calls: callRouter,
  monitoring: monitoringRouter,
  report: reportRouter,
  aiAgent: aiAgentRouter,
  sms: smsRouter,
  integration: integrationRouter,
});

export type AppRouter = typeof appRouter;
