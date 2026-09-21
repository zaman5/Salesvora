import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "./app";
import { appRouter } from "./router";
import {
  saveSignalWireConfig,
  getSignalWireConfig,
  maskSignalWireConfig,
  setActiveTelephonyProvider,
  getActiveTelephonyProvider,
} from "./lib/signalwireConfig";
import {
  saveTelnyxConfig,
  getTelnyxConfig,
  maskTelnyxConfig,
} from "./lib/telnyxConfig";
import {
  testSignalWireConnection,
  placeSignalWireCall,
  sendSignalWireSMS,
  issueSignalWireSubscriberToken,
  generateVoiceCXml,
} from "./lib/signalwire";

// Mock global fetch for external SignalWire & Telnyx HTTP requests
global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
  const urlStr = url.toString();

  // 1. SignalWire IncomingPhoneNumbers API
  if (urlStr.includes("/IncomingPhoneNumbers")) {
    return new Response(
      JSON.stringify({
        incoming_phone_numbers: [
          {
            sid: "PN_123456",
            phone_number: "+15550002222",
            friendly_name: "SalesVora Main Line",
            voice_url: "https://api.salesvora.com/api/webhooks/signalwire/voice",
            status_callback: "https://api.salesvora.com/api/webhooks/signalwire/status",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // 2. SignalWire Calls API (Outbound call)
  if (urlStr.includes("/Calls") && init?.method === "POST") {
    return new Response(
      JSON.stringify({
        sid: "CA_test_signalwire_12345",
        status: "queued",
        direction: "outbound-api",
        from: "+15550002222",
        to: "+15559998888",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // 3. SignalWire Messages API (SMS)
  if (urlStr.includes("/Messages") && init?.method === "POST") {
    return new Response(
      JSON.stringify({
        sid: "SM_test_signalwire_99999",
        status: "sent",
        from: "+15550002222",
        to: "+15559998888",
        body: "Test SMS Message",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // 4. SignalWire Fabric Subscriber Tokens API
  if (urlStr.includes("/subscribers/tokens") && init?.method === "POST") {
    return new Response(
      JSON.stringify({
        token: "jwt_token_signalwire_subscriber_mock_token_abc123",
        reference: "agent-jane@salesvora.com",
        expires_at: "2026-09-21T12:00:00Z",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // 5. Telnyx Connections API
  if (urlStr.includes("api.telnyx.com/v2/connections")) {
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "conn_123",
            record_type: "credential_connection",
            active: true,
            connection_name: "Salesvora Main",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // 6. Telnyx Calls API
  if (urlStr.includes("api.telnyx.com/v2/calls") && init?.method === "POST") {
    return new Response(
      JSON.stringify({
        data: {
          call_control_id: "ctrl_telnyx_mock_123",
          call_leg_id: "leg_123",
          call_session_id: "sess_123",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // 7. Telnyx Messages API
  if (urlStr.includes("api.telnyx.com/v2/messages") && init?.method === "POST") {
    return new Response(
      JSON.stringify({
        data: {
          id: "msg_telnyx_mock_123",
          to: [{ status: "sent" }],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

describe("Complete End-to-End Telephony Provider Testing", () => {
  const superAdminContext = {
    user: {
      id: 1,
      email: "admin@salesvora.com",
      role: "superadmin",
      companyId: 1,
    },
    req: new Request("http://localhost"),
  };

  const callerContext = {
    user: {
      id: 2,
      email: "agent@salesvora.com",
      role: "caller",
      companyId: 1,
      createdBy: 1,
    },
    req: new Request("http://localhost"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. SignalWire Config & Client Functions ───
  it("verifies SignalWire SDK & Client API helpers", async () => {
    // Test Connection
    const testRes = await testSignalWireConnection(
      "salesvora.signalwire.com",
      "6e1caf1e-238f-4ab3-b618-d164507f1250",
      "PT_test_token_123",
    );
    expect(testRes.ok).toBe(true);
    if (testRes.ok) {
      expect(testRes.data.phoneNumbersCount).toBe(1);
      expect(testRes.data.numbers[0].phoneNumber).toBe("+15550002222");
    }

    // Place Outbound REST Call
    const callRes = await placeSignalWireCall(
      "salesvora.signalwire.com",
      "6e1caf1e-238f-4ab3-b618-d164507f1250",
      "PT_test_token_123",
      {
        from: "+15550002222",
        to: "+15559998888",
        url: "https://api.salesvora.com/api/webhooks/signalwire/outbound-connect",
        statusCallback: "https://api.salesvora.com/api/webhooks/signalwire/status",
      },
    );
    expect(callRes.ok).toBe(true);
    if (callRes.ok) {
      expect(callRes.data.callSid).toBe("CA_test_signalwire_12345");
      expect(callRes.data.status).toBe("queued");
    }

    // Send SMS via SignalWire
    const smsRes = await sendSignalWireSMS(
      "salesvora.signalwire.com",
      "6e1caf1e-238f-4ab3-b618-d164507f1250",
      "PT_test_token_123",
      {
        from: "+15550002222",
        to: "+15559998888",
        text: "Hello from SalesVora SignalWire!",
      },
    );
    expect(smsRes.ok).toBe(true);
    if (smsRes.ok) {
      expect(smsRes.data.messageSid).toBe("SM_test_signalwire_99999");
    }

    // Issue Subscriber Token for Browser WebRTC
    const tokenRes = await issueSignalWireSubscriberToken(
      "salesvora.signalwire.com",
      "6e1caf1e-238f-4ab3-b618-d164507f1250",
      "PT_test_token_123",
      "agent-jane@salesvora.com",
    );
    expect(tokenRes.ok).toBe(true);
    if (tokenRes.ok) {
      expect(tokenRes.data.token).toContain("mock_token");
    }
  });

  // ─── 2. cXML Generation Logic ───
  it("verifies cXML script generation for greetings, SIP forwarding and IVR", () => {
    const cxml = generateVoiceCXml({
      greeting: "Thanks for calling SalesVora. Connecting you now.",
      forwardSip: "livekit-agent@salesvora-d164507f1250.sip.signalwire.com",
      record: true,
    });

    expect(cxml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(cxml).toContain("<Say>Thanks for calling SalesVora. Connecting you now.</Say>");
    expect(cxml).toContain('<Dial record="record-from-answer">');
    expect(cxml).toContain("<Sip>sip:livekit-agent@salesvora-d164507f1250.sip.signalwire.com</Sip>");
  });

  // ─── 3. TRPC Integration Endpoints (SignalWire & Telnyx) ───
  it("saves SignalWire config and verifies provider switching through TRPC router", async () => {
    const caller = appRouter.createCaller(superAdminContext as any);

    // Save SignalWire Settings
    const savedSw = await caller.integration.saveSignalWire({
      space: "salesvora.signalwire.com",
      projectId: "6e1caf1e-238f-4ab3-b618-d164507f1250",
      apiToken: "PT_secret_token_live_123",
      sipCredential: "livekit-agent@salesvora-d164507f1250.sip.signalwire.com",
      defaultCallerId: "+15550002222",
      inboundGreeting: "Welcome to SalesVora!",
      enabled: true,
      webrtcEnabled: true,
    });
    expect(savedSw.space).toBe("salesvora.signalwire.com");
    expect(savedSw.hasApiToken).toBe(true);
    expect(savedSw.enabled).toBe(true);

    // Test SignalWire Connection endpoint
    const testSwRes = await caller.integration.testSignalWire({
      space: "salesvora.signalwire.com",
      projectId: "6e1caf1e-238f-4ab3-b618-d164507f1250",
      apiToken: "swapi_WpyYnZd5I7RcRQbHgtuHDiKtzN1GIBog5ncl",
    });
    expect(testSwRes.ok).toBe(true);

    // Switch Active Provider to SignalWire
    const switchRes = await caller.integration.setActiveTelephonyProvider({ provider: "signalwire" });
    expect(switchRes.activeProvider).toBe("signalwire");

    // Query Telephony Provider Info
    const providerInfo = await caller.integration.getTelephonyProvider();
    expect(providerInfo.activeProvider).toBe("signalwire");
    expect(providerInfo.signalwire.enabled).toBe(true);
    expect(providerInfo.signalwire.hasApiToken).toBe(true);

    // Get Dialer Config when SignalWire is active
    const dialerCaller = appRouter.createCaller(callerContext as any);
    const dialerConfigSw = await dialerCaller.integration.getDialerConfig();
    expect(dialerConfigSw.provider).toBe("signalwire");
    expect(dialerConfigSw.enabled).toBe(true);
    expect(dialerConfigSw.defaultCallerId).toBe("+15550002222");
    expect(dialerConfigSw.signalwire.space).toBe("salesvora.signalwire.com");
    expect(dialerConfigSw.signalwire.enabled).toBe(true);

    // Switch back to Telnyx and test Dialer Config
    await caller.integration.setActiveTelephonyProvider({ provider: "telnyx" });
    const dialerConfigTelnyx = await dialerCaller.integration.getDialerConfig();
    expect(dialerConfigTelnyx.provider).toBe("telnyx");
  });

  // ─── 4. Call Router Outbound Call Placement with SignalWire ───
  it("places an outbound REST call via SignalWire when active provider is signalwire", async () => {
    const adminCaller = appRouter.createCaller(superAdminContext as any);
    await adminCaller.integration.saveSignalWire({
      space: "salesvora.signalwire.com",
      projectId: "6e1caf1e-238f-4ab3-b618-d164507f1250",
      apiToken: "PT_secret_token_live_123",
      enabled: true,
    });
    await adminCaller.integration.setActiveTelephonyProvider({ provider: "signalwire" });

    const agentCaller = appRouter.createCaller(callerContext as any);
    const callResult = await agentCaller.calls.initiate({
      companyId: 1,
      toNumber: "+15559998888",
      fromNumber: "+15550002222",
      type: "manual",
    });

    expect(callResult.success).toBe(true);
    expect(callResult.callSid).toBe("CA_test_signalwire_12345");
  });

  // ─── 5. SMS Router Message Dispatch with SignalWire ───
  it("sends an outbound SMS via SignalWire when active provider is signalwire", async () => {
    const adminCaller = appRouter.createCaller(superAdminContext as any);
    await adminCaller.integration.saveSignalWire({
      space: "salesvora.signalwire.com",
      projectId: "6e1caf1e-238f-4ab3-b618-d164507f1250",
      apiToken: "PT_secret_token_live_123",
      enabled: true,
    });
    await adminCaller.integration.setActiveTelephonyProvider({ provider: "signalwire" });

    const agentCaller = appRouter.createCaller(callerContext as any);
    const smsResult = await agentCaller.sms.sendDirect({
      toNumber: "+15559998888",
      fromNumber: "+15550002222",
      message: "Hello customer via SignalWire!",
    });

    expect(smsResult.success).toBe(true);
  });

  // ─── 6. Webhook Ingestion Tests ───
  it("handles incoming SignalWire voice, outbound connect, status and SMS webhooks", async () => {
    // 1. Inbound Voice Webhook
    const voiceRes = await app.request("/api/webhooks/signalwire/voice", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        From: "+15550001111",
        To: "+15550002222",
        CallSid: "CA_inbound_test_" + Date.now(),
        AccountSid: "6e1caf1e-238f-4ab3-b618-d164507f1250",
      }).toString(),
    });
    expect(voiceRes.status).toBe(200);
    const xml = await voiceRes.text();
    expect(xml).toContain("<Response>");
    expect(xml).toContain("<Say>");

    // 2. Outbound Connect Webhook
    const connectRes = await app.request("/api/webhooks/signalwire/outbound-connect", {
      method: "POST",
    });
    expect(connectRes.status).toBe(200);
    const connectXml = await connectRes.text();
    expect(connectXml).toContain("<Response>");

    // 3. Status Changes Webhook
    const statusRes = await app.request("/api/webhooks/signalwire/status", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        CallSid: "CA_inbound_test_" + Date.now(),
        CallStatus: "completed",
        CallDuration: "35",
        RecordingUrl: "https://recordings.signalwire.com/sample.mp3",
      }).toString(),
    });
    expect(statusRes.status).toBe(200);
    const statusBody = await statusRes.json();
    expect(statusBody.received).toBe(true);

    // 4. Inbound SMS Webhook
    const smsRes = await app.request("/api/webhooks/signalwire/sms", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        From: "+15550001111",
        To: "+15550002222",
        Body: "Yes, I am interested in SalesVora!",
        MessageSid: "SM_inbound_" + Date.now(),
      }).toString(),
    });
    expect(smsRes.status).toBe(200);
    const smsXml = await smsRes.text();
    expect(smsXml).toContain("<Response></Response>");
  });
});
