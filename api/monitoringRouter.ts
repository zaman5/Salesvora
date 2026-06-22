import { z } from "zod";
import { createRouter, adminQuery } from "./middleware";
import { requireCompanyScope } from "./lib/authz";
import {
  createMonitorSession, findActiveMonitorSessions,
  endMonitorSession, getActiveCallsForMonitoring, getCallerActiveCall,
  getCallerDayReport,
} from "./queries/monitoring";

export const monitoringRouter = createRouter({
  // ─── Start Monitoring a Caller's Call ───
  startListening: adminQuery
    .input(z.object({
      callerId: z.number(),
      callId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const monitorChannel = `monitor_${ctx.user.id}_${input.callerId}_${Date.now()}`;
      const id = await createMonitorSession({
        adminId: ctx.user.id,
        callerId: input.callerId,
        callId: input.callId,
        monitorChannel,
        status: "listening",
      });
      return { id, monitorChannel, success: true };
    }),

  // ─── Stop Monitoring ───
  stopListening: adminQuery
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ input }) => {
      await endMonitorSession(input.sessionId);
      return { success: true };
    }),

  // ─── Get Active Monitoring Sessions ───
  mySessions: adminQuery.query(async ({ ctx }) => {
    return findActiveMonitorSessions(ctx.user.id);
  }),

  // ─── Get Active Calls for Monitoring ───
  activeCalls: adminQuery
    .input(z.object({ companyId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user, input.companyId);
      return getActiveCallsForMonitoring(companyId);
    }),

  // ─── Caller Day Report (date-wise full-day performance) ───
  callerDayReport: adminQuery
    .input(z.object({
      callerId: z.number(),
      date: z.string(), // YYYY-MM-DD
    }))
    .query(async ({ input }) => {
      return getCallerDayReport(input.callerId, input.date);
    }),

  // ─── Get Caller's Active Call ───
  callerActiveCall: adminQuery
    .input(z.object({ callerId: z.number() }))
    .query(async ({ input }) => {
      return getCallerActiveCall(input.callerId);
    }),

  // ─── Barge In (Force Join Call) ───
  bargeIn: adminQuery
    .input(z.object({
      callerId: z.number(),
      callId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const monitorChannel = `barge_${ctx.user.id}_${input.callerId}_${Date.now()}`;
      const id = await createMonitorSession({
        adminId: ctx.user.id,
        callerId: input.callerId,
        callId: input.callId,
        monitorChannel,
        status: "listening",
      });
      return { id, monitorChannel, success: true, mode: "barge" };
    }),

  // ─── Whisper (Private Message to Caller) ───
  whisper: adminQuery
    .input(z.object({
      callerId: z.number(),
      callId: z.number(),
      message: z.string(),
    }))
    .mutation(async ({ input }) => {
      // In a real implementation, this would send a WebSocket message to the caller
      return { success: true, message: input.message, mode: "whisper" };
    }),
});
