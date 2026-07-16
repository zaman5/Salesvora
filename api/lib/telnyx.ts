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

export type SendSMSResult = { id: string; status: string };

/**
 * Send a single SMS via Telnyx Messaging.
 * POST /v2/messages
 */
export async function sendSMS(
  apiKey: string,
  params: { from: string; to: string; text: string },
): Promise<TelnyxResult<SendSMSResult>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  try {
    const res = await fetch(`${TELNYX_BASE}/messages`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ from: params.from, to: params.to, text: params.text, type: "SMS" }),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    const body = (await res.json()) as { data: Record<string, unknown> };
    return {
      ok: true,
      data: {
        id: String(body.data?.id ?? ""),
        // Telnyx puts status inside to[0].status for SMS
        status: String((body.data?.to as Array<Record<string, unknown>>)?.[0]?.status ?? "sent"),
      },
    };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? `Telnyx: ${err.message}` : "Network error." };
  }
}

/**
 * Force-hang-up a live Telnyx call via Call Control.
 * POST /v2/calls/{call_control_id}/actions/hangup
 */
export async function hangupTelnyxCall(
  apiKey: string,
  callControlId: string,
): Promise<TelnyxResult<{ done: boolean }>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx not configured." };
  try {
    const res = await fetch(`${TELNYX_BASE}/calls/${encodeURIComponent(callControlId)}/actions/hangup`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({}),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    return { ok: true, data: { done: true } };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error." };
  }
}

export type CreateCredentialResult = { username: string; password: string; connectionId: string };

/**
 * Create a dedicated Telnyx Credential Connection for one agent so they can
 * register their own independent WebRTC/SIP session — Telnyx only keeps one
 * live registration per credential, so agents sharing a single username get
 * kicked off / blocked from calling or receiving calls at the same time.
 * POST /v2/credential_connections
 */
// ─── Outbound Voice Profiles ───
// A connection WITHOUT an outbound voice profile cannot place outbound calls —
// Telnyx rejects every attempt with SIP 480 "Temporarily Unavailable". These
// helpers let the app resolve/create/attach a profile automatically instead of
// silently creating broken connections.

export type OutboundVoiceProfile = { id: string; name: string };

/** GET /v2/outbound_voice_profiles */
export async function listOutboundVoiceProfiles(
  apiKey: string,
): Promise<TelnyxResult<OutboundVoiceProfile[]>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  try {
    const res = await fetch(`${TELNYX_BASE}/outbound_voice_profiles?page[size]=50`, {
      headers: authHeaders(apiKey),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
    return {
      ok: true,
      data: (body.data ?? []).map((p) => ({ id: String(p.id ?? ""), name: String(p.name ?? "") })),
    };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error reaching Telnyx." };
  }
}

/** POST /v2/outbound_voice_profiles */
export async function createOutboundVoiceProfile(
  apiKey: string,
  name: string,
): Promise<TelnyxResult<OutboundVoiceProfile>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  try {
    const res = await fetch(`${TELNYX_BASE}/outbound_voice_profiles`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ name, traffic_type: "conversational" }),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    const body = (await res.json()) as { data?: Record<string, unknown> };
    return { ok: true, data: { id: String(body.data?.id ?? ""), name } };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error reaching Telnyx." };
  }
}

/**
 * Return an outbound voice profile id, creating "Salesvora Outbound" if the
 * account has none. Without one, outbound calls fail with SIP 480.
 */
export async function ensureOutboundVoiceProfile(apiKey: string): Promise<TelnyxResult<string>> {
  const existing = await listOutboundVoiceProfiles(apiKey);
  if (!existing.ok) return existing;
  if (existing.data.length > 0) return { ok: true, data: existing.data[0].id };
  const created = await createOutboundVoiceProfile(apiKey, "Salesvora Outbound");
  if (!created.ok) return created;
  return { ok: true, data: created.data.id };
}

/**
 * PATCH /v2/credential_connections/{id} — attach an outbound voice profile to
 * an existing credential connection so it can place outbound calls.
 */
export async function attachVoiceProfileToConnection(
  apiKey: string,
  connectionId: string,
  outboundVoiceProfileId: string,
): Promise<TelnyxResult<{ connectionId: string }>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  try {
    const res = await fetch(`${TELNYX_BASE}/credential_connections/${encodeURIComponent(connectionId)}`, {
      method: "PATCH",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ outbound: { outbound_voice_profile_id: outboundVoiceProfileId } }),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    return { ok: true, data: { connectionId } };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error reaching Telnyx." };
  }
}

