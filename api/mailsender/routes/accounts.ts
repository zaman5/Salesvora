import { Router } from 'express';
import type { Response } from 'express';
import nodemailer from 'nodemailer';
import db from '../db';
import { requireAuth } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import {
  assertPublicHost, GENERIC_NETWORK_ERROR, isNetworkLevelError,
  publicAccountColumns, toPublicAccount, toPublicAccounts, tlsOptionsFor,
} from '../utils/security';

const router = Router();

// ─── Friendly error messages ──────────────────────────────────────────────────
// SECURITY: authentication failures keep their specific, actionable text (the
// owner relies on "invalid credentials" / "app password required"), but every
// *network-level* outcome now collapses to one identical message. Previously
// ECONNREFUSED / ETIMEDOUT / ENOTFOUND produced different strings, turning this
// authenticated endpoint into an oracle for mapping internal networks.
function friendlyError(msg: string): string {
  const m = msg.toLowerCase();
  if (
    m.includes('invalid login') ||
    m.includes('username and password not accepted') ||
    m.includes('535') ||
    m.includes('534') ||
    m.includes('badcredentials') ||
    m.includes('authentication failed') ||
    m.includes('auth failed') ||
    m.includes('invalid credentials') ||
    m.includes('login failed') ||
    m.includes('5.7.8') ||
    m.includes('5.7.0')
  ) {
    return 'Invalid credentials. Please check your email address and password.';
  }
  if (m.includes('application-specific password required') || m.includes('app password')) {
    return 'App password required. Enable 2-Step Verification in your Google/Microsoft account and generate an App Password.';
  }
  // Certificate problems are safe to describe — they say nothing about whether
  // a host/port exists, and the owner needs the hint.
  if (m.includes('self signed') || m.includes('certificate') || m.includes('depth_zero') || m.includes('unable to verify')) {
    return 'The mail server presented an invalid TLS certificate. If this is your own server with a self-signed certificate, enable "Allow self-signed certificate" for this account.';
  }
  // Every transport-level failure returns the SAME string — no oracle.
  if (isNetworkLevelError(m)) return GENERIC_NETWORK_ERROR;
  // Fall through: never echo the raw driver message back to the client.
  return GENERIC_NETWORK_ERROR;
}

// NOTE: a hand-rolled low-level SMTP AUTH prober used to live here. It opened a
// raw socket to a fully user-supplied host:port with rejectUnauthorized:false,
// was never called by any route, and duplicated what nodemailer's verify()
// already does. Removed rather than hardened — dead code, real SSRF surface.

// Google/Microsoft app passwords are displayed with spaces for readability
// (e.g. "abcd efgh ijkl mnop") but the real secret has none — pasting them
// as shown breaks auth, so strip all whitespace before ever using one.
function stripPass(p: string | undefined): string {
  return (p || '').replace(/\s+/g, '');
}

// Helper to verify SMTP connection details
async function verifyConnection(body: Record<string, string>): Promise<void> {
  const {
    email, esp,
    smtpHost, smtpPort, smtpUser,
  } = body;
  // Opt-in per-account escape hatch for genuinely self-signed servers.
  const allowInvalidCert = body.allowInvalidCert === true as any || body.allowInvalidCert === 'true' || (body as any).allowInvalidCert === 1;
  const appPassword = stripPass(body.appPassword);
  const smtpPass = stripPass(body.smtpPass);

  if (!email) {
    throw new Error('Email is required');
  }

  // Validate required fields per provider
  if ((esp === 'Google' || esp === 'Microsoft') && !appPassword) {
    throw new Error('App password is required.');
  }
  if (esp === 'SMTP' && (!smtpHost || !smtpPass)) {
    throw new Error('SMTP host and password are required.');
  }

  if (esp === 'Google') {
    // Google: use nodemailer with gmail service (forces proper OAuth/app-pass auth)
    const t = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: email, pass: appPassword },
    });
    await t.verify();

  } else if (esp === 'Microsoft') {
    // Microsoft: use nodemailer with office365
    const t = nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      auth: { user: email, pass: appPassword },
      tls: { ciphers: 'SSLv3' },
    });
    await t.verify();

  } else {
    // Custom SMTP (Ionos, Zoho, custom hosts)
    const port = parseInt(smtpPort || '587', 10);
    const secure = port === 465;

    // IMPORTANT: Ionos and most providers require the FULL email address as username.
    // If smtpUser doesn't contain @, fall back to the email field.
    const user = (smtpUser?.trim() && smtpUser.includes('@'))
      ? smtpUser.trim()
      : email;

    const host = smtpHost.trim();

    // SECURITY (SSRF): the host is fully attacker-controlled. Resolve it and
    // refuse private / loopback / link-local targets BEFORE opening a socket,
    // so this endpoint can't be used to port-scan the internal network or reach
    // the cloud metadata service at 169.254.169.254. We validate the resolved
    // address (not the literal string) to defeat DNS rebinding.
    await assertPublicHost(host);

    console.log(`[verifyConnection] SMTP host=${host} port=${port} secure=${secure} user=${user}`);

    // TLS is verified by default; only skipped when the caller explicitly opted
    // in to a self-signed certificate for this account.
    const tlsOpts = { rejectUnauthorized: !allowInvalidCert, minVersion: 'TLSv1' as const };

    const t = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: smtpPass },
      tls: tlsOpts,
      connectionTimeout: 20000,
      greetingTimeout: 15000,
      socketTimeout: 25000,
    });

    try {
      await t.verify();
    } catch (firstErr: unknown) {
      // If port 465 failed, retry with 587 STARTTLS (or vice versa)
      const altPort = port === 465 ? 587 : 465;
      const altSecure = altPort === 465;
      console.log(`[verifyConnection] Retrying with port ${altPort}...`);
      const t2 = nodemailer.createTransport({
        host,
        port: altPort,
        secure: altSecure,
        auth: { user, pass: smtpPass },
        tls: tlsOpts,
        connectionTimeout: 20000,
        greetingTimeout: 15000,
        socketTimeout: 25000,
      });
      await t2.verify();
    }
  }
}

