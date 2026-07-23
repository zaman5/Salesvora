// ─────────────────────────────────────────────────────────────────────────────
// Shared security helpers for the Mail Sender sub-app.
//
// Everything in here exists to close a confirmed vulnerability; each export
// documents which one. Keep this module dependency-free (node builtins + db)
// so it can be imported from routes, the cron worker and the warmup engine
// alike without creating import cycles.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import dns from 'node:dns';
import net from 'node:net';

// ─── Server secret ───────────────────────────────────────────────────────────
// Reused from the main app's APP_SECRET so the owner has only one secret to
// rotate. The fallback matches api/lib/env.ts so dev/prod behave identically.
const APP_SECRET = process.env.APP_SECRET || 'salesvora-default-secret-change-me';

// ═════════════════════════════════════════════════════════════════════════════
// 1. Tracking-link HMAC  (fixes: unauthenticated open-tracking / unsubscribe)
// ═════════════════════════════════════════════════════════════════════════════
// The tracking + unsubscribe endpoints must stay publicly reachable (they are
// hit by mail clients that have no session), so the authorization has to travel
// *in the URL*. We append a short HMAC over (kind, campaignId, leadId) keyed by
// the server secret. Without it, the sequential integer ids let anyone loop
// /unsubscribe/1/1 … and unsubscribe every lead in every campaign, or inflate
// open counts arbitrarily.
export function trackingToken(kind: 'open' | 'unsub', campaignId: string | number, leadId: string | number): string {
  return crypto
    .createHmac('sha256', APP_SECRET)
    .update(`${kind}:${campaignId}:${leadId}`)
    .digest('hex')
    .slice(0, 20); // 80 bits — far beyond brute-forceable for this threat model
}

