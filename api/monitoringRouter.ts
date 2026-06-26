import { z } from "zod";
import { createRouter, adminQuery } from "./middleware";
import { requireCompanyScope } from "./lib/authz";
import { getTelnyxConfig } from "./lib/telnyxConfig";
import { hangupTelnyxCall } from "./lib/telnyx";
import { findCallById, updateCall } from "./queries/calls";
import {
  createMonitorSession, findActiveMonitorSessions,
  endMonitorSession, getActiveCallsForMonitoring, getCallerActiveCall,
  getCallerDayReport,
} from "./queries/monitoring";

export const monitoringRouter = createRouter({
  // ─── Start Monitoring a Caller's Call (listen-only) ───
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

  // ─── Caller Day Report ───
  callerDayReport: adminQuery
    .input(z.object({
      callerId: z.number(),
      date: z.string(),
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

  // ─── Barge In (Admin joins call — both sides hear admin) ───
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

  // ─── Whisper (Private message to caller only) ───
  whisper: adminQuery
    .input(z.object({
      callerId: z.number(),
      callId: z.number(),
      message: z.string(),
    }))
    .mutation(async ({ input }) => {
      // WebSocket push to caller's browser would go here
      return { success: true, message: input.message, mode: "whisper" };
    }),

  // ─── Force-End a Caller's Active Call ───
  endCallerCall: adminQuery
    .input(z.object({
      callId: z.number(),
      callerId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const companyId = requireCompanyScope(ctx.user);
      let telnyxHungUp = false;

      try {
        // Retrieve the call record to get the Telnyx callControlId
        const call = await findCallById(input.callId);
        const callSid = (call as any)?.callSid as string | undefined;

        // Only attempt Telnyx hangup if this was a real REST-controlled call
        if (callSid && !callSid.startsWith("CALL_")) {
          const cfg = companyId ? await getTelnyxConfig(companyId) : null;
          if (cfg?.apiKey) {
            const result = await hangupTelnyxCall(cfg.apiKey, callSid);
            telnyxHungUp = result.ok;
          }
        }
      } catch { /* noop — always update DB below */ }

      // Mark the call as completed in DB regardless
      await updateCall(input.callId, {
        status: "cancelled",
        endedAt: new Date(),
      });

      return { success: true, telnyxHungUp };
    }),
});