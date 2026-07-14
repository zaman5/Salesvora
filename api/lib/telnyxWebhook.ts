import { createPublicKey, verify as cryptoVerify } from "crypto";
import { findAllCompanies } from "../queries/companies";
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
 * Find which company owns a phone number (checked against the company's
 * default caller ID, assigned numbers, and phone-number pool). Needed because
 * this app is multi-tenant but a single shared webhook endpoint receives
 * inbound messages/calls for every company's Telnyx numbers.
 */
export async function findCompanyIdByPhoneNumber(rawNumber: string): Promise<number | null> {
  const target = toE164(rawNumber);
  if (!target) return null;
  const allCompanies = await findAllCompanies();
  for (const c of allCompanies as Array<{ id: number; settings?: Record<string, unknown> }>) {
    const settings = c.settings || {};
    const cfg = settings.telnyx as { defaultCallerId?: string; assignedNumbers?: string[] } | undefined;
    if (cfg?.defaultCallerId && toE164(cfg.defaultCallerId) === target) return c.id;
    if (Array.isArray(cfg?.assignedNumbers) && cfg.assignedNumbers.some((n) => toE164(n) === target)) return c.id;
    const phones = settings.phoneNumbers as Array<{ number?: string }> | undefined;
    if (Array.isArray(phones) && phones.some((p) => p.number && toE164(p.number) === target)) return c.id;
  }
  return null;
}