// ─── POST /api/accounts/test-connection ──────────────────────────────────────
router.post('/test-connection', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await verifyConnection(req.body as Record<string, string>);
    return res.json({ success: true });
  } catch (err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err)) || 'Unknown error';
    console.error('[test-connection] FAILED:', msg);
    return res.status(400).json({ success: false, error: friendlyError(msg) });
  }
});


// ─── GET /api/accounts ───────────────────────────────────────────────────────
router.get('/', requireAuth, (req: AuthRequest, res: Response) => {
  // SECURITY: explicit column list — `SELECT *` shipped app_password, smtp_pass,
  // smtp_user and smtp_host straight to the browser. `has_password` tells the UI
  // that credentials exist without revealing them.
  const rows = db.prepare(
    `SELECT ${publicAccountColumns()} FROM email_accounts WHERE user_id=? ORDER BY created_at DESC`
  ).all(req.userId) as any[];
  res.json(toPublicAccounts(rows));
});

// ─── POST /api/accounts ──────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const {
    firstName, lastName, email, esp,
    appPassword, smtpHost, smtpPort, smtpUser, smtpPass, imapHost, imapPort,
  } = req.body as Record<string, string>;

  if (!email) return res.status(400).json({ error: 'Email is required' });

  const existing = db.prepare('SELECT id FROM email_accounts WHERE user_id=? AND email=?').get(req.userId, email);
  if (existing) return res.status(400).json({ error: 'Account already exists' });

  // Test the connection before saving to database
  try {
    await verifyConnection(req.body as Record<string, string>);
  } catch (err: unknown) {
    const msg = (err instanceof Error ? err.message : String(err)) || 'Unknown error';
    console.error('[add-account] Connection test FAILED:', msg);
    return res.status(400).json({ error: friendlyError(msg) });
  }

  const defaultWarmupSettings = {
    filterTag: 'helpful',
    includeFilterTag: false,
    dailyLimit: 20,
    emailReply: true,
    activeLimit: 1,
    dailyIncrement: 1,
    replyRate: 50,
    personalizedList: '',
    businessType: '',
    universe: '',
    customContent: '',
    signature: '',
    openaiKey: '',
    warmupMode: 'ai',
    customTemplates: []
  };

  const result = db.prepare(`
    INSERT INTO email_accounts
      (user_id, first_name, last_name, email, esp,
       app_password, smtp_host, smtp_port, smtp_user, smtp_pass, imap_host, imap_port, warmup_status, warmup_settings_json, tls_insecure)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paused', ?, ?)
  `).run(
    req.userId,
    firstName   || '',
    lastName    || '',
    email,
    esp         || 'Google',
    stripPass(appPassword),
    smtpHost    || '',
    smtpPort    || '587',
    smtpUser    || '',
    stripPass(smtpPass),
    imapHost    || '',
    imapPort    || '993',
    JSON.stringify(defaultWarmupSettings),
    // New accounts verify TLS by default; only 1 if the owner explicitly ticked
    // "allow self-signed certificate" (and never for Google/Microsoft).
    (req.body as any).allowInvalidCert && esp !== 'Google' && esp !== 'Microsoft' ? 1 : 0
  );

  // Return the sanitised row — never echo the credentials we just stored.
  const account = db.prepare(
    `SELECT ${publicAccountColumns()} FROM email_accounts WHERE id=?`
  ).get(result.lastInsertRowid) as any;
  res.json(toPublicAccount(account));
});

