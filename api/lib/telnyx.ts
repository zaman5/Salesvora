// Minimal Telnyx v2 API client.
// Docs:
//   - List connections: https://developers.telnyx.com/api-reference/connections/list-connections
//   - SIP Trunking:      https://developers.telnyx.com/docs/voice/sip-trunking/get-started
//
// Auth is a Bearer token (your Telnyx API key, starts with "KEY...").

const TELNYX_BASE = "https://api.telnyx.com/v2";

export type TelnyxConnection = {
  id: string;
  recordType: string;
  active: boolean;
  connectionName: string;
  outboundVoiceProfileId?: string | null;
  createdAt?: string;
};

export type TelnyxResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

function authHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { errors?: Array<{ detail?: string; title?: string }> };
    const first = body?.errors?.[0];
    if (first) {
      const detail = first.detail || first.title || "";
      if (/Call Control App/i.test(detail) || /connection_id/i.test(detail)) {
        return "This connection isn't a Call Control Application. For browser calling, use WebRTC with a Telnyx Credential Connection (Settings → SIP Trunk → Browser Calling).";
      }
      return detail || `Telnyx error ${res.status}`;
    }
  } catch {
    /* ignore non-JSON bodies */
  }
  if (res.status === 401) return "Invalid API key (unauthorized).";
  if (res.status === 403) return "API key lacks permission for this resource.";
  return `Telnyx request failed (HTTP ${res.status}).`;
}

/**
 * List all SIP connections on the Telnyx account.
 * GET /v2/connections — used to validate the API key and let the user pick a
 * connection to dial through.
 */
export async function listConnections(
  apiKey: string,
): Promise<TelnyxResult<TelnyxConnection[]>> {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, status: 400, message: "An API key is required." };
  }
  try {
    const res = await fetch(`${TELNYX_BASE}/connections?page[size]=100&sort=connection_name`, {
      method: "GET",
      headers: authHeaders(apiKey),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, message: await parseError(res) };
    }
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
    };
    const data: TelnyxConnection[] = (body.data || []).map((c) => ({
      id: String(c.id),
      recordType: String(c.record_type ?? "connection"),
      active: Boolean(c.active),
      connectionName: String(c.connection_name ?? c.id),
      outboundVoiceProfileId: (c.outbound_voice_profile_id as string) ?? null,
      createdAt: c.created_at as string | undefined,
    }));
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? `Could not reach Telnyx: ${err.message}` : "Network error reaching Telnyx.",
    };
  }
}

/**
 * Normalize a phone number to E.164-ish form for Telnyx: keep a leading "+",
 * strip spaces, dashes, parentheses and dots. (e.g. "+1-302-240-3311" -> "+13022403311")
 */
export function toE164(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  return hasPlus ? `+${digits}` : digits;
}

export type PlaceCallResult = {
  callControlId: string;
  callLegId?: string;
  callSessionId?: string;
};

/**
 * Place an outbound call via Telnyx Call Control.
 * POST /v2/calls — the connection_id must be a Call-Control-enabled connection.
 */
export async function placeCall(
  apiKey: string,
  params: { connectionId: string; to: string; from: string },
): Promise<TelnyxResult<PlaceCallResult>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  if (!params.connectionId) return { ok: false, status: 400, message: "No Telnyx connection selected." };
  try {
    const res = await fetch(`${TELNYX_BASE}/calls`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        connection_id: params.connectionId,
        to: toE164(params.to),
        from: toE164(params.from),
      }),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, message: await parseError(res) };
    }
    const body = (await res.json()) as { data: Record<string, unknown> };
    return {
      ok: true,
      data: {
        callControlId: String(body.data?.call_control_id ?? ""),
        callLegId: body.data?.call_leg_id as string | undefined,
        callSessionId: body.data?.call_session_id as string | undefined,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err instanceof Error ? `Could not reach Telnyx: ${err.message}` : "Network error reaching Telnyx.",
    };
  }
}
