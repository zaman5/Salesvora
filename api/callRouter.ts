import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery, authedQuery, callerQuery } from "./middleware";
import { resolveCompanyScope, assertSameCompany } from "./lib/authz";
import { getTelnyxConfig } from "./lib/telnyxConfig";
import { placeCall } from "./lib/telnyx";
import {
  findCallsByCompany, findCallsByCaller, findCallById,
  findActiveCallByCaller, createCall, updateCall,
  getCallStats, findDispositions, createDisposition, seedDefaultDispositions,
  createRecording, findRecordingsByCall,
} from "./queries/calls";

// By-id access must verify the call belongs to the requester's company —
// otherwise any authenticated user could read or modify another company's
// call records (numbers, notes, recordings) by guessing ids.
async function callInScope(user: { role: string; companyId?: number | null }, id: number) {
  const call = await findCallById(id);
  if (!call) throw new TRPCError({ code: "NOT_FOUND", message: "Call not found." });
  assertSameCompany(user, (call as { companyId?: number | null }).companyId);
  return call;
}

export const callRouter = createRouter({
  // ─── Call CRUD ───
  list: callerQuery
    .input(z.object({
      companyId: z.number().optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const companyId = resolveCompanyScope(ctx.user, input.companyId);
      return findCallsByCompany(companyId ?? undefined, input.page, input.limit);
    }),

  myCalls: callerQuery
    .input(z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return findCallsByCaller(ctx.user.id, input.page, input.limit);
    }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      return callInScope(ctx.user, input.id);
    }),

  getActiveCall: callerQuery.query(async ({ ctx }) => {
    return findActiveCallByCaller(ctx.user.id);
  }),

  // ─── Initiate Call ───
  initiate: callerQuery
    .input(z.object({
      leadId: z.number().optional(),
      campaignId: z.number().optional(),
      companyId: z.number(),
      toNumber: z.string(),
      fromNumber: z.string().optional(),
      type: z.enum(["manual", "auto", "ai", "inbound"]).default("manual"),
      customFields: z.record(z.string(), z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const companyId = resolveCompanyScope(ctx.user, input.companyId) ?? input.companyId;

      // If this company has Telnyx SIP trunking configured and enabled, place a
      // real outbound call through Telnyx Call Control and use the returned
      // call_control_id as our callSid. Otherwise fall back to a local SID so
      // the app still works without a provider connected.
      let callSid = `CALL_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let providerStatus: "initiated" | "failed" = "initiated";
      let providerError: string | undefined;
      const telnyxMeta: Record<string, unknown> = {};

      const telnyx = await getTelnyxConfig(companyId);
      // Only use the REST Call Control API when WebRTC browser-calling is NOT the
      // chosen mode. (Browser calling places audio directly from the agent's
      // browser, so the server must not also try to dial via REST — and a SIP
      // trunk connection id is not valid for the Call Control API anyway.)
      const useRestDialing = Boolean(
        telnyx?.enabled && telnyx.apiKey && telnyx.connectionId && !telnyx.webrtcEnabled,
      );
      if (useRestDialing && telnyx) {
        const from = input.fromNumber || telnyx.defaultCallerId || "";
        const result = await placeCall(telnyx.apiKey, {
          connectionId: telnyx.connectionId,
          to: input.toNumber,
          from,
        });
        if (result.ok) {
          callSid = result.data.callControlId || callSid;
          telnyxMeta.telnyx = {
            provider: "telnyx",
            callControlId: result.data.callControlId,
            callLegId: result.data.callLegId,
            callSessionId: result.data.callSessionId,
            connectionId: telnyx.connectionId,
          };
        } else {
          providerStatus = "failed";
          providerError = result.message;
          telnyxMeta.telnyx = { provider: "telnyx", error: result.message };
        }
      }

      const id = await createCall({
        callSid,
        callerId: ctx.user.id,
        adminId: ctx.user.createdBy || undefined,
        leadId: input.leadId,
        campaignId: input.campaignId,
        companyId,
        type: input.type,
        toNumber: input.toNumber,
        fromNumber: input.fromNumber,
        status: providerStatus,
        customFields: { ...(input.customFields || {}), ...telnyxMeta },
        startedAt: new Date(),
      });
      return { id, callSid, success: providerStatus !== "failed", error: providerError };
    }),

  // ─── Update Call Status ───
  updateStatus: callerQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["initiated", "ringing", "connected", "completed", "failed", "no_answer", "busy", "cancelled"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await callInScope(ctx.user, input.id);
      const updateData: Record<string, unknown> = { status: input.status };
      if (input.status === "connected") {
        updateData.answeredAt = new Date();
        updateData.lastHeartbeatAt = new Date();
      }
      if (["completed", "failed", "no_answer", "busy", "cancelled"].includes(input.status)) {
        updateData.endedAt = new Date();
      }
      await updateCall(input.id, updateData);
      return { success: true };
    }),

  // ─── Heartbeat (sent periodically by the browser while a call is live) ───
  // Lets the server tell a genuinely stuck "connected" row (crashed tab, lost
  // network) apart from a call that's still actually live.
  heartbeat: callerQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await callInScope(ctx.user, input.id);
      await updateCall(input.id, { lastHeartbeatAt: new Date() });
      return { success: true };
    }),

  // ─── End Call with Disposition ───
  endCall: callerQuery
    .input(z.object({
      id: z.number(),
      dispositionId: z.number().optional(),
      duration: z.number().default(0),
      notes: z.string().optional(),
      callDescription: z.string().optional(),
      customFields: z.record(z.string(), z.any()).optional(),
      recordingUrl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await callInScope(ctx.user, input.id);
      await updateCall(input.id, {
        status: "completed",
        dispositionId: input.dispositionId,
        duration: input.duration,
        notes: input.notes,
        callDescription: input.callDescription,
        customFields: input.customFields,
        recordingUrl: input.recordingUrl,
        endedAt: new Date(),
      });
      return { success: true };
    }),

  // ─── Call Stats ───
  stats: callerQuery
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const from = input.dateFrom ? new Date(input.dateFrom) : undefined;
      const to = input.dateTo ? new Date(input.dateTo) : undefined;
      return getCallStats(ctx.user.id, from, to);
    }),

  // ─── Dispositions ───
  dispositions: authedQuery
    .input(z.object({ companyId: z.number().optional() }))
    .query(async ({ input }) => {
      return findDispositions(input.companyId);
    }),

  createDisposition: adminQuery
    .input(z.object({
      name: z.string().min(1),
      label: z.string().min(1),
      category: z.enum(["connected", "no_answer", "voicemail", "machine", "wrong_number", "not_interested", "callback", "converted", "dnc", "custom"]),
      companyId: z.number().optional(),
      color: z.string().optional(),
      order: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await createDisposition(input);
      return { id, success: true };
    }),

  seedDispositions: adminQuery.mutation(async () => {
    await seedDefaultDispositions();
    return { success: true };
  }),

  // ─── Recordings ───
  recordings: authedQuery
    .input(z.object({ callId: z.number() }))
    .query(async ({ ctx, input }) => {
      await callInScope(ctx.user, input.callId);
      return findRecordingsByCall(input.callId);
    }),

  saveRecording: callerQuery
    .input(z.object({
      callId: z.number(),
      recordingUrl: z.string(),
      duration: z.number().optional(),
      fileSize: z.number().optional(),
      format: z.string().default("mp3"),
    }))
    .mutation(async ({ ctx, input }) => {
      await callInScope(ctx.user, input.callId);
      const id = await createRecording(input);
      return { id, success: true };
    }),
});
