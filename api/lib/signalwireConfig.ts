import { findCompanyById, updateCompany } from "../queries/companies";

export type TelephonyProvider = "telnyx" | "signalwire";

export type SignalWireConfig = {
  enabled: boolean;
  space: string; // e.g. "salesvora.signalwire.com"
  projectId: string; // e.g. "6e1caf1e-238f-4ab3-b618-d164507f1250"
  apiToken: string; // stored server-side only, never returned in full
  sipCredential?: string; // e.g. "livekit-agent@salesvora-d164507f1250.sip.signalwire.com"
  sipUsername?: string;
  sipPassword?: string;
  defaultCallerId?: string; // e.g. "+15550002222"
  inboundGreeting?: string; // TTS greeting, e.g. "Thanks for calling SalesVora. Connecting you now."
  inboundForwardSip?: string; // Target SIP URI for <Dial><Sip>
  inboundForwardNumber?: string; // Target PSTN number for <Dial><Number>
  webrtcEnabled?: boolean;
  webhookVoiceUrl?: string; // Optional custom voice webhook URL
  webhookStatusUrl?: string; // Optional custom status webhook URL
  webhookSmsUrl?: string; // Optional custom SMS webhook URL
  updatedAt?: string;
};

export type MaskedSignalWireConfig = Omit<SignalWireConfig, "apiToken" | "sipPassword"> & {
  hasApiToken: boolean;
  apiTokenPreview: string;
  hasSipPassword: boolean;
};

function asSettings(company: unknown): Record<string, unknown> {
  const s = (company as { settings?: unknown } | null)?.settings;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : {};
}

export async function getActiveTelephonyProvider(companyId: number): Promise<TelephonyProvider> {
  const company = await findCompanyById(companyId);
  const settings = asSettings(company);
  const active = settings.activeTelephonyProvider as TelephonyProvider | undefined;
  if (active === "signalwire" || active === "telnyx") {
    return active;
  }
  // Default to signalwire if signalwire is enabled, otherwise telnyx
  const sw = settings.signalwire as SignalWireConfig | undefined;
  if (sw?.enabled && sw.projectId && sw.apiToken) {
    return "signalwire";
  }
  return "telnyx";
}

export async function setActiveTelephonyProvider(
  companyId: number,
  provider: TelephonyProvider,
): Promise<TelephonyProvider> {
  const company = await findCompanyById(companyId);
  const settings = asSettings(company);
  await updateCompany(companyId, { settings: { ...settings, activeTelephonyProvider: provider } });
  return provider;
}

export async function getSignalWireConfig(companyId: number): Promise<SignalWireConfig | null> {
  const company = await findCompanyById(companyId);
  const settings = asSettings(company);
  const cfg = settings.signalwire as SignalWireConfig | undefined;
  return cfg ?? null;
}

/** Mask the SignalWire API token and SIP password so secrets are never sent to the browser. */
export function maskSignalWireConfig(cfg: SignalWireConfig | null): MaskedSignalWireConfig {
  const token = cfg?.apiToken ?? "";
  return {
    enabled: cfg?.enabled ?? false,
    space: cfg?.space ?? "",
    projectId: cfg?.projectId ?? "",
    sipCredential: cfg?.sipCredential ?? "",
    sipUsername: cfg?.sipUsername ?? "",
    hasSipPassword: Boolean(cfg?.sipPassword),
    defaultCallerId: cfg?.defaultCallerId ?? "",
    inboundGreeting: cfg?.inboundGreeting ?? "Thanks for calling SalesVora. Connecting you now.",
    inboundForwardSip: cfg?.inboundForwardSip ?? "",
    inboundForwardNumber: cfg?.inboundForwardNumber ?? "",
    webrtcEnabled: cfg?.webrtcEnabled ?? true,
    webhookVoiceUrl: cfg?.webhookVoiceUrl ?? "",
    webhookStatusUrl: cfg?.webhookStatusUrl ?? "",
    webhookSmsUrl: cfg?.webhookSmsUrl ?? "",
    updatedAt: cfg?.updatedAt,
    hasApiToken: Boolean(token),
    apiTokenPreview: token ? `${token.slice(0, 4)}…${token.slice(-4)}` : "",
  };
}

/**
 * Merge a partial SignalWire config into company.settings.signalwire without clobbering
 * other settings. If `apiToken` or `sipPassword` is omitted, existing stored secrets are preserved.
 */
export async function saveSignalWireConfig(
  companyId: number,
  patch: Partial<SignalWireConfig>,
): Promise<SignalWireConfig> {
  const company = await findCompanyById(companyId);
  const settings = asSettings(company);
  const existing = (settings.signalwire as SignalWireConfig | undefined) ?? {
    enabled: false,
    space: "salesvora.signalwire.com",
    projectId: "",
    apiToken: "",
  };

  const merged: SignalWireConfig = {
    ...existing,
    ...patch,
    space: (patch.space && patch.space.trim()) ? patch.space.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "") : existing.space,
    projectId: patch.projectId && patch.projectId.trim() ? patch.projectId.trim() : existing.projectId,
    apiToken: patch.apiToken && patch.apiToken.trim() ? patch.apiToken.trim() : existing.apiToken,
    sipPassword: patch.sipPassword && patch.sipPassword.trim() ? patch.sipPassword.trim() : existing.sipPassword,
    updatedAt: new Date().toISOString(),
  };

  await updateCompany(companyId, { settings: { ...settings, signalwire: merged } });
  return merged;
}
