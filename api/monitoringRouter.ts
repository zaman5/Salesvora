import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery } from "./middleware";
import { requireCompanyScope, assertSameCompany, isSuperAdmin } from "./lib/authz";
import { getTelnyxConfig } from "./lib/telnyxConfig";
import { hangupTelnyxCall } from "./lib/telnyx";
import { findCallById, updateCall } from "./queries/calls";
import { findUserById } from "./queries/users";
import {
  createMonitorSession, findActiveMonitorSessions,
  endMonitorSession, getActiveCallsForMonitoring, getCallerActiveCall,
  getCallerDayReport,
} from "./queries/monitoring";

type ScopedUser = { id: number; role: string; companyId?: number | null };

// Monitoring endpoints all target another user's live activity, so the target
// caller must be verified to belong to the admin's own company — otherwise any
// admin could watch, barge into or hang up another tenant's calls by id.
async function callerInScope(user: ScopedUser, callerId: number) {
  const target = await findUserById(callerId);
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Caller not found." });
  assertSameCompany(user, (target as { companyId?: number | null }).companyId);
  return target;
}

// Same rule for the call being monitored/terminated.
async function callInScope(user: ScopedUser, callId: number) {
  const call = await findCallById(callId);
  if (!call) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
  assertSameCompany(user, (call as { companyId?: number | null }).companyId);
  return call;
}

export const monitoringRouter = createRouter({
  // ─── Start Monitoring a Caller's Call (listen-only) ───
  startListening: adminQuery
    .input(z.object({
      callerId: z.number(),
      callId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await callerInScope(ctx.user, input.callerId);
      await callInScope(ctx.user, input.callId);
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
    .mutation(async ({ ctx, input }) => {
      // Monitor sessions have no companyId; ownership is the admin who opened
      // them. Only the session's own admin (or a superadmin) may end it.
      if (!isSuperAdmin(ctx.user)) {
        const mine = (await findActiveMonitorSessions(ctx.user.id)) as Array<{ id: number }>;
        if (!mine.some((s) => s.id === input.sessionId)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this monitoring session." });
        }
      }
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
    .query(async ({ ctx, input }) => {
      await callerInScope(ctx.user, input.callerId);
      return getCallerDayReport(input.callerId, input.date);
    }),

  // ─── Get Caller's Active Call ───
  callerActiveCall: adminQuery
    .input(z.object({ callerId: z.number() }))
    .query(async ({ ctx, input }) => {
      await callerInScope(ctx.user, input.callerId);
      return getCallerActiveCall(input.callerId);
    }),

  // ─── Barge In (Admin joins call — both sides hear admin) ───
  bargeIn: adminQuery
    .input(z.object({
      callerId: z.number(),
      callId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await callerInScope(ctx.user, input.callerId);
      await callInScope(ctx.user, input.callId);
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
    .mutation(async ({ ctx, input }) => {
      await callerInScope(ctx.user, input.callerId);
      await callInScope(ctx.user, input.callId);
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
      // Terminating a live call is the most destructive action here: verify
      // BOTH the target caller and the call itself belong to this company
      // before touching Telnyx or the DB row.
      await callerInScope(ctx.user, input.callerId);
      const call = await callInScope(ctx.user, input.callId);
      // Use the call's own company for provider credentials — never a
      // client-supplied one.
      const companyId = (call as { companyId?: number | null }).companyId ?? null;
      let telnyxHungUp = false;

      try {
        // Retrieve the Telnyx callControlId from the (already scoped) call
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