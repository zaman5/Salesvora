// SignalWire REST & cXML Telephony Client for SalesVora
// Supports REST outbound calling, inbound cXML generation, SMS messaging, and Fabric subscriber tokens.
import { toE164 } from "./telnyx";

export type SignalWireResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

export type SignalWirePhoneNumber = {
  id: string;
  phoneNumber: string;
  friendlyName?: string;
  voiceUrl?: string;
  statusCallback?: string;
  smsUrl?: string;
};

export type SignalWireCallResult = {
  callSid: string;
  status: string;
  direction?: string;
  from?: string;
  to?: string;
};

export type SignalWireSMSResult = {
  messageSid: string;
  status: string;
  from?: string;
  to?: string;
};

export type SignalWireSubscriberTokenResult = {
  token: string;
  reference?: string;
  expiresAt?: string;
};

function normalizeSpace(space: string): string {
  return space.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function basicAuthHeader(projectId: string, apiToken: string): string {
  const credentials = Buffer.from(`${projectId.trim()}:${apiToken.trim()}`).toString("base64");
  return `Basic ${credentials}`;
}

async function parseSignalWireError(res: Response): Promise<string> {
  let rawMsg = "";
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      rawMsg = json.message || json.error_message || json.description || "";
    } catch {
      if (text.includes("<Message>") && text.includes("</Message>")) {
        const match = text.match(/<Message>(.*?)<\/Message>/);
        if (match && match[1]) rawMsg = match[1];
      }
    }
  } catch {
    /* ignore */
  }

  if (rawMsg) {
    if (rawMsg.toLowerCase().includes("verified caller id") || rawMsg.toLowerCase().includes("trial")) {
      return `SignalWire Trial Account: Recipient number is not verified. Add the number to "Verified Caller IDs" in your SignalWire Console, or upgrade the project by adding billing balance. (${rawMsg})`;
    }
    return rawMsg;
  }

  if (res.status === 401) return "Invalid SignalWire Project ID or API Token (Unauthorized).";
  if (res.status === 403) return "Forbidden: Check account status and permissions on SignalWire.";
  if (res.status === 404) return "SignalWire resource or Space not found.";
  if (res.status === 422) return "Unprocessable entity: Please check the phone number format or verify the number in SignalWire Console.";
  return `SignalWire request failed (HTTP ${res.status}).`;
}

/**
 * Test SignalWire credentials by validating connection to the space and project.
 */
export async function testSignalWireConnection(
  space: string,
  projectId: string,
  apiToken: string,
): Promise<SignalWireResult<{ space: string; projectId: string; phoneNumbersCount: number; numbers: SignalWirePhoneNumber[] }>> {
  if (!space || !projectId || !apiToken) {
    return { ok: false, status: 400, message: "SignalWire Space, Project ID, and API Token are all required." };
  }

  const cleanSpace = normalizeSpace(space);
  const url = `https://${cleanSpace}/api/laml/2010-04-01/Accounts/${encodeURIComponent(projectId)}/IncomingPhoneNumbers.json?PageSize=50`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: basicAuthHeader(projectId, apiToken),
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      return { ok: false, status: res.status, message: await parseSignalWireError(res) };
    }

    const text = await res.text();
    let body: { incoming_phone_numbers?: Array<Record<string, unknown>> } | null = null;
    if (text && text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (!body || typeof body !== "object" || !Array.isArray(body.incoming_phone_numbers)) {
      return {
        ok: false,
        status: res.status,
        message: `Could not verify credentials: Space "${cleanSpace}" returned an invalid response. Please verify your Space URL (e.g. "your-space.signalwire.com"), Project ID, and API Token.`,
      };
    }

    const numbers: SignalWirePhoneNumber[] = body.incoming_phone_numbers.map((n) => ({
      id: String(n.sid ?? n.id ?? ""),
      phoneNumber: String(n.phone_number ?? ""),
      friendlyName: String(n.friendly_name ?? ""),
      voiceUrl: String(n.voice_url ?? ""),
      statusCallback: String(n.status_callback ?? ""),
      smsUrl: String(n.sms_url ?? ""),
    }));

    return {
      ok: true,
      data: {
        space: cleanSpace,
        projectId,
        phoneNumbersCount: numbers.length,
        numbers,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? `Could not reach SignalWire space: ${err.message}` : "Network error connecting to SignalWire.",
    };
  }
}