// ─── PATCH /api/accounts/:id — update settings on one account ────────────────
// Used both by the single-account Settings panel and the bulk "Settings" action
// (which calls this once per selected account).
router.patch('/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const acct = db.prepare('SELECT id FROM email_accounts WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!acct) return res.status(404).json({ error: 'Not found' });

  const { firstName, lastName, limitPerDay, status, allowInvalidCert } = req.body as Record<string, unknown>;
  const sets: string[] = [];
  const vals: (string | number)[] = [];

  if (typeof firstName === 'string') { sets.push('first_name=?'); vals.push(firstName); }
  if (typeof lastName === 'string') { sets.push('last_name=?'); vals.push(lastName); }
  if (limitPerDay !== undefined && limitPerDay !== null && limitPerDay !== '') {
    const n = Number(limitPerDay);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'Daily limit must be a positive number' });
    sets.push('limit_per_day=?'); vals.push(n);
  }
  if (status === 'active' || status === 'paused') { sets.push('status=?'); vals.push(status); }
  // Per-account TLS policy. Lets the owner tighten a grandfathered account (or
  // relax a genuinely self-signed one) without a global switch.
  if (typeof allowInvalidCert === 'boolean') { sets.push('tls_insecure=?'); vals.push(allowInvalidCert ? 1 : 0); }

  if (sets.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  vals.push(String(req.params.id), req.userId as number);
  db.prepare(`UPDATE email_accounts SET ${sets.join(', ')} WHERE id=? AND user_id=?`).run(...vals);

  // Sanitised response — no credential columns.
  const updated = db.prepare(
    `SELECT ${publicAccountColumns()} FROM email_accounts WHERE id=?`
  ).get(req.params.id) as any;
  res.json(toPublicAccount(updated));
});

// ─── DELETE /api/accounts/:id ─────────────────────────────────────────────────
router.delete('/:id', requireAuth, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM email_accounts WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// ─── Tags ──────────────────────────────────────────────────────────────────────
// GET /api/accounts/tags — all unique tags for this user + count of accounts per tag
router.get('/tags/all', requireAuth, (req: AuthRequest, res: Response) => {
  const rows = db.prepare(`
    SELECT tag, COUNT(*) as count FROM account_tags WHERE user_id=? GROUP BY tag ORDER BY tag
  `).all(req.userId);
  res.json(rows);
});

// GET /api/accounts/:id/tags — tags for a single account
router.get('/:id/tags', requireAuth, (req: AuthRequest, res: Response) => {
  const rows = db.prepare('SELECT tag FROM account_tags WHERE account_id=? AND user_id=? ORDER BY tag')
    .all(req.params.id, req.userId) as any[];
  res.json(rows.map(r => r.tag));
});

// POST /api/accounts/:id/tags  body: { tags: string[] }  (max 5)
router.post('/:id/tags', requireAuth, (req: AuthRequest, res: Response) => {
  const acct = db.prepare('SELECT id FROM email_accounts WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!acct) return res.status(404).json({ error: 'Not found' });
  const { tags } = req.body as { tags: string[] };
  const cleaned = [...new Set((tags || []).map((t: string) => t.trim()).filter(Boolean))].slice(0, 5);
  db.prepare('DELETE FROM account_tags WHERE account_id=? AND user_id=?').run(acct.id, req.userId);
  const ins = db.prepare('INSERT OR IGNORE INTO account_tags (account_id, user_id, tag) VALUES (?,?,?)');
  for (const tag of cleaned) ins.run(acct.id, req.userId, tag);
  res.json({ success: true, tags: cleaned });
});

// GET /api/accounts/by-tag/:tag — accounts that have this tag
router.get('/by-tag/:tag', requireAuth, (req: AuthRequest, res: Response) => {
  // Sanitised column list — `ea.*` leaked SMTP/IMAP credentials.
  const rows = db.prepare(`
    SELECT ${publicAccountColumns('ea')} FROM account_tags at2
    JOIN email_accounts ea ON ea.id = at2.account_id
    WHERE at2.user_id=? AND at2.tag=?
    ORDER BY ea.email
  `).all(req.userId, req.params.tag) as any[];
  res.json(toPublicAccounts(rows));
});

export default router;
