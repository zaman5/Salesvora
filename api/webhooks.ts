import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { verifyTelnyxSignature, findCompanyIdByPhoneNumber } from "./lib/telnyxWebhook";
import { getTelnyxConfig } from "./lib/telnyxConfig";
import { toE164 } from "./lib/telnyx";
import { createSMSLog } from "./queries/sms";
import { findLeadByPhone } from "./queries/leads";

export const webhooksApp = new Hono<{ Bindings: HttpBindings }>();

type TelnyxWebhookPayload = {
  data?: {
    event_type?: string;
    payload?: {
      id?: string;
      text?: string;
      from?: { phone_number?: string };
      to?: Array<{ phone_number?: string }>;
    };
  };
};

// Telnyx delivers every inbound event (SMS, call control, etc.) to this one
// URL — configure it as the Messaging Profile's (and/or Call Control
// Connection's) webhook in the Telnyx portal:
//   https://<your-domain>/api/webhooks/telnyx
webhooksApp.post("/telnyx", async (c) => {
  const rawBody = await c.req.text();
  let payload: TelnyxWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const eventType = payload?.data?.event_type;

  if (eventType === "message.received") {
    const msg = payload.data?.payload || {};
    const fromNumber = toE164(msg.from?.phone_number || "");
    const toNumber = toE164(msg.to?.[0]?.phone_number || "");
    const text: string = msg.text || "";
    const telnyxId: string | undefined = msg.id;

    if (fromNumber && toNumber) {
      const companyId = await findCompanyIdByPhoneNumber(toNumber);
      if (!companyId) {
        console.warn(`[telnyx webhook] No company owns ${toNumber} — dropping inbound SMS.`);
        return c.json({ received: true });
      }

      const cfg = await getTelnyxConfig(companyId);
      if (cfg?.webhookPublicKey) {
        const signature = c.req.header("telnyx-signature-ed25519");
        const timestamp = c.req.header("telnyx-timestamp");
        const valid = Boolean(
          signature && timestamp && verifyTelnyxSignature(rawBody, signature, timestamp, cfg.webhookPublicKey),
        );
        if (!valid) {
          console.warn("[telnyx webhook] Signature verification failed — rejecting.");
          return c.json({ error: "Invalid signature" }, 401);
        }
      } else {
        console.warn(
          `[telnyx webhook] No webhookPublicKey configured for company ${companyId} — accepting unverified. ` +
          "Set it in Settings → Integration → Telnyx to enable signature verification.",
        );
      }

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
  }

  // Telnyx expects a fast 2xx regardless of what we did with the event.
  return c.json({ received: true });
});

export default webhooksApp;
