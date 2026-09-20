import { createPublicKey, verify as cryptoVerify } from "crypto";
import { findAllCompanies, findCompanyById } from "../queries/companies";
import { findAllUsers } from "../queries/users";
import { findCallByTelnyxId } from "../queries/calls";
import { toE164 } from "./telnyx";

// RFC 8410 SubjectPublicKeyInfo prefix for a raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Verify a Telnyx webhook's Ed25519 signature.
 * Telnyx signs `${timestamp}|${rawBody}` and sends the result (base64) in the
 * `telnyx-signature-ed25519` header, with `telnyx-timestamp` alongside it.
 * The public key is account-specific — copy it from the Telnyx portal
 * (Account Settings → Public Key) into Settings → Integration → Telnyx.
 */
export function verifyTelnyxSignature(
  rawBody: string,
  signatureB64: string,
  timestamp: string,
  publicKeyB64: string,
): boolean {
  try {
    const raw = Buffer.from(publicKeyB64, "base64");
    if (raw.length !== 32) return false;
    const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
    const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
    const signedPayload = Buffer.from(`${timestamp}|${rawBody}`);
    const signature = Buffer.from(signatureB64, "base64");
    return cryptoVerify(null, signedPayload, publicKey, signature);
  } catch {
    return false;
  }
}

/**
 * Compare two phone numbers ignoring formatting. Telnyx always delivers full
 * E.164 ("+15550001234") but numbers saved in Settings may lack the "+" or
 * even the country code — strict toE164 equality silently dropped inbound SMS/calls.
 * Digits-only comparison, tolerating missing country code prefixes.
 */
export function sameNumber(a: string | undefined, b: string | undefined): boolean {
  const da = (a || "").replace(/[^0-9]/g, "");
  const db = (b || "").replace(/[^0-9]/g, "");
  if (!da || !db) return false;
  if (da === db) return true;
  const [long, short] = da.length >= db.length ? [da, db] : [db, da];
  return short.length >= 7 && long.endsWith(short);
}

/**
 * Parse and clean a Telnyx target destination (phone number, SIP URI, or username).
 * Handles:
 *   - "sip:+12025550131@sip.telnyx.com" -> "+12025550131"
 *   - "sip:sv_2_5_abc123@sip.telnyx.com" -> "sv_2_5_abc123"
 *   - "+1-202-555-0131" -> "+12025550131"
 */
export function parseTelnyxTarget(target: string | undefined): {
  raw: string;
  cleaned: string;
  e164: string;
  sipUser?: string;
  parsedCompanyId?: number;
  parsedUserId?: number;
} {
  if (!target) return { raw: "", cleaned: "", e164: "" };
  let cleaned = target.trim();
  
  // Extract user part from SIP URIs
  if (cleaned.toLowerCase().startsWith("sip:")) {
    cleaned = cleaned.slice(4);
    const atIdx = cleaned.indexOf("@");
    if (atIdx !== -1) {
      cleaned = cleaned.slice(0, atIdx);
    }
  }

  let sipUser: string | undefined;
  let parsedCompanyId: number | undefined;
  let parsedUserId: number | undefined;

  // Check for Salesvora SIP username pattern: sv_<companyId>_<userId>_<random>
  const svMatch = /^sv_(\d+)_(\d+)(?:_[a-zA-Z0-9]+)?$/i.exec(cleaned);
  if (svMatch) {
    sipUser = cleaned;
    parsedCompanyId = Number(svMatch[1]);
    parsedUserId = Number(svMatch[2]);
  }

  const e164 = toE164(cleaned);

  return {
    raw: target,
    cleaned,
    e164,
    sipUser,
    parsedCompanyId,
    parsedUserId,
  };
}

export type WebhookResolution = {
  companyId: number | null;
  callerId: number | null;
  callId?: number | null;
  existingCall?: any;
  verified: boolean;
};

/**
 * Robust multi-tenant resolver for Telnyx webhook events (both SMS and Voice Callbacks).
 * Identifies the exact company and caller account across all client accounts.
 */
