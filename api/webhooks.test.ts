import { describe, it, expect } from "vitest";
import { parseTelnyxTarget, sameNumber } from "./lib/telnyxWebhook";
import app from "./app";

describe("Telnyx Target Parsing and Phone Normalization", () => {
  it("extracts phone number and SIP user from standard numbers and SIP URIs", () => {
    expect(sameNumber("+12025550131", "2025550131")).toBe(true);
    expect(sameNumber("+1 (202) 555-0131", "2025550131")).toBe(true);

    const standard = parseTelnyxTarget("+12025550131");
    expect(standard.e164).toBe("+12025550131");

    const sipWithNumber = parseTelnyxTarget("sip:+12025550131@sip.telnyx.com");
    expect(sipWithNumber.e164).toBe("+12025550131");

    const svSipUser = parseTelnyxTarget("sip:sv_2_5_abc123@sip.telnyx.com");
    expect(svSipUser.parsedCompanyId).toBe(2);
    expect(svSipUser.parsedUserId).toBe(5);
  });
});

describe("Telnyx Webhook Route Handling", () => {
  it("accepts incoming call.initiated webhook and returns 200 OK", async () => {
    const res = await app.request("/api/webhooks/telnyx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          record_type: "event",
          event_type: "call.initiated",
          id: "test-event-" + Date.now(),
          occurred_at: new Date().toISOString(),
          payload: {
            call_control_id: "ctrl_" + Date.now(),
            connection_id: "conn_123",
            from: "+12025550133",
            to: "+12025550131",
            direction: "incoming",
            state: "parked",
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  it("handles call.answered and call.hangup callbacks properly", async () => {
    const callControlId = "ctrl_flow_" + Date.now();

    // 1. Initial Call
    await app.request("/api/webhooks/telnyx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          record_type: "event",
          event_type: "call.initiated",
          id: "evt-init-" + Date.now(),
          occurred_at: new Date().toISOString(),
          payload: {
            call_control_id: callControlId,
            from: "+12025550133",
            to: "+12025550131",
            direction: "incoming",
          },
        },
      }),
    });

    // 2. Answered
    const resAnswer = await app.request("/api/webhooks/telnyx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          record_type: "event",
          event_type: "call.answered",
          id: "evt-ans-" + Date.now(),
          occurred_at: new Date().toISOString(),
          payload: {
            call_control_id: callControlId,
          },
        },
      }),
    });
    expect(resAnswer.status).toBe(200);

    // 3. Hangup
    const resHangup = await app.request("/api/webhooks/telnyx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          record_type: "event",
          event_type: "call.hangup",
          id: "evt-hangup-" + Date.now(),
          occurred_at: new Date().toISOString(),
          payload: {
            call_control_id: callControlId,
            hangup_cause: "NORMAL_CLEARING",
            duration_secs: 45,
          },
        },
      }),
    });
    expect(resHangup.status).toBe(200);

    // 4. Recording saved
    const resRec = await app.request("/api/webhooks/telnyx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          record_type: "event",
          event_type: "call.recording.saved",
          id: "evt-rec-" + Date.now(),
          occurred_at: new Date().toISOString(),
          payload: {
            call_control_id: callControlId,
            public_recording_urls: { mp3: "https://example.com/rec.mp3" },
            duration_secs: 45,
          },
        },
      }),
    });
    expect(resRec.status).toBe(200);
  });

  it("deduplicates repeated webhooks with identical event ID", async () => {
    const eventId = "dup-event-" + Date.now();
    const payload = JSON.stringify({
      data: {
        record_type: "event",
        event_type: "call.answered",
        id: eventId,
        occurred_at: new Date().toISOString(),
        payload: {
          call_control_id: "ctrl_dup_1",
          connection_id: "conn_123",
        },
      },
    });

    const res1 = await app.request("/api/webhooks/telnyx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/api/webhooks/telnyx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.duplicate).toBe(true);
  });
});
