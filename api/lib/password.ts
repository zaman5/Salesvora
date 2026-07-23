import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Password hashing on Node's built-in crypto (scrypt) — deliberately NO external
 * dependency. The Hostinger deploy bundles boot.js with `--packages=external`
 * and does not run `npm install`, so any third-party hashing library (bcryptjs,
 * argon2, …) that isn't already present crashes the process on boot. scrypt is
 * in the Node core, so it is always available.
 *
 * Stored format:  `scrypt:<saltBase64>:<hashBase64>`
 * Legacy accounts still hold plaintext; every read must tell the two apart.
 */

const PREFIX = "scrypt:";
const KEYLEN = 64;
const SALT_BYTES = 16;

/** True when the stored value is already a scrypt digest (not legacy plaintext). */
export function isHashedPassword(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Synchronous hash — used by the first-run JSON seed, which runs before the event loop matters. */
export function hashPasswordSync(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(plain, salt, KEYLEN);
  return `${PREFIX}${salt.toString("base64")}:${derived.toString("base64")}`;
}

/** Async wrapper so callers can keep `await hashPassword(...)`. */
export function hashPassword(plain: string): Promise<string> {
  return Promise.resolve(hashPasswordSync(plain));
}

/**
 * Verify a submitted password against whatever is stored.
 * - scrypt digest   → constant-time comparison of the derived keys
 * - legacy plaintext → direct comparison (never invalidates an existing
 *   password; the caller re-hashes on success to self-migrate the account)
 */
export function verifyPassword(plain: string, stored: unknown): Promise<boolean> {
  if (typeof stored !== "string" || stored.length === 0) return Promise.resolve(false);
  if (!isHashedPassword(stored)) {
    return Promise.resolve(stored === plain);
  }
  try {
    const [saltB64, hashB64] = stored.slice(PREFIX.length).split(":");
    if (!saltB64 || !hashB64) return Promise.resolve(false);
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const derived = scryptSync(plain, salt, expected.length);
    return Promise.resolve(
      expected.length === derived.length && timingSafeEqual(expected, derived),
    );
  } catch {
    return Promise.resolve(false);
  }
}
