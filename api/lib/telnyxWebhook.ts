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
 * Compare two phone numbers ignoring formatting. Telnyx always delivers full
 * E.164 ("+15550001234") but numbers saved in Settings may lack the "+" or
 * even the country code — strict toE164 equality silently dropped every
 * inbound SMS in that case. Digits-only comparison, tolerating a missing
 * country-code prefix on the stored side (min 7 digits so short fragments
 * can't false-match).
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
 * Find which company owns a phone number (checked against the company's
 * default caller ID, assigned numbers, and phone-number pool). Needed because
 * this app is multi-tenant but a single shared webhook endpoint receives
 * inbound messages/calls for every company's Telnyx numbers.
 *
 * If no company lists the number but exactly one company has Telnyx
 * configured, the message is routed there instead of being dropped — a
 * single-tenant install shouldn't lose client replies just because the
 * number was never added under Settings → Phone Numbers.
 */
export async function findCompanyIdByPhoneNumber(rawNumber: string): Promise<number | null> {
  const target = toE164(rawNumber);
  if (!target) return null;
  const allCompanies = await findAllCompanies() as Array<{ id: number; settings?: Record<string, unknown> }>;
  for (const c of allCompanies) {
    const settings = c.settings || {};
    const cfg = settings.telnyx as { defaultCallerId?: string; assignedNumbers?: string[] } | undefined;
    if (cfg?.defaultCallerId && sameNumber(cfg.defaultCallerId, target)) return c.id;
    if (Array.isArray(cfg?.assignedNumbers) && cfg.assignedNumbers.some((n) => sameNumber(n, target))) return c.id;
    const phones = settings.phoneNumbers as Array<{ number?: string }> | undefined;
    if (Array.isArray(phones) && phones.some((p) => sameNumber(p.number, target))) return c.id;
  }
  const withTelnyx = allCompanies.filter((c) => {
    const cfg = (c.settings || {}).telnyx as { apiKey?: string } | undefined;
    return Boolean(cfg?.apiKey);
  });
  if (withTelnyx.length === 1) return withTelnyx[0].id;
  if (allCompanies.length === 1) return allCompanies[0].id;
  return null;
}
