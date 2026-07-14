import { findCompanyById, updateCompany } from "../queries/companies";

export type TelnyxConfig = {
  enabled: boolean;
  apiKey: string; // stored server-side only, never returned in full
  connectionId: string;
  connectionName?: string;
  outboundVoiceProfileId?: string | null;
  outboundVoiceProfile?: string; // human-readable profile name (e.g. "default")
  defaultCallerId?: string;
  // Browser calling via Telnyx WebRTC (requires a Telnyx *Credential Connection*)
  webrtcEnabled?: boolean;
  sipUsername?: string; // SIP credential connection username
  sipPassword?: string; // SIP credential connection password (stored server-side)
  // Inbound SMS webhook signature verification (Telnyx portal → Public Key)
  webhookPublicKey?: string;
  // SIP trunk details (from the Telnyx portal connection)
  sipHost?: string; // e.g. hbtuutorial.sip.telnyx.com
  ipAddress?: string; // authorized IP for IP-authenticated trunks
  port?: number; // SIP signaling port, e.g. 5060
  channelLimit?: number; // concurrent call limit
  destinationFormat?: string; // inbound destination number format, e.g. +E.164
  originationFormat?: string; // origination number format
  assignedNumbers?: string[]; // numbers assigned to this connection
  updatedAt?: string;
};

export type MaskedTelnyxConfig = Omit<TelnyxConfig, "apiKey" | "sipPassword"> & {
  hasApiKey: boolean;
  apiKeyPreview: string;
  hasSipPassword: boolean;
};

function asSettings(company: unknown): Record<string, unknown> {
  const s = (company as { settings?: unknown } | null)?.settings;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : {};
}

export async function getTelnyxConfig(companyId: number): Promise<TelnyxConfig | null> {
  const company = await findCompanyById(companyId);
  const settings = asSettings(company);
  const cfg = settings.telnyx as TelnyxConfig | undefined;
  return cfg ?? null;
}

/** Mask the API key so it is never sent back to the browser. */
export function maskTelnyxConfig(cfg: TelnyxConfig | null): MaskedTelnyxConfig {
  const key = cfg?.apiKey ?? "";
  return {
    enabled: cfg?.enabled ?? false,
    connectionId: cfg?.connectionId ?? "",
    connectionName: cfg?.connectionName ?? "",
    outboundVoiceProfileId: cfg?.outboundVoiceProfileId ?? null,
    outboundVoiceProfile: cfg?.outboundVoiceProfile ?? "",
    defaultCallerId: cfg?.defaultCallerId ?? "",
    webrtcEnabled: cfg?.webrtcEnabled ?? false,
    sipUsername: cfg?.sipUsername ?? "",
    hasSipPassword: Boolean(cfg?.sipPassword),
    sipHost: cfg?.sipHost ?? "",
    ipAddress: cfg?.ipAddress ?? "",
    port: cfg?.port,
    channelLimit: cfg?.channelLimit,
    destinationFormat: cfg?.destinationFormat ?? "",
    originationFormat: cfg?.originationFormat ?? "",
    assignedNumbers: cfg?.assignedNumbers ?? [],
    webhookPublicKey: cfg?.webhookPublicKey ?? "",
    updatedAt: cfg?.updatedAt,
    hasApiKey: Boolean(key),
    apiKeyPreview: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : "",
  };
}

/**
 * Merge a partial Telnyx config into company.settings.telnyx without clobbering
 * other settings. If `apiKey` is omitted, the existing stored key is preserved
 * (so the UI can save other fields without re-sending the secret).
 */
export async function saveTelnyxConfig(
  companyId: number,
  patch: Partial<TelnyxConfig>,
): Promise<TelnyxConfig> {
  const company = await findCompanyById(companyId);
  const settings = asSettings(company);
  const existing = (settings.telnyx as TelnyxConfig | undefined) ?? {
    enabled: false,
    apiKey: "",
    connectionId: "",
  };
  const merged: TelnyxConfig = {
    ...existing,
    ...patch,
    apiKey: patch.apiKey && patch.apiKey.trim() ? patch.apiKey.trim() : existing.apiKey,
    sipPassword: patch.sipPassword && patch.sipPassword.trim() ? patch.sipPassword.trim() : existing.sipPassword,
    updatedAt: new Date().toISOString(),
  };
  await updateCompany(companyId, { settings: { ...settings, telnyx: merged } });
  return merged;
}
