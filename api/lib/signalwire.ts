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
      // Fabric / Relay APIs answer {"errors":[{code,message,attribute}]}; LaML answers {message}.
      const first = Array.isArray(json.errors) ? json.errors[0] : null;
      if (first?.code === "insufficient_balance") {
        return "SignalWire account has insufficient balance. Add funds in the SignalWire Dashboard → Billing, then reload the dialer.";
      }
      rawMsg =
        json.message || json.error_message || json.description ||
        (first ? [first.message, first.attribute ? `(${first.attribute})` : ""].filter(Boolean).join(" ") : "");
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
 * Point SignalWire numbers' inbound calls at a SWML script URL (call_handler "relay_script").
 * Only numbers in `numbers` are touched — the project may also hold numbers for other apps.
 * PUT https://{space}/api/relay/rest/phone_numbers/{id}
 */
export async function routeSignalWireNumbersToSwml(
  space: string,
  projectId: string,
  apiToken: string,
  numbers: string[],
  swmlUrl: string,
): Promise<SignalWireResult<{ updated: string[]; alreadySet: string[]; notFound: string[] }>> {
  if (!space || !projectId || !apiToken) {
    return { ok: false, status: 400, message: "SignalWire is not configured." };
  }
  const cleanSpace = normalizeSpace(space);
  const headers = {
    Authorization: basicAuthHeader(projectId, apiToken),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const wanted = [...new Set(numbers.map((n) => toE164(n)).filter((n) => n.length > 4))];
  const updated: string[] = [];
  const alreadySet: string[] = [];

  try {
    const owned: Array<{ id: string; number: string; handler?: string; scriptUrl?: string }> = [];
    let url: string | undefined = `https://${cleanSpace}/api/relay/rest/phone_numbers?page_size=100`;
    for (let page = 0; url && page < 20; page++) {
      const res: Response = await fetch(url, { headers });
      if (!res.ok) return { ok: false, status: res.status, message: await parseSignalWireError(res) };
      const body: any = await res.json();
      for (const row of body?.data ?? []) {
        owned.push({ id: String(row.id), number: String(row.number), handler: row.call_handler, scriptUrl: row.call_relay_script_url });
      }
      url = body?.links?.next || undefined;
    }

    const notFound: string[] = [];
    for (const num of wanted) {
      const match = owned.find((o) => toE164(o.number) === num);
      if (!match) {
        notFound.push(num);
        continue;
      }
      if (match.handler === "relay_script" && match.scriptUrl === swmlUrl) {
        alreadySet.push(num);
        continue;
      }
      const res = await fetch(`https://${cleanSpace}/api/relay/rest/phone_numbers/${encodeURIComponent(match.id)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ call_handler: "relay_script", call_relay_script_url: swmlUrl }),
      });
      if (!res.ok) return { ok: false, status: res.status, message: `${num}: ${await parseSignalWireError(res)}` };
      updated.push(num);
    }
    return { ok: true, data: { updated, alreadySet, notFound } };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? `SignalWire number update failed: ${err.message}` : "Network error updating SignalWire numbers.",
    };
  }
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
    timeoutSec?: number; // ring time before giving up
    timeLimitSec?: number; // hard cap on billed call length
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
  // Cost guards: stop ringing after 30 s (unanswered rings are free, but a
  // long ring often ends in voicemail, which IS billed), and never let a
  // forgotten leg run longer than an hour.
  form.append("Timeout", String(params.timeoutSec ?? 30));
  form.append("TimeLimit", String(params.timeLimitSec ?? 3600));

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
 * End a live call leg (POST Calls/{sid}.json Status=completed). Without this,
 * hanging up in the app left the customer's PSTN leg running — and billing —
 * until the customer (or their voicemail) hung up.
 */
export async function hangupSignalWireCall(
  space: string,
  projectId: string,
  apiToken: string,
  callSid: string,
): Promise<SignalWireResult<{ callSid: string }>> {
  if (!space || !projectId || !apiToken || !callSid) {
    return { ok: false, status: 400, message: "SignalWire is not configured or call SID missing." };
  }
  const endpoint = `https://${normalizeSpace(space)}/api/laml/2010-04-01/Accounts/${encodeURIComponent(projectId)}/Calls/${encodeURIComponent(callSid)}.json`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(projectId, apiToken),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ Status: "completed" }).toString(),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseSignalWireError(res) };
    return { ok: true, data: { callSid } };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error ending SignalWire call." };
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
  const subEndpoint = `https://${cleanSpace}/api/fabric/subscribers`;

  try {
    // 1. Best-effort ensure subscriber exists in SignalWire Call Fabric
    try {
      await fetch(subEndpoint, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(projectId, apiToken),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: reference.includes("@") ? reference : `${reference}@salesvora.com`,
          first_name: "SalesVora",
          last_name: "Agent",
        }),
      });
    } catch {
      /* ignore if subscriber already exists */
    }

    let currentToken = apiToken;
    let res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(projectId, currentToken),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ reference }),
    });

    if (res.status === 401 && process.env.SIGNALWIRE_API_TOKEN && process.env.SIGNALWIRE_API_TOKEN !== currentToken) {
      currentToken = process.env.SIGNALWIRE_API_TOKEN;
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(projectId, currentToken),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ reference }),
      });
    }

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