/**
 * List phone numbers associated with the SignalWire project.
 */
export async function listSignalWirePhoneNumbers(
  space: string,
  projectId: string,
  apiToken: string,
): Promise<SignalWireResult<SignalWirePhoneNumber[]>> {
  const test = await testSignalWireConnection(space, projectId, apiToken);
  if (!test.ok) return test;
  return { ok: true, data: test.data.numbers };
}

/**
 * Place an outbound call via SignalWire LAML REST API.
 * POST https://{space}/api/laml/2010-04-01/Accounts/{ProjectID}/Calls.json
 */
export async function placeSignalWireCall(
  space: string,
  projectId: string,
  apiToken: string,
  params: {
    from: string;
    to: string;
    url: string; // Outbound connect cXML URL
    statusCallback?: string;
  },
): Promise<SignalWireResult<SignalWireCallResult>> {
  if (!space || !projectId || !apiToken) {
    return { ok: false, status: 400, message: "SignalWire is not configured." };
  }

  const cleanSpace = normalizeSpace(space);
  const endpoint = `https://${cleanSpace}/api/laml/2010-04-01/Accounts/${encodeURIComponent(projectId)}/Calls.json`;

  const form = new URLSearchParams();
  form.append("From", toE164(params.from));
  form.append("To", toE164(params.to));
  form.append("Url", params.url);

  if (params.statusCallback) {
    form.append("StatusCallback", params.statusCallback);
    form.append("StatusCallbackMethod", "POST");
    form.append("StatusCallbackEvent", "initiated");
    form.append("StatusCallbackEvent", "ringing");
    form.append("StatusCallbackEvent", "answered");
    form.append("StatusCallbackEvent", "completed");
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(projectId, apiToken),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });

    if (!res.ok) {
      return { ok: false, status: res.status, message: await parseSignalWireError(res) };
    }

    const text = await res.text();
    let body: Record<string, unknown> = {};
    let sid = "";
    let status = "initiated";

    if (text && text.trim()) {
      try {
        body = JSON.parse(text);
        sid = String(body.sid || body.call_sid || "");
        status = String(body.status || "initiated");
      } catch {
        const sidMatch = text.match(/<Sid>(.*?)<\/Sid>/) || text.match(/<CallSid>(.*?)<\/CallSid>/);
        const statusMatch = text.match(/<Status>(.*?)<\/Status>/);
        sid = sidMatch ? sidMatch[1] : "";
        status = statusMatch ? statusMatch[1] : "initiated";
      }
    }

    if (!sid) {
      return {
        ok: false,
        status: res.status,
        message: `SignalWire did not return a valid Call SID from "${cleanSpace}". Please verify your Space URL, Project ID, API Token, and Caller ID number.`,
      };
    }

    return {
      ok: true,
      data: {
        callSid: sid,
        status,
        direction: String(body.direction || "outbound-api"),
        from: String(body.from || params.from),
        to: String(body.to || params.to),
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? `SignalWire call failed: ${err.message}` : "Network error initiating SignalWire call.",
    };
  }
}

/**
 * Send an SMS message via SignalWire REST API.
 * POST https://{space}/api/laml/2010-04-01/Accounts/{ProjectID}/Messages.json
 */
