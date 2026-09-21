import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import {
  verifyTelnyxSignature,
  resolveCompanyAndCallerForWebhook,
  parseTelnyxTarget,
  sameNumber,
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

// ─────────────────────────────────────────────────────────────────────────────
// 3. SignalWire Webhooks
// ─────────────────────────────────────────────────────────────────────────────
import { getSignalWireConfig } from "./lib/signalwireConfig";
import { generateVoiceCXml } from "./lib/signalwire";
import { findAllCompanies } from "./queries/companies";
import { listPhoneNumbers } from "./lib/phoneNumbers";
import { findCallByCallSid } from "./queries/calls";

async function parseWebhookParams(c: any): Promise<Record<string, string>> {
  const contentType = c.req.header("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const json = await c.req.json();
      return json as Record<string, string>;
    } catch {
      return {};
    }
  }
  try {
    const body = await c.req.parseBody();
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "string") result[k] = v;
      else if (Array.isArray(v) && typeof v[0] === "string") result[k] = v[0];
    }
    return result;
  } catch {
    return {};
  }
}

async function resolveSignalWireCompany(to?: string, accountSid?: string): Promise<{ companyId: number; defaultCallerId?: string; greeting?: string; forwardSip?: string }> {
  const all = (await findAllCompanies()) as Array<{ id: number; settings?: any }>;

  // 1. Match by Project ID (AccountSid)
  if (accountSid) {
    for (const comp of all) {
      const sw = comp.settings?.signalwire;
      if (sw?.projectId && sw.projectId.toLowerCase() === accountSid.toLowerCase()) {
        return {
          companyId: comp.id,
          defaultCallerId: sw.defaultCallerId,
          greeting: sw.inboundGreeting,
          forwardSip: sw.inboundForwardSip || sw.sipCredential,
        };
      }
    }
  }

  // 2. Match by phone number in settings or pool
  if (to) {
    for (const comp of all) {
      const sw = comp.settings?.signalwire;
      if (sw?.defaultCallerId && sameNumber(sw.defaultCallerId, to)) {
        return {
          companyId: comp.id,
          defaultCallerId: sw.defaultCallerId,
          greeting: sw.inboundGreeting,
          forwardSip: sw.inboundForwardSip || sw.sipCredential,
        };
      }
      const phones = await listPhoneNumbers(comp.id);
      if (phones.some((p) => sameNumber(p.number, to))) {
        return {
          companyId: comp.id,
          defaultCallerId: sw?.defaultCallerId,
          greeting: sw?.inboundGreeting,
          forwardSip: sw?.inboundForwardSip || sw?.sipCredential,
        };
      }
    }
  }

  // 3. Fallback to first company with SignalWire configured
  for (const comp of all) {
    const sw = comp.settings?.signalwire;
    if (sw?.enabled && sw.projectId) {
      return {
        companyId: comp.id,
        defaultCallerId: sw.defaultCallerId,
        greeting: sw.inboundGreeting,
        forwardSip: sw.inboundForwardSip || sw.sipCredential,
      };
    }
  }

  return { companyId: all[0]?.id ?? 1 };
}