export async function resolveCompanyAndCallerForWebhook(
  payload: any,
  eventType?: string,
  rawBody?: string,
  signatureHeader?: string,
  timestampHeader?: string,
): Promise<WebhookResolution> {
  const p = payload?.data?.payload || payload?.payload || payload || {};
  const allCompanies = (await findAllCompanies()) as Array<{
    id: number;
    settings?: Record<string, unknown>;
  }>;
  const allUsers = (await findAllUsers()) as Array<{
    id: number;
    companyId?: number | null;
    role?: string;
    phone?: string;
    sipCredentials?: { username?: string; domain?: string };
  }>;

  // 1. Check if an existing call in DB matches call_control_id / call_leg_id / call_session_id
  const telnyxCallId = p.call_control_id || p.call_leg_id || p.call_session_id;
  if (telnyxCallId) {
    const existingCall = await findCallByTelnyxId(telnyxCallId);
    if (existingCall) {
      return {
        companyId: existingCall.companyId ?? null,
        callerId: existingCall.callerId ?? null,
        callId: existingCall.id,
        existingCall,
        verified: true,
      };
    }
  }

  // 2. Extract destination "to" and caller "from"
  const rawTo = typeof p.to === "string" ? p.to : p.to?.[0]?.phone_number || "";
  const parsedTo = parseTelnyxTarget(rawTo);
  
  // If destination is a SIP username with embedded company/user (sv_<companyId>_<userId>_...)
  if (parsedTo.parsedCompanyId) {
    return {
      companyId: parsedTo.parsedCompanyId,
      callerId: parsedTo.parsedUserId ?? null,
      verified: true,
    };
  }

  // 3. Match connection_id against companies and users
  const connectionId = p.connection_id || p.connectionId;
  if (connectionId) {
    for (const c of allCompanies) {
      const cfg = (c.settings?.telnyx || {}) as { connectionId?: string };
      if (cfg.connectionId && cfg.connectionId === connectionId) {
        // Find default admin or assigned user for this company
        const admin = allUsers.find((u) => u.companyId === c.id && u.role === "admin");
        return {
          companyId: c.id,
          callerId: admin?.id ?? null,
          verified: true,
        };
      }
    }
  }

  // 4. Match target phone number against all companies' phone pools & assigned numbers
  if (parsedTo.cleaned || parsedTo.e164) {
    const target = parsedTo.e164 || parsedTo.cleaned;

    for (const c of allCompanies) {
      const settings = c.settings || {};
      const cfg = settings.telnyx as { defaultCallerId?: string; assignedNumbers?: string[] } | undefined;
      const phones = (settings.phoneNumbers || []) as Array<{
        id?: number;
        number?: string;
        status?: string;
        assignedTo?: number | null;
      }>;

      // Check explicit phone numbers list
      const matchedPhone = phones.find(
        (phoneEntry) => phoneEntry.number && sameNumber(phoneEntry.number, target),
      );
      if (matchedPhone) {
        return {
          companyId: c.id,
          callerId: matchedPhone.assignedTo ?? null,
          verified: true,
        };
      }

      // Check default caller ID
      if (cfg?.defaultCallerId && sameNumber(cfg.defaultCallerId, target)) {
        const admin = allUsers.find((u) => u.companyId === c.id && (u.role === "admin" || u.role === "superadmin"));
        return {
          companyId: c.id,
          callerId: admin?.id ?? null,
          verified: true,
        };
      }

      // Check assigned numbers list
      if (Array.isArray(cfg?.assignedNumbers) && cfg.assignedNumbers.some((n) => sameNumber(n, target))) {
        const admin = allUsers.find((u) => u.companyId === c.id && (u.role === "admin" || u.role === "superadmin"));
        return {
          companyId: c.id,
          callerId: admin?.id ?? null,
          verified: true,
        };
      }
    }

    // Check individual users by phone or SIP credential
    for (const u of allUsers) {
      if (u.phone && sameNumber(u.phone, target)) {
        return {
          companyId: u.companyId ?? null,
          callerId: u.id,
          verified: true,
        };
      }
      if (u.sipCredentials?.username && (u.sipCredentials.username === parsedTo.cleaned || u.sipCredentials.username === parsedTo.sipUser)) {
        return {
          companyId: u.companyId ?? null,
          callerId: u.id,
          verified: true,
        };
      }
    }
  }

  // 5. Signature verification across configured company public keys
  if (rawBody && signatureHeader && timestampHeader) {
    for (const c of allCompanies) {
      const cfg = (c.settings?.telnyx || {}) as { webhookPublicKey?: string };
      if (cfg.webhookPublicKey) {
        const valid = verifyTelnyxSignature(rawBody, signatureHeader, timestampHeader, cfg.webhookPublicKey);
        if (valid) {
          const admin = allUsers.find((u) => u.companyId === c.id);
          return {
            companyId: c.id,
            callerId: admin?.id ?? null,
            verified: true,
          };
        }
      }
    }
  }

  // 6. Fallback for single-tenant installs
  const withTelnyx = allCompanies.filter((c) => {
    const cfg = (c.settings || {}).telnyx as { apiKey?: string } | undefined;
    return Boolean(cfg?.apiKey);
  });
  if (withTelnyx.length === 1) {
    const admin = allUsers.find((u) => u.companyId === withTelnyx[0].id);
    return {
      companyId: withTelnyx[0].id,
      callerId: admin?.id ?? null,
      verified: false,
    };
  }

  if (allCompanies.length === 1) {
    const admin = allUsers.find((u) => u.companyId === allCompanies[0].id);
    return {
      companyId: allCompanies[0].id,
      callerId: admin?.id ?? null,
      verified: false,
    };
  }

  return { companyId: null, callerId: null, verified: false };
}

/**
 * Find which company owns a phone number (backward-compatible wrapper).
 */
export async function findCompanyIdByPhoneNumber(rawNumber: string): Promise<number | null> {
  const res = await resolveCompanyAndCallerForWebhook({ to: rawNumber });
  return res.companyId;
}
