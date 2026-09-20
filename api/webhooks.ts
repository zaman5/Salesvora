import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import {
  verifyTelnyxSignature,
  resolveCompanyAndCallerForWebhook,
  parseTelnyxTarget,
} from "./lib/telnyxWebhook";
import { getTelnyxConfig } from "./lib/telnyxConfig";
import { createSMSLog } from "./queries/sms";
import { findLeadByPhone } from "./queries/leads";
import {
  findCallByTelnyxId,
  createCall,
  updateCall,
  createRecording,
} from "./queries/calls";
import { findAllUsers } from "./queries/users";

export const webhooksApp = new Hono<{ Bindings: HttpBindings }>();

// In-memory idempotency cache: deduplicates webhooks delivered concurrently or retried by Telnyx
const processedWebhooks = new Map<string, number>();
const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function isDuplicateWebhook(eventId: string | undefined): boolean {
  if (!eventId) return false;
  const now = Date.now();

  // Periodic cleanup
  if (processedWebhooks.size > 1000) {
    for (const [id, time] of processedWebhooks.entries()) {
      if (now - time > DEDUP_TTL_MS) {
        processedWebhooks.delete(id);
      }
    }
  }

  if (processedWebhooks.has(eventId)) {
    return true;
  }
  processedWebhooks.set(eventId, now);
  return false;
}

const TERMINAL_CALL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "no_answer",
  "busy",
]);

type TelnyxWebhookData = {
  record_type?: string;
  event_type?: string;
  id?: string;
  occurred_at?: string;
  payload?: {
    id?: string;
    call_control_id?: string;
    connection_id?: string;
    call_leg_id?: string;
    call_session_id?: string;
    client_state?: string;
    from?: string | { phone_number?: string };
    to?: string | Array<{ phone_number?: string }>;
    direction?: string;
    state?: string;
    start_time?: string;
    end_time?: string;
    duration_secs?: number;
    hangup_cause?: string;
    hangup_source?: string;
    sip_hangup_cause?: string;
    result?: string;
    text?: string;
    recording_urls?: { mp3?: string; wav?: string };
    public_recording_urls?: { mp3?: string; wav?: string };
    recording_url?: string;
    channels?: string;
  };
};