// Inbound Voice Webhook (cXML Script URL)
// SignalWire calls this when someone dials a SignalWire number.
webhooksApp.all("/signalwire/voice", async (c) => {
  try {
    const params = await parseWebhookParams(c);
    const from = params.From || params.Caller || "";
    const to = params.To || params.Called || "";
    const callSid = params.CallSid || "";
    const accountSid = params.AccountSid || "";

    const { companyId, greeting, forwardSip } = await resolveSignalWireCompany(to, accountSid);

    // Find lead & caller
    const lead = from ? await findLeadByPhone(companyId, from).catch(() => null) : null;
    const users = (await findAllUsers(companyId)) as Array<{ id: number; role?: string }>;
    const callerId = users.find((u) => u.role === "admin" || u.role === "superadmin")?.id ?? users[0]?.id ?? 1;

    // Deduplicate or create inbound call
    const existing = callSid ? await findCallByCallSid(callSid) : null;
    if (!existing) {
      await createCall({
        callSid: callSid || `SW_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        callerId,
        adminId: undefined,
        leadId: (lead as { id?: number } | null)?.id ?? null,
        companyId,
        type: "inbound",
        direction: "inbound",
        toNumber: to || "unknown",
        fromNumber: from || undefined,
        status: "ringing",
        customFields: {
          signalwire: {
            callSid,
            accountSid,
            provider: "signalwire",
          },
        },
        startedAt: new Date(),
      });
    }

    // Generate cXML response
    const xml = generateVoiceCXml({
      greeting: greeting || "Thanks for calling SalesVora. Connecting you now.",
      forwardSip: forwardSip || undefined,
    });

    return c.text(xml, 200, { "Content-Type": "application/xml; charset=utf-8" });
  } catch (err) {
    console.error("[signalwire webhook] Error in /voice:", err);
    const fallbackXml = generateVoiceCXml({
      greeting: "Thank you for calling. Please stay on the line.",
    });
    return c.text(fallbackXml, 200, { "Content-Type": "application/xml; charset=utf-8" });
  }
});

// Outbound Connect Webhook (cXML returned when an outbound call connects)
webhooksApp.all("/signalwire/outbound-connect", async (c) => {
  const xml = generateVoiceCXml({
    greeting: "Connecting your SalesVora call now.",
  });
  return c.text(xml, 200, { "Content-Type": "application/xml; charset=utf-8" });
});

// Call Status Changes Webhook
// Receives call completion events, duration, recording URL, and hangup causes.
webhooksApp.all("/signalwire/status", async (c) => {
  try {
    const params = await parseWebhookParams(c);
    const callSid = params.CallSid || "";
    const callStatus = (params.CallStatus || "").toLowerCase();
    const duration = parseInt(params.CallDuration || params.Duration || "0", 10);
    const recordingUrl = params.RecordingUrl || "";

    if (callSid) {
      const existing = await findCallByCallSid(callSid);
      if (existing) {
        let status = existing.status;
        if (["completed", "busy", "no-answer", "failed", "canceled"].includes(callStatus)) {
          if (callStatus === "completed") status = "completed";
          else if (callStatus === "busy") status = "busy";
          else if (callStatus === "no-answer") status = "no_answer";
          else if (callStatus === "failed") status = "failed";
          else if (callStatus === "canceled") status = "cancelled";

          await updateCall(existing.id, {
            status,
            duration: duration || existing.duration || 0,
            endedAt: new Date(),
            recordingUrl: recordingUrl || existing.recordingUrl,
          });

          if (recordingUrl) {
            await createRecording({
              callId: existing.id,
              recordingUrl,
              duration: duration || 0,
              format: "mp3",
            });
          }
        } else if (callStatus === "in-progress" || callStatus === "answered") {
          await updateCall(existing.id, {
            status: "connected",
            answeredAt: existing.answeredAt || new Date(),
            lastHeartbeatAt: new Date(),
          });
        }
      }
    }
  } catch (err) {
    console.error("[signalwire webhook] Error in /status:", err);
  }
  return c.json({ received: true });
});

// Inbound SMS Webhook
webhooksApp.all("/signalwire/sms", async (c) => {
  try {
    const params = await parseWebhookParams(c);
    const from = params.From || "";
    const to = params.To || "";
    const body = params.Body || "";
    const messageSid = params.MessageSid || params.SmsSid || "";
    const accountSid = params.AccountSid || "";

    const { companyId } = await resolveSignalWireCompany(to, accountSid);

    if (from && to && body) {
      const lead = await findLeadByPhone(companyId, from).catch(() => null);
      await createSMSLog({
        smsCampaignId: null,
        leadId: (lead as { id?: number } | null)?.id ?? null,
        companyId,
        direction: "inbound",
        toNumber: to,
        fromNumber: from,
        message: body,
        status: "received",
        twilioSid: messageSid || `SW_SMS_${Date.now()}`,
      });
    }
  } catch (err) {
    console.error("[signalwire webhook] Error in /sms:", err);
  }

  return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
    "Content-Type": "application/xml; charset=utf-8",
  });
});

export default webhooksApp;

