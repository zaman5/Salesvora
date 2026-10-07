import { findCompanyById } from "../queries/companies";
import { patchCompanySettings } from "./companySettings";

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
  // Messaging profile that delivers inbound SMS to /api/webhooks/telnyx
  // (created/repaired by integration.repairInboundSetup).
  messagingProfileId?: string | null;
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
  return cfg ? stripSignalWireLeak(cfg, settings) : null;
}

const digits = (s?: string) => (s ?? "").replace(/\D/g, "");

/**
 * An old Settings bug saved a SignalWire number's label ("SignalWire (space)")
 * as the Telnyx SIP username / connection name, and the SignalWire number as
 * the Telnyx caller ID. Ignore those leaked values so Telnyx never dials with
 * a SignalWire identity.
 */
function stripSignalWireLeak(cfg: TelnyxConfig, settings: Record<string, unknown>): TelnyxConfig {
  const isSwLabel = (v?: string) => Boolean(v && /^signalwire\b/i.test(v.trim()));
  const swCaller = digits((settings.signalwire as { defaultCallerId?: string } | undefined)?.defaultCallerId);
  const assigned = (cfg.assignedNumbers ?? []).map(digits);
  const leakedCaller =
    Boolean(swCaller) && digits(cfg.defaultCallerId) === swCaller && !assigned.includes(swCaller);
  if (!isSwLabel(cfg.sipUsername) && !isSwLabel(cfg.connectionName) && !leakedCaller) return cfg;
  return {
    ...cfg,
    sipUsername: isSwLabel(cfg.sipUsername) ? "" : cfg.sipUsername,
    connectionName: isSwLabel(cfg.connectionName) ? "" : cfg.connectionName,
    defaultCallerId: leakedCaller ? "" : cfg.defaultCallerId,
  };
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
  return patchCompanySettings(companyId, (settings) => {
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
    // Only the Telnyx subtree is written — the active provider is untouched.
    return { patch: { telnyx: merged }, result: merged };
  });
}