// Telnyx delivers every inbound event (SMS, Voice Call Control, etc.) to this webhook endpoint:
//   https://<your-domain>/api/webhooks/telnyx
webhooksApp.post("/telnyx", async (c) => {
  const rawBody = await c.req.text();
  let payloadWrapper: { data?: TelnyxWebhookData; meta?: Record<string, unknown> };
  try {
    payloadWrapper = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const data = payloadWrapper?.data || {};
  const eventId = data.id;
  const eventType = data.event_type || "";
  const payload = data.payload || {};
  const occurredAt = data.occurred_at ? new Date(data.occurred_at) : new Date();

  // Deduplicate retries or simultaneous webhooks from Telnyx
  if (eventId && isDuplicateWebhook(eventId)) {
    console.log(`[telnyx webhook] Ignoring duplicate webhook event ${eventId} (${eventType})`);
    return c.json({ received: true, duplicate: true });
  }

  const signature = c.req.header("telnyx-signature-ed25519");
  const timestamp = c.req.header("telnyx-timestamp");

  // ─── 1. Inbound SMS (message.received) ──────────────────────────────
  if (eventType === "message.received") {
    try {
      const resolution = await resolveCompanyAndCallerForWebhook(
        data,
        eventType,
        rawBody,
        signature,
        timestamp,
      );
      const companyId = resolution.companyId;

      if (!companyId) {
        console.warn("[telnyx webhook] No company matched inbound SMS — dropping.");
        return c.json({ received: true });
      }

      // Verify signature if public key configured for this company
      const cfg = await getTelnyxConfig(companyId);
      if (cfg?.webhookPublicKey) {
        const valid = Boolean(
          signature && timestamp && verifyTelnyxSignature(rawBody, signature, timestamp, cfg.webhookPublicKey),
        );
        if (!valid) {
          console.warn("[telnyx webhook] Signature verification failed for SMS — rejecting.");
          return c.json({ error: "Invalid signature" }, 401);
        }
      }

      const rawFrom = typeof payload.from === "string" ? payload.from : payload.from?.phone_number || "";
      const rawTo = typeof payload.to === "string" ? payload.to : payload.to?.[0]?.phone_number || "";
      const fromNumber = parseTelnyxTarget(rawFrom).e164 || rawFrom;
      const toNumber = parseTelnyxTarget(rawTo).e164 || rawTo;
      const text = payload.text || "";
      const telnyxId = payload.id;

      if (fromNumber && toNumber) {
        const lead = await findLeadByPhone(companyId, fromNumber).catch(() => null);
        await createSMSLog({
          smsCampaignId: null,
          leadId: (lead as { id?: number } | null)?.id ?? null,
          companyId,
          direction: "inbound",
          toNumber,
          fromNumber,
          message: text,
          status: "received",
          twilioSid: telnyxId,
        });
      }
    } catch (err) {
      console.error("[telnyx webhook] Error processing SMS webhook:", err);
    }
    return c.json({ received: true });
  }

  // ─── 2. Voice Call Webhooks ─────────────────────────────────────────
  const callControlId = payload.call_control_id || payload.call_leg_id || payload.call_session_id;

  if (callControlId || eventType.startsWith("call.")) {
    try {
      const resolution = await resolveCompanyAndCallerForWebhook(
        data,
        eventType,
        rawBody,
        signature,
        timestamp,
      );
      let companyId = resolution.companyId;
      let callerId = resolution.callerId;
      let existingCall = resolution.existingCall;

      // Double check existing call in DB
      if (!existingCall && callControlId) {
        existingCall = await findCallByTelnyxId(callControlId);
        if (existingCall) {
          companyId = existingCall.companyId ?? companyId;
          callerId = existingCall.callerId ?? callerId;
        }
      }

      // If company has signature key, verify if present
      if (companyId) {
        const cfg = await getTelnyxConfig(companyId);
        if (cfg?.webhookPublicKey && signature && timestamp) {
          const valid = verifyTelnyxSignature(rawBody, signature, timestamp, cfg.webhookPublicKey);
          if (!valid) {
            console.warn(`[telnyx webhook] Signature verification failed for call event ${eventType}`);
            return c.json({ error: "Invalid signature" }, 401);
          }
        }
      }

      // ── Event: call.initiated ──
      if (eventType === "call.initiated") {
        const rawFrom = typeof payload.from === "string" ? payload.from : payload.from?.phone_number || "";
        const rawTo = typeof payload.to === "string" ? payload.to : payload.to?.[0]?.phone_number || "";
        const fromNumber = parseTelnyxTarget(rawFrom).e164 || rawFrom;
        const toNumber = parseTelnyxTarget(rawTo).e164 || rawTo;
        const direction = payload.direction === "incoming" || payload.direction === "inbound" ? "inbound" : "outbound";

        if (!existingCall && companyId) {
          // Resolve default caller/admin if callerId is null
          if (!callerId) {
            const users = (await findAllUsers(companyId)) as Array<{ id: number; role?: string }>;
            const admin = users.find((u) => u.role === "admin" || u.role === "superadmin") || users[0];
            callerId = admin?.id ?? 1;
          }

          const lead = fromNumber ? await findLeadByPhone(companyId, fromNumber).catch(() => null) : null;

          await createCall({
            callSid: callControlId || `CALL_IN_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            callerId,
            adminId: undefined,
            leadId: (lead as { id?: number } | null)?.id ?? null,
            campaignId: undefined,
            companyId,
            type: direction === "inbound" ? "inbound" : "manual",
            direction,
            toNumber: toNumber || "unknown",
            fromNumber: fromNumber || undefined,
            status: "ringing",
            customFields: {
              telnyx: {
                callControlId: payload.call_control_id,
                callLegId: payload.call_leg_id,
                callSessionId: payload.call_session_id,
                connectionId: payload.connection_id,
                clientState: payload.client_state,
              },
            },
            startedAt: occurredAt,
          });
        } else if (existingCall) {
          // Update call if not in terminal state
          if (!TERMINAL_CALL_STATUSES.has(existingCall.status)) {
            await updateCall(existingCall.id, {
              status: "ringing",
              customFields: {
                ...(existingCall.customFields || {}),
                telnyx: {
                  ...(existingCall.customFields?.telnyx || {}),
                  callControlId: payload.call_control_id,
                  callLegId: payload.call_leg_id,
                  callSessionId: payload.call_session_id,
                  connectionId: payload.connection_id,
                },
              },
            });
          }
        }
      }

      // ── Event: call.answered or call.bridged ──
      else if (eventType === "call.answered" || eventType === "call.bridged") {
        if (existingCall) {
          // Never overwrite a terminal state (out-of-order callback protection)
          if (!TERMINAL_CALL_STATUSES.has(existingCall.status)) {
            await updateCall(existingCall.id, {
              status: "connected",
              answeredAt: existingCall.answeredAt || occurredAt,
              lastHeartbeatAt: new Date(),
            });
          }
        }
      }

      // ── Event: call.hangup ──
      else if (eventType === "call.hangup") {
        if (existingCall) {
          const cause = (payload.hangup_cause || payload.sip_hangup_cause || "").toUpperCase();
          const durationSecs = payload.duration_secs ?? (existingCall.answeredAt ? Math.max(0, Math.round((occurredAt.getTime() - new Date(existingCall.answeredAt).getTime()) / 1000)) : 0);

          let finalStatus = "completed";
          if (durationSecs > 0 || existingCall.status === "connected") {
            finalStatus = "completed";
          } else if (cause.includes("BUSY") || cause === "USER_BUSY") {
            finalStatus = "busy";
          } else if (cause.includes("NO_ANSWER") || cause.includes("TIMEOUT")) {
            finalStatus = "no_answer";
          } else if (cause.includes("CANCEL") || cause === "ORIGINATOR_CANCEL") {
            finalStatus = "cancelled";
          } else if (cause.includes("REJECT") || cause.includes("DECLINE") || cause.includes("FAILED")) {
            finalStatus = "failed";
          }

          await updateCall(existingCall.id, {
            status: finalStatus,
            duration: durationSecs,
            endedAt: occurredAt,
          });
        }
      }

      // ── Event: call.recording.saved ──
      else if (eventType === "call.recording.saved") {
        const recUrl =
          payload.public_recording_urls?.mp3 ||
          payload.recording_urls?.mp3 ||
          payload.public_recording_urls?.wav ||
          payload.recording_urls?.wav ||
          payload.recording_url;

        if (existingCall && recUrl) {
          const duration = payload.duration_secs || existingCall.duration || 0;
          await createRecording({
            callId: existingCall.id,
            recordingUrl: recUrl,
            duration,
            format: "mp3",
          });
          await updateCall(existingCall.id, {
            recordingUrl: recUrl,
            recordingDuration: duration,
          });
        }
      }

      // ── Event: call.machine.detection.ended ──
      else if (eventType === "call.machine.detection.ended") {
        if (existingCall) {
          const result = payload.result || "";
          await updateCall(existingCall.id, {
            customFields: {
              ...(existingCall.customFields || {}),
              machineDetection: {
                result,
                detectedAt: occurredAt.toISOString(),
              },
            },
          });
        }
      }
    } catch (err) {
      console.error(`[telnyx webhook] Error handling ${eventType}:`, err);
    }
  }

  // Telnyx expects a fast 2xx response
  return c.json({ received: true });
});

export default webhooksApp;
