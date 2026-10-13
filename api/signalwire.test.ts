import { describe, it, expect, vi, afterEach } from "vitest";
import { generateVoiceCXml, generateInboundSwml, routeSignalWireNumbersToSwml } from "./lib/signalwire";
import {
  saveSignalWireConfig,
  getSignalWireConfig,
  maskSignalWireConfig,
  setActiveTelephonyProvider,
  getActiveTelephonyProvider,
} from "./lib/signalwireConfig";
import app from "./app";
import { findAllUsers } from "./queries/users";

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

describe("SignalWire inbound SWML", () => {
  it("rings every destination in parallel and falls back to voicemail", () => {
    const swml = generateInboundSwml({
      greeting: "Thanks for calling SalesVora.",
      destinations: ["/private/jane", "/private/jane", "+15550002222"],
      eventUrl: "https://salesvora.online/api/webhooks/signalwire/swml-event",
    }) as any;

    const main = swml.sections.main;
    expect(main[0]).toEqual({ answer: {} });
    expect(main[1].play.url).toBe("say:Thanks for calling SalesVora.");
    const connect = main[2].connect;
    expect(connect.parallel).toEqual([{ to: "/private/jane" }, { to: "+15550002222" }]);
    const failed = JSON.stringify(connect.result.case.failed);
    expect(failed).toContain('"record"');
    expect(failed).toContain('"event":"voicemail"');
  });

  it("goes straight to voicemail when there is nobody to ring", () => {
    const swml = generateInboundSwml({ destinations: [] }) as any;
    const steps = JSON.stringify(swml.sections.main);
    expect(steps).not.toContain("connect");
    expect(steps).toContain("record");
  });
});

describe("SignalWire number routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("switches only the requested numbers to the SWML script", async () => {
    const puts: Array<{ url: string; body: any }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        puts.push({ url, body: JSON.parse(String(init.body)) });
        return new Response("{}");
      }
      return new Response(JSON.stringify({
        data: [
          { id: "pn-1", number: "+12082489823", call_handler: "laml_webhooks" },
          { id: "pn-2", number: "+15550009999", call_handler: "relay_sip_endpoint" },
        ],
        links: {},
      }));
    }));

    const res = await routeSignalWireNumbersToSwml("x.signalwire.com", "proj", "tok", ["(208) 248-9823", "+15551230000"], "https://salesvora.online/api/webhooks/signalwire/voice");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.updated).toEqual(["+12082489823"]);
    expect(res.data.notFound).toEqual(["+15551230000"]);
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toContain("/api/relay/rest/phone_numbers/pn-1");
    expect(puts[0].body).toEqual({ call_handler: "relay_script", call_relay_script_url: "https://salesvora.online/api/webhooks/signalwire/voice" });
  });
});

describe("SignalWire Configuration & Provider Switching", () => {
  it("saves and masks SignalWire credentials properly", async () => {
    const saved = await saveSignalWireConfig(1, {
      space: "salesvora.signalwire.com",
      projectId: "6e1caf1e-238f-4ab3-b618-d164507f1250",
      apiToken: "swapi_WpyYnZd5I7RcRQbHgtuHDiKtzN1GIBog5ncl",
      defaultCallerId: "+12082489823",
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers a SWML fetch with SWML that rings the browser subscriber", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/addresses")) {
        return new Response(JSON.stringify({ data: [{ name: "agent", channels: { audio: "/private/agent?channel=audio" } }] }));
      }
      // No subscriber matches, so the call should route to voicemail rather than LiveKit
      return new Response(JSON.stringify({ data: [], links: {} }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.request("/api/webhooks/signalwire/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        call: {
          call_id: "swml-call-" + Date.now(),
          from: "+15550001111",
          to: "+15550002222",
          project_id: "6e1caf1e-238f-4ab3-b618-d164507f1250",
        },
        vars: {},
        params: {},
      }),
    });

    expect(res.status).toBe(200);
    const swml = (await res.json()) as any;
    expect(swml.version).toBe("1.0.0");
    expect(swml.sections.main[0]).toEqual({ answer: {} });
    // Never forwards to the outbound SIP credential (the LiveKit agent)
    expect(JSON.stringify(swml)).not.toContain("livekit-agent");
  });

  it("rings the address an agent's browser dialer reported", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [], links: {} }))));
    const users = (await findAllUsers(1)) as Array<{ id: number }>;
    expect(users.length).toBeGreaterThan(0);
    await saveSignalWireConfig(1, {
      agentAddresses: { [String(users[0].id)]: { address: "/private/reported-agent", at: new Date().toISOString() } },
    });

    const res = await app.request("/api/webhooks/signalwire/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        call: { call_id: "swml-rep-" + Date.now(), from: "+15550001111", to: "+15550002222", project_id: "6e1caf1e-238f-4ab3-b618-d164507f1250" },
      }),
    });
    const swml = (await res.json()) as any;
    const connect = swml.sections.main.find((s: any) => s.connect)?.connect;
    expect(connect.parallel).toContainEqual({ to: "/private/reported-agent" });
  });

  it("records SWML events against the inbound call", async () => {
    const res = await app.request("/api/webhooks/signalwire/swml-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "no_answer", call_id: "unknown-call" }),
    });
    expect(res.status).toBe(200);
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
