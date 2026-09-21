import { describe, it, expect } from "vitest";
import { generateVoiceCXml } from "./lib/signalwire";
import {
  saveSignalWireConfig,
  getSignalWireConfig,
  maskSignalWireConfig,
  setActiveTelephonyProvider,
  getActiveTelephonyProvider,
} from "./lib/signalwireConfig";
import app from "./app";

describe("SignalWire cXML Generation", () => {
  it("generates valid cXML for greeting and SIP forwarding", () => {
    const xml = generateVoiceCXml({
      greeting: "Thanks for calling SalesVora. Connecting you now.",
      forwardSip: "livekit-agent@salesvora-d164507f1250.sip.signalwire.com",
    });

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<Response>");
    expect(xml).toContain("<Say>Thanks for calling SalesVora. Connecting you now.</Say>");
    expect(xml).toContain("<Dial>");
    expect(xml).toContain("<Sip>sip:livekit-agent@salesvora-d164507f1250.sip.signalwire.com</Sip>");
    expect(xml).toContain("</Response>");
  });

  it("generates valid cXML for PSTN number forwarding", () => {
    const xml = generateVoiceCXml({
      greeting: "Connecting call",
      forwardNumber: "+15550002222",
    });

    expect(xml).toContain("<Say>Connecting call</Say>");
    expect(xml).toContain("<Dial>+15550002222</Dial>");
  });
});

describe("SignalWire Configuration & Provider Switching", () => {
  it("saves and masks SignalWire credentials properly", async () => {
    const saved = await saveSignalWireConfig(1, {
      space: "salesvora.signalwire.com",
      projectId: "6e1caf1e-238f-4ab3-b618-d164507f1250",
      apiToken: "PT_secret_token_1234567890",
      defaultCallerId: "+15550002222",
      enabled: true,
    });

    expect(saved.projectId).toBe("6e1caf1e-238f-4ab3-b618-d164507f1250");
    expect(saved.space).toBe("salesvora.signalwire.com");

    const masked = maskSignalWireConfig(saved);
    expect(masked.hasApiToken).toBe(true);
    expect((masked as any).apiToken).toBeUndefined();
    expect(masked.apiTokenPreview).toContain("…");
  });

  it("switches active telephony provider between telnyx and signalwire", async () => {
    await setActiveTelephonyProvider(1, "signalwire");
    let active = await getActiveTelephonyProvider(1);
    expect(active).toBe("signalwire");

    await setActiveTelephonyProvider(1, "telnyx");
    active = await getActiveTelephonyProvider(1);
    expect(active).toBe("telnyx");
  });
});

describe("SignalWire Webhooks", () => {
  it("handles /api/webhooks/signalwire/voice and returns cXML", async () => {
    const res = await app.request("/api/webhooks/signalwire/voice", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        From: "+15550001111",
        To: "+15550002222",
        CallSid: "SW_TEST_CALL_" + Date.now(),
        AccountSid: "6e1caf1e-238f-4ab3-b618-d164507f1250",
      }).toString(),
    });

    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Response>");
    expect(xml).toContain("<Say>");
  });

  it("handles /api/webhooks/signalwire/outbound-connect", async () => {
    const res = await app.request("/api/webhooks/signalwire/outbound-connect", {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("<Response>");
  });

  it("handles /api/webhooks/signalwire/status callbacks", async () => {
    const callSid = "SW_CALL_STAT_" + Date.now();

    // 1. Initial inbound voice call
    await app.request("/api/webhooks/signalwire/voice", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        From: "+15550001111",
        To: "+15550002222",
        CallSid: callSid,
      }).toString(),
    });

    // 2. Status callback with completion & recording
    const res = await app.request("/api/webhooks/signalwire/status", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        CallSid: callSid,
        CallStatus: "completed",
        CallDuration: "45",
        RecordingUrl: "https://recordings.signalwire.com/rec_123.mp3",
      }).toString(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  it("handles /api/webhooks/signalwire/sms inbound message", async () => {
    const res = await app.request("/api/webhooks/signalwire/sms", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        From: "+15550001111",
        To: "+15550002222",
        Body: "Hello from client via SignalWire!",
        MessageSid: "SW_MSG_" + Date.now(),
      }).toString(),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<Response></Response>");
  });
});