export async function sendSignalWireSMS(
  space: string,
  projectId: string,
  apiToken: string,
  params: {
    from: string;
    to: string;
    text: string;
    statusCallback?: string;
  },
): Promise<SignalWireResult<SignalWireSMSResult>> {
  if (!space || !projectId || !apiToken) {
    return { ok: false, status: 400, message: "SignalWire is not configured." };
  }

  const cleanSpace = normalizeSpace(space);
  const endpoint = `https://${cleanSpace}/api/laml/2010-04-01/Accounts/${encodeURIComponent(projectId)}/Messages.json`;

  const form = new URLSearchParams();
  form.append("From", toE164(params.from));
  form.append("To", toE164(params.to));
  form.append("Body", params.text);

  if (params.statusCallback) {
    form.append("StatusCallback", params.statusCallback);
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(projectId, apiToken),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });

    if (!res.ok) {
      return { ok: false, status: res.status, message: await parseSignalWireError(res) };
    }

    const text = await res.text();
    let body: Record<string, unknown> = {};
    let sid = "";
    let status = "sent";

    if (text && text.trim()) {
      try {
        body = JSON.parse(text);
        sid = String(body.sid || body.message_sid || "");
        status = String(body.status || "sent");
      } catch {
        const sidMatch = text.match(/<Sid>(.*?)<\/Sid>/) || text.match(/<MessageSid>(.*?)<\/MessageSid>/);
        const statusMatch = text.match(/<Status>(.*?)<\/Status>/);
        sid = sidMatch ? sidMatch[1] : "";
        status = statusMatch ? statusMatch[1] : "sent";
      }
    }

    if (!sid) {
      return {
        ok: false,
        status: res.status,
        message: `SignalWire did not return a valid Message SID from "${cleanSpace}". Please verify your Space URL, Project ID, API Token, and phone number.`,
      };
    }

    return {
      ok: true,
      data: {
        messageSid: sid,
        status,
        from: String(body.from || params.from),
        to: String(body.to || params.to),
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? `SignalWire SMS failed: ${err.message}` : "Network error sending SMS via SignalWire.",
    };
  }
}

/**
 * Issue a Subscriber Token for in-app browser WebRTC calling.
 * POST https://{space}/api/fabric/subscribers/tokens
 */
export async function issueSignalWireSubscriberToken(
  space: string,
  projectId: string,
  apiToken: string,
  reference: string,
): Promise<SignalWireResult<SignalWireSubscriberTokenResult>> {
  if (!space || !projectId || !apiToken) {
    return { ok: false, status: 400, message: "SignalWire is not configured." };
  }

  const cleanSpace = normalizeSpace(space);
  const endpoint = `https://${cleanSpace}/api/fabric/subscribers/tokens`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(projectId, apiToken),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ reference }),
    });

    if (!res.ok) {
      return { ok: false, status: res.status, message: await parseSignalWireError(res) };
    }

    const body = (await res.json()) as Record<string, unknown>;
    return {
      ok: true,
      data: {
        token: String(body.token || body.jwt_token || ""),
        reference: String(body.reference || reference),
        expiresAt: body.expires_at as string | undefined,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? `SignalWire subscriber token failed: ${err.message}` : "Network error issuing SignalWire subscriber token.",
    };
  }
}

/**
 * Generate valid SignalWire cXML (Compatibility XML) for inbound call handling,
 * greetings, forwarding to SIP or PSTN, or IVR.
 */
export function generateVoiceCXml(options: {
  greeting?: string;
  forwardSip?: string;
  forwardNumber?: string;
  record?: boolean;
}): string {
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<Response>"];

  if (options.greeting && options.greeting.trim()) {
    // Escape XML special chars
    const safeGreeting = options.greeting
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
    parts.push(`  <Say>${safeGreeting}</Say>`);
  }

  if (options.forwardSip && options.forwardSip.trim()) {
    let sipUri = options.forwardSip.trim();
    if (!sipUri.startsWith("sip:")) sipUri = `sip:${sipUri}`;
    const safeSip = sipUri.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const recordAttr = options.record ? ' record="record-from-answer"' : "";
    parts.push(`  <Dial${recordAttr}>`);
    parts.push(`    <Sip>${safeSip}</Sip>`);
    parts.push("  </Dial>");
  } else if (options.forwardNumber && options.forwardNumber.trim()) {
    const num = toE164(options.forwardNumber.trim());
    const recordAttr = options.record ? ' record="record-from-answer"' : "";
    parts.push(`  <Dial${recordAttr}>${num}</Dial>`);
  }

  parts.push("</Response>");
  return parts.join("\n");
}