export function verifyTrackingToken(
  kind: 'open' | 'unsub',
  campaignId: string | number,
  leadId: string | number,
  supplied: unknown,
): boolean {
  if (typeof supplied !== 'string' || supplied.length === 0) return false;
  const expected = trackingToken(kind, campaignId, leadId);
  // Constant-time compare so the token can't be recovered byte-by-byte.
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. Trusted public base URL  (fixes: attacker-controlled tracking base URL)
// ═════════════════════════════════════════════════════════════════════════════
// The tracking pixel / unsubscribe href used to be built from a client-supplied
// `req.body.origin`, which let any caller point their own campaign's beacons at
// a server they control. The base URL is now purely server-side configuration;
// the request is only ever used as a last-resort fallback for local dev.
export function getTrackingBaseUrl(fallbackProto?: string, fallbackHost?: string): string {
  const configured = process.env.BACKEND_URL || process.env.PUBLIC_URL || '';
  if (configured) return configured.replace(/\/+$/, '');
  // Dev fallback: the host/proto Express itself saw. Never req.body.
  const proto = fallbackProto || 'http';
  const host = fallbackHost || 'localhost:5000';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. SSRF guard  (fixes: authenticated internal port scanner via SMTP/IMAP host)
// ═════════════════════════════════════════════════════════════════════════════
// "Add account" / "test connection" connect to a fully user-supplied host:port.
// Without this check an authenticated tenant can probe the internal network and
// the cloud metadata service (169.254.169.254) and read the outcome from the
// distinct ECONNREFUSED / ETIMEDOUT / ENOTFOUND error strings.
//
// We resolve the hostname and validate the *resolved addresses*, not the string,
// so `evil.example.com A 127.0.0.1` is rejected too.

function ipv4IsPrivate(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true; // malformed → reject
  const [a, b] = p;
  if (a === 0) return true;                          // 0.0.0.0/8 "this network"
  if (a === 10) return true;                         // 10.0.0.0/8 private
  if (a === 127) return true;                        // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true;             // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true;                         // multicast + reserved
  return false;
}

function ipv6IsPrivate(ip: string): boolean {
  const s = ip.toLowerCase().split('%')[0]; // strip zone id
  if (s === '::1' || s === '::') return true;                    // loopback / unspecified
  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible forms
  const mapped = s.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4IsPrivate(mapped[1]);
  if (/^f[cd][0-9a-f]{2}:/.test(s)) return true;                 // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(s)) return true;                 // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(s)) return true;                    // ff00::/8 multicast
  return false;
}

function addressIsPrivate(address: string, family: number): boolean {
  return family === 6 ? ipv6IsPrivate(address) : ipv4IsPrivate(address);
}

/**
 * Throws if `host` resolves to (or literally is) a private / loopback /
 * link-local address. Call this before opening any user-directed connection.
 */
export async function assertPublicHost(host: string): Promise<void> {
  const h = (host || '').trim().replace(/^\[|\]$/g, '');
  if (!h) throw new SsrfBlockedError('Host is required.');

  // Literal IP: no DNS needed.
  const literalFamily = net.isIP(h);
  if (literalFamily) {
    if (addressIsPrivate(h, literalFamily)) throw new SsrfBlockedError();
    return;
  }

  // Obvious local names that may not even resolve publicly.
  if (/^(localhost|.*\.local|.*\.internal|.*\.localdomain)$/i.test(h)) {
    throw new SsrfBlockedError();
  }

  let results: Array<{ address: string; family: number }>;
  try {
    results = await dns.promises.lookup(h, { all: true });
  } catch {
    // Unresolvable: fail closed with the same generic message so this can't be
    // used as an existence oracle either.
    throw new SsrfBlockedError();
  }
  if (!results.length) throw new SsrfBlockedError();
  // ALL resolved addresses must be public — a multi-A-record host that mixes a
  // public and an internal IP is still a rebinding vector.
  for (const r of results) {
    if (addressIsPrivate(r.address, r.family)) throw new SsrfBlockedError();
  }
}

export class SsrfBlockedError extends Error {
  constructor(message = 'Could not connect to that mail server. Check the host and port.') {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

// ─── Uniform network-error message ───────────────────────────────────────────
// Genuine AUTH failures keep their specific, useful text (the owner relies on
// "invalid credentials" / "app password required"); every *network-level*
// outcome collapses to one identical string so the endpoint stops being an
// internal-network mapping oracle.
export const GENERIC_NETWORK_ERROR =
  'Could not connect to that mail server. Check the host and port.';

const NETWORK_ERROR_MARKERS = [
  'econnrefused', 'etimedout', 'timeout', 'timed out', 'enotfound', 'getaddrinfo',
  'econnreset', 'connection reset', 'ehostunreach', 'enetunreach', 'eai_again',
  'socket close', 'esockettimedout', 'eproto', 'epipe',
];

/** True when `msg` describes a transport-level failure rather than an auth failure. */
export function isNetworkLevelError(msg: string): boolean {
  const m = (msg || '').toLowerCase();
  return NETWORK_ERROR_MARKERS.some(k => m.includes(k));
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. TLS policy  (fixes: rejectUnauthorized:false on every outbound connection)
// ═════════════════════════════════════════════════════════════════════════════
// Certificate verification is now ON by default. Google/Microsoft always verify
// (their certs are valid — there is no legitimate reason to skip). Custom /
// self-hosted SMTP can opt out per account via the `tls_insecure` column, which
// db.ts grandfathers to 1 for accounts that already existed before this change
// so the owner's live mailboxes keep working unchanged.
//
// Set MAILSENDER_STRICT_TLS=1 to force verification even for grandfathered rows.
export function accountAllowsInvalidCert(account: any): boolean {
  if (process.env.MAILSENDER_STRICT_TLS === '1') return false;
  const esp = String(account?.esp || '').toLowerCase();
  if (esp === 'google' || esp === 'microsoft') return false; // always verify
  return Number(account?.tls_insecure ?? 0) === 1;
}

/** nodemailer/imapflow `tls` options honouring the per-account policy above. */
export function tlsOptionsFor(account: any, extra: Record<string, unknown> = {}) {
  return { rejectUnauthorized: !accountAllowsInvalidCert(account), ...extra };
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. Safe account column list  (fixes: SMTP/IMAP passwords returned to browser)
// ═════════════════════════════════════════════════════════════════════════════
// Never `SELECT *` from email_accounts for an HTTP response — that ships
// app_password / smtp_pass / smtp_user / smtp_host to the browser. Server-side
// code that actually opens a connection still reads the full row directly.
const PUBLIC_ACCOUNT_FIELDS = [
  'id', 'user_id', 'first_name', 'last_name', 'email', 'esp', 'status', 'sent',
  'limit_per_day', 'warmup', 'bounce', 'reply_rate', 'campaigns',
  'spf', 'dkim', 'dmarc', 'mx', 'smtp_port', 'imap_port',
  'warmup_status', 'warmup_settings_json', 'tls_insecure', 'created_at',
];

/**
 * Column list for account rows sent to the client. Excludes app_password,
 * smtp_pass, smtp_user, smtp_host and imap_host. Adds a `has_password` flag so
 * the UI can still tell whether credentials are stored.
 *
 * @param prefix optional table alias, e.g. 'ea' → "ea.id, ea.email, …"
 */
export function publicAccountColumns(prefix = ''): string {
  const p = prefix ? `${prefix}.` : '';
  const cols = PUBLIC_ACCOUNT_FIELDS.map(c => `${p}${c}`);
  cols.push(
    `(CASE WHEN COALESCE(${p}app_password,'') <> '' OR COALESCE(${p}smtp_pass,'') <> '' THEN 1 ELSE 0 END) AS has_password`,
  );
  return cols.join(', ');
}

/** Normalises the SQL integer flags into booleans for the JSON response. */
export function toPublicAccount<T extends Record<string, any>>(row: T): T & { hasPassword: boolean; allowInvalidCert: boolean } {
  const { has_password, ...rest } = row as any;
  return {
    ...(rest as T),
    hasPassword: Number(has_password ?? 0) === 1,
    allowInvalidCert: Number((row as any).tls_insecure ?? 0) === 1,
  };
}

export function toPublicAccounts(rows: any[]): any[] {
  return rows.map(toPublicAccount);
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. Request-body size caps  (fixes: unbounded lead arrays)
// ═════════════════════════════════════════════════════════════════════════════
export const MAX_LEADS_PER_REQUEST = 10000;