export async function createCredentialConnection(
  apiKey: string,
  params: { connectionName: string; username: string; password: string; outboundVoiceProfileId?: string | null },
): Promise<TelnyxResult<CreateCredentialResult>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  try {
    const body: Record<string, unknown> = {
      connection_name: params.connectionName,
      user_name: params.username,
      password: params.password,
    };
    // A credential connection created WITHOUT an outbound voice profile can
    // receive calls but every outbound attempt fails with SIP 480. If the
    // caller didn't supply a profile id, resolve one from the account (or
    // create it) rather than silently provisioning a broken connection.
    let ovpId = params.outboundVoiceProfileId;
    if (!ovpId) {
      const ensured = await ensureOutboundVoiceProfile(apiKey);
      if (ensured.ok) ovpId = ensured.data;
    }
    if (ovpId) {
      body.outbound = { outbound_voice_profile_id: ovpId };
    }
    const res = await fetch(`${TELNYX_BASE}/credential_connections`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    const resBody = (await res.json()) as { data: Record<string, unknown> };
    return {
      ok: true,
      data: {
        username: params.username,
        password: params.password,
        connectionId: String(resBody.data?.id ?? ""),
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

// ─── Messaging Profiles + Phone Number routing ───
// Inbound SMS only reaches the app when the Telnyx number is attached to a
// messaging profile whose webhook_url points at /api/webhooks/telnyx, and
// inbound calls only ring the browser when the number's voice connection is
// the credential connection the agent's WebRTC client registers on. Neither
// is configured by buying a number — these helpers let the app repair both.

export type MessagingProfile = { id: string; name: string; webhookUrl?: string | null };

/** GET /v2/messaging_profiles */
export async function listMessagingProfiles(
  apiKey: string,
): Promise<TelnyxResult<MessagingProfile[]>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  try {
    const res = await fetch(`${TELNYX_BASE}/messaging_profiles?page[size]=50`, {
      headers: authHeaders(apiKey),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
    return {
      ok: true,
      data: (body.data ?? []).map((p) => ({
        id: String(p.id ?? ""),
        name: String(p.name ?? ""),
        webhookUrl: (p.webhook_url as string | null) ?? null,
      })),
    };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error reaching Telnyx." };
  }
}

/** POST /v2/messaging_profiles */
export async function createMessagingProfile(
  apiKey: string,
  params: { name: string; webhookUrl: string },
): Promise<TelnyxResult<MessagingProfile>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  try {
    const res = await fetch(`${TELNYX_BASE}/messaging_profiles`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        name: params.name,
        enabled: true,
        webhook_url: params.webhookUrl,
        webhook_api_version: "2",
        // Telnyx rejects profile creation without a destination whitelist
        // ("Messaging profile is missing whitelisted destinations"). This only
        // gates outbound sends on the profile; inbound delivery is unaffected.
        whitelisted_destinations: ["US", "CA"],
      }),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    const body = (await res.json()) as { data?: Record<string, unknown> };
    return {
      ok: true,
      data: { id: String(body.data?.id ?? ""), name: params.name, webhookUrl: params.webhookUrl },
    };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error reaching Telnyx." };
  }
}

/** PATCH /v2/messaging_profiles/{id} — point the profile's webhook at us. */
export async function updateMessagingProfileWebhook(
  apiKey: string,
  profileId: string,
  webhookUrl: string,
): Promise<TelnyxResult<{ id: string }>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  try {
    const res = await fetch(`${TELNYX_BASE}/messaging_profiles/${encodeURIComponent(profileId)}`, {
      method: "PATCH",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ enabled: true, webhook_url: webhookUrl, webhook_api_version: "2" }),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    return { ok: true, data: { id: profileId } };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error reaching Telnyx." };
  }
}

export type CredentialConnectionInfo = { id: string; name: string; userName: string };

/**
 * GET /v2/credential_connections — includes each connection's SIP user_name,
 * which /v2/connections does not return. Needed to find the connection the
 * browser actually registers on (Settings → SIP username) so inbound calls
 * can be routed to it.
 */
export async function listCredentialConnections(
  apiKey: string,
): Promise<TelnyxResult<CredentialConnectionInfo[]>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  try {
    const res = await fetch(`${TELNYX_BASE}/credential_connections?page[size]=100`, {
      headers: authHeaders(apiKey),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
    return {
      ok: true,
      data: (body.data ?? []).map((c) => ({
        id: String(c.id ?? ""),
        name: String(c.connection_name ?? ""),
        userName: String(c.user_name ?? ""),
      })),
    };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error reaching Telnyx." };
  }
}

export type AccountPhoneNumber = {
  id: string;
  phoneNumber: string;
  connectionId?: string | null;
  connectionName?: string | null;
  messagingProfileId?: string | null;
};

/** GET /v2/phone_numbers — every number owned by the Telnyx account. */
export async function listAccountPhoneNumbers(
  apiKey: string,
): Promise<TelnyxResult<AccountPhoneNumber[]>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  try {
    const res = await fetch(`${TELNYX_BASE}/phone_numbers?page[size]=250`, {
      headers: authHeaders(apiKey),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
    return {
      ok: true,
      data: (body.data ?? []).map((n) => ({
        id: String(n.id ?? ""),
        phoneNumber: String(n.phone_number ?? ""),
        connectionId: (n.connection_id as string | null) ?? null,
        connectionName: (n.connection_name as string | null) ?? null,
        messagingProfileId: (n.messaging_profile_id as string | null) ?? null,
      })),
    };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error reaching Telnyx." };
  }
}

/** PATCH /v2/phone_numbers/{id} — route the number's inbound VOICE to a connection. */
export async function setPhoneNumberConnection(
  apiKey: string,
  phoneNumberId: string,
  connectionId: string,
): Promise<TelnyxResult<{ id: string }>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  try {
    const res = await fetch(`${TELNYX_BASE}/phone_numbers/${encodeURIComponent(phoneNumberId)}`, {
      method: "PATCH",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ connection_id: connectionId }),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    return { ok: true, data: { id: phoneNumberId } };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error reaching Telnyx." };
  }
}

/** PATCH /v2/phone_numbers/{id}/messaging — route the number's inbound SMS to a messaging profile. */
export async function setPhoneNumberMessagingProfile(
  apiKey: string,
  phoneNumberId: string,
  messagingProfileId: string,
): Promise<TelnyxResult<{ id: string }>> {
  if (!apiKey) return { ok: false, status: 400, message: "Telnyx is not configured." };
  try {
    const res = await fetch(`${TELNYX_BASE}/phone_numbers/${encodeURIComponent(phoneNumberId)}/messaging`, {
      method: "PATCH",
      headers: authHeaders(apiKey),
      body: JSON.stringify({ messaging_profile_id: messagingProfileId }),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await parseError(res) };
    return { ok: true, data: { id: phoneNumberId } };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error reaching Telnyx." };
  }
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