// Subscriber email → "/private/name" audio address. Addresses never change for a
// subscriber, so a short cache keeps the inbound webhook fast (SignalWire waits on it).
const subscriberAddressCache = new Map<string, { address: string | null; at: number }>();
const SUBSCRIBER_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Resolve the Call Fabric addresses (e.g. "/private/jane") of the subscribers the browser
 * dialer signs in as. The dialer issues tokens with `reference = user email`, so the
 * subscriber's email is the join key. Unknown emails are simply skipped.
 */
export async function findSignalWireSubscriberAddresses(
  space: string,
  projectId: string,
  apiToken: string,
  emails: string[],
): Promise<string[]> {
  if (!space || !projectId || !apiToken || emails.length === 0) return [];
  const cleanSpace = normalizeSpace(space);
  const auth = basicAuthHeader(projectId, apiToken);
  const wanted = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const now = Date.now();

  const result: string[] = [];
  const missing = new Set<string>();
  for (const email of wanted) {
    const hit = subscriberAddressCache.get(`${cleanSpace}|${email}`);
    if (hit && now - hit.at < SUBSCRIBER_CACHE_TTL_MS) {
      if (hit.address) result.push(hit.address);
    } else {
      missing.add(email);
    }
  }
  if (missing.size === 0) return result;

  const getJson = async (url: string): Promise<any> => {
    const res = await fetch(url, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(await parseSignalWireError(res));
    return res.json();
  };

  try {
    // 1. Page through subscribers to map email → subscriber resource id
    const idsByEmail = new Map<string, string>();
    let url: string | undefined = `https://${cleanSpace}/api/fabric/resources/subscribers?page_size=100`;
    for (let page = 0; url && page < 10 && idsByEmail.size < missing.size; page++) {
      const body: any = await getJson(url);
      for (const row of body?.data ?? []) {
        const email = String(row?.subscriber?.email ?? "").toLowerCase();
        if (email && missing.has(email) && row?.id) idsByEmail.set(email, String(row.id));
      }
      url = body?.links?.next || undefined;
    }

    // 2. Fetch each matched subscriber's audio address
    await Promise.all(
      [...missing].map(async (email) => {
        const id = idsByEmail.get(email);
        let address: string | null = null;
        if (id) {
          try {
            const body: any = await getJson(`https://${cleanSpace}/api/fabric/resources/subscribers/${id}/addresses`);
            // Docs show both `{data: [...]}` and `[{data: [...]}]` shapes.
            const rows: any[] = Array.isArray(body) ? body.flatMap((b: any) => b?.data ?? []) : body?.data ?? [];
            const usable = rows.find((r) => !r?.locked && (r?.channels?.audio || r?.name));
            if (usable) {
              address = usable.channels?.audio
                ? String(usable.channels.audio).split("?")[0]
                : `/private/${usable.name}`;
            }
          } catch (err) {
            console.warn(`[signalwire] could not load addresses for subscriber ${email}:`, err);
          }
        }
        subscriberAddressCache.set(`${cleanSpace}|${email}`, { address, at: now });
        if (address) result.push(address);
      }),
    );
  } catch (err) {
    console.warn("[signalwire] subscriber address lookup failed:", err);
  }
  return result;
}

/**
 * Generate a SWML document for an inbound call: greet, ring every agent's browser dialer
 * (Call Fabric subscriber addresses) and/or a forward number in parallel, and fall back
 * to voicemail when nobody answers. cXML cannot do this — its <Dial> has no noun for
 * Fabric subscribers — so inbound numbers must use a SWML handler to reach the browser.
 *
 * `eventUrl` receives JSON POSTs ({event, call_id, ...}) so the CRM can track the call.
 */
// The last inbound webhook hits, so "Fix Inbound Calls" can show what actually happened to
// a test call. In memory only — it is a troubleshooting aid, not a call log.
type InboundNote = { companyId: number; at: string; from: string; to: string; mode: "swml" | "cxml"; note: string };
const inboundNotes: InboundNote[] = [];

export function noteInboundCall(entry: Omit<InboundNote, "at">) {
  inboundNotes.unshift({ ...entry, at: new Date().toISOString() });
  inboundNotes.length = Math.min(inboundNotes.length, 50);
  console.log(`[signalwire inbound] company ${entry.companyId} ${entry.mode} ${entry.from} → ${entry.to}: ${entry.note}`);
}

export function recentInboundCalls(companyId: number): InboundNote[] {
  return inboundNotes.filter((n) => n.companyId === companyId);
}

export function generateInboundSwml(options: {
  greeting?: string;
  destinations: string[];
  timeout?: number;
  eventUrl?: string;
  voicemailPrompt?: string;
  /** Ringback played to the caller first, giving a woken Android app time to come online. */
  holdSeconds?: number;
  /** Second stage (e.g. the agent's own cell) tried when nobody answers the first. */
  fallback?: string[];
  fallbackTimeout?: number;
}): Record<string, unknown> {
  const sayUrl = (text: string) => `say:${text.replace(/\s+/g, " ").trim()}`;
  const notify = (event: string, extra: Record<string, string> = {}) =>
    options.eventUrl
      ? [{
          request: {
            url: options.eventUrl,
            method: "POST",
            body: { event, call_id: "%{call.call_id}", from: "%{call.from}", to: "%{call.to}", ...extra },
            timeout: 5,
          },
        }]
      : [];

  const voicemail = [
    { play: { url: sayUrl(options.voicemailPrompt || "Sorry, no one is available to take your call. Please leave a message after the tone.") } },
    { record: { beep: true, format: "mp3", end_silence_timeout: 5, terminators: "#" } },
    ...notify("voicemail", { record_url: "%{record_url}" }),
    { hangup: {} },
  ];

  const main: unknown[] = [{ answer: {} }];
  if (options.greeting && options.greeting.trim()) {
    main.push({ play: { url: sayUrl(options.greeting) } });
  }

  const unique = (list: string[] = []) => [...new Set(list.map((d) => d.trim()).filter(Boolean))];
  const destinations = unique(options.destinations);
  const fallback = unique(options.fallback).filter((d) => !destinations.includes(d));

  // Each stage rings its targets in parallel; on no answer it falls through to
  // the next stage, and the last stage falls through to voicemail.
  const stage = (targets: string[], timeout: number, onFail: unknown[]): unknown[] => [{
    connect: {
      parallel: targets.map((to) => ({ to })),
      timeout,
      result: {
        case: {
          connected: [...notify("completed"), { hangup: {} }],
          failed: onFail,
        },
        default: onFail,
      },
    },
  }];
  const toVoicemail = [...notify("no_answer"), ...voicemail];
  const afterFirst = fallback.length ? stage(fallback, options.fallbackTimeout ?? 25, toVoicemail) : toVoicemail;

  if (destinations.length === 0) {
    main.push(...afterFirst);
  } else {
    const hold = Math.min(Math.max(Math.round(options.holdSeconds ?? 0), 0), 15);
    if (hold > 0) main.push({ play: { url: `ring:${hold}` } });
    main.push(...stage(destinations, options.timeout ?? 25, afterFirst));
  }

  return { version: "1.0.0", sections: { main } };
}

/**
 * Generate valid SignalWire cXML (Compatibility XML) for inbound call handling,
 * greetings, forwarding to SIP or PSTN, or IVR.
 */
export function generateVoiceCXml(options: {
  greeting?: string;
  forwardSip?: string;
  forwardNumber?: string;
  conference?: string;
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

  if (options.conference && options.conference.trim()) {
    const safeConf = options.conference.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const recordAttr = options.record ? ' record="record-from-start"' : "";
    parts.push(`  <Dial${recordAttr}>`);
    parts.push(`    <Conference startConferenceOnEnter="true" endConferenceOnExit="true">${safeConf}</Conference>`);
    parts.push("  </Dial>");
  } else if (options.forwardSip && options.forwardSip.trim()) {
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
