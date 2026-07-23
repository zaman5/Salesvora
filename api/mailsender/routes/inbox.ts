import { Router } from 'express';
import type { Response } from 'express';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import db from '../db';
import { requireAuth } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { extractInlineImages } from '../utils/inlineImages';
import { tlsOptionsFor } from '../utils/security';

const router = Router();

// ─── Friendly send-error messages ─────────────────────────────────────────────
// Turns raw SMTP bounce text into something a non-technical user can act on.
function friendlySendError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('disabled by user from hpanel') || m.includes('disabled by user')) {
    return 'This mailbox has been disabled by your hosting provider (Hostinger hPanel). Log in to hPanel and re-enable the mailbox, then try again.';
  }
  if (m.includes('554') && (m.includes('spam') || m.includes('blocked') || m.includes('blacklist'))) {
    return 'The recipient server blocked this message as spam. Try a different sending account or contact your hosting provider.';
  }
  if (
    m.includes('invalid login') ||
    m.includes('username and password not accepted') ||
    m.includes('535') || m.includes('534') ||
    m.includes('badcredentials') ||
    m.includes('authentication failed') || m.includes('auth failed') ||
    m.includes('invalid credentials') || m.includes('login failed') ||
    m.includes('5.7.8') || m.includes('5.7.0')
  ) {
    return 'Invalid credentials for this account. Check its email/app password in Email Accounts settings.';
  }
  if (m.includes('application-specific password required') || m.includes('app password')) {
    return 'App password required. Enable 2-Step Verification in your Google/Microsoft account and generate an App Password.';
  }
  if (m.includes('econnrefused')) return 'Connection refused. Check that the SMTP host and port are correct.';
  if (m.includes('etimedout') || m.includes('timeout') || m.includes('timed out')) return 'Connection timed out. Check the SMTP host and port.';
  if (m.includes('enotfound') || m.includes('getaddrinfo')) return 'SMTP host not found. Check the host name (e.g. mail.yourdomain.com).';
  if (m.includes('self signed') || m.includes('certificate')) return 'SSL certificate error. Try port 587 instead of 465.';
  if (m.includes('econnreset') || m.includes('connection reset')) return 'Connection was reset by the server. Check host/port settings.';
  return `Failed to send: ${msg}`;
}

// ─── IMAP config helper ───────────────────────────────────────────────────────
function getImapConfig(account: any) {
  const port = parseInt(account.imap_port || '993', 10);
  const esp  = (account.esp || '').toLowerCase();

  // Gmail and Outlook present valid certificates — always verify, no opt-out.
  if (esp === 'google') {
    return { host: 'imap.gmail.com', port: 993, secure: true,
             auth: { user: account.email, pass: account.app_password },
             tls: { rejectUnauthorized: true } };
  }
  if (esp === 'microsoft') {
    return { host: 'outlook.office365.com', port: 993, secure: true,
             auth: { user: account.email, pass: account.app_password },
             tls: { rejectUnauthorized: true } };
  }
  return {
    host:   account.imap_host || `imap.${account.email.split('@')[1]}`,
    port,
    secure: port === 993,
    auth: { user: account.smtp_user || account.email, pass: account.smtp_pass },
    tls: tlsOptionsFor(account),
  };
}

// ─── Resolve spam folder name (Junk, Spam, [Gmail]/Spam, etc.) ────────────────
async function resolveSpamFolder(client: ImapFlow): Promise<string> {
  try {
    const list = await client.list();
    const found = list.find(
      mb => mb.path.toLowerCase().includes('spam') ||
            mb.path.toLowerCase().includes('junk') ||
            (mb.specialUse && mb.specialUse.toLowerCase().includes('junk'))
    );
    if (found) return found.path;
  } catch { /* ignore */ }
  return 'Junk';
}

// ─── Resolve sent folder name (Sent, Sent Items, [Gmail]/Sent Mail, etc.) ─────
async function resolveSentFolder(client: ImapFlow): Promise<string> {
  try {
    const list = await client.list();
    // Prefer specialUse \\Sent first, then path name matching
    const found = list.find(
      mb => (mb.specialUse && mb.specialUse.toLowerCase().includes('sent')) ||
            mb.path.toLowerCase() === 'sent' ||
            mb.path.toLowerCase() === 'sent items' ||
            mb.path.toLowerCase().includes('sent')
    );
    if (found) return found.path;
  } catch { /* ignore */ }
  return 'Sent';
}

// ─── Per-account error backoff (5-min cooldown after repeated failures) ────────
const accountErrorCache = new Map<string, number>();  // accountId -> timestamp of last failure
const ACCOUNT_ERROR_COOLDOWN = 5 * 60_000; // 5 minutes

function isAccountInCooldown(accountId: string | number): boolean {
  const ts = accountErrorCache.get(String(accountId));
  if (!ts) return false;
  if (Date.now() - ts < ACCOUNT_ERROR_COOLDOWN) return true;
  accountErrorCache.delete(String(accountId)); // expired — allow retry
  return false;
}

function markAccountFailed(accountId: string | number) {
  accountErrorCache.set(String(accountId), Date.now());
}

// ─── MIME / body cleaning helpers ────────────────────────────────────────────

/** Decode quoted-printable encoding */
function decodeQP(str: string): string {
  const withoutSoftBreaks = str.replace(/=\r?\n/g, ''); // soft line breaks
  // Rebuild the raw byte sequence first, then decode as UTF-8 once at the end —
  // decoding each =XX escape independently (as a one-off .toString('utf8'))
  // corrupts any multi-byte UTF-8 character (accents, em-dashes, curly quotes)
  // whose bytes are split across separate =XX escapes.
  const bytes: number[] = [];
  for (let i = 0; i < withoutSoftBreaks.length; i++) {
    if (withoutSoftBreaks[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(withoutSoftBreaks.slice(i + 1, i + 3))) {
      bytes.push(parseInt(withoutSoftBreaks.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(withoutSoftBreaks.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Strip HTML tags and decode common entities */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extract HTML and clean text from a raw MIME body (handles RFC822 source + multipart + encodings) */
function extractCleanBody(raw: string): { html: string, text: string } {
  if (!raw || !raw.trim()) return { html: '', text: '' };

  // Inline images (logos, header banners, etc.) referenced from the HTML as
  // src="cid:xxx" — collected here and spliced back into the HTML as data:
  // URIs afterwards, since a plain iframe has no way to resolve a cid: URL.
  const cidImages: Record<string, string> = {};

  // Helper for recursive multipart parsing
  function parseMultipart(bodySection: string, boundary: string): { html: string, plain: string } {
    const escaped  = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts    = bodySection.split(new RegExp(`--${escaped}(?:--)?`));
    let html = '';
    let plain = '';

    for (const part of parts) {
      const pb = part.search(/\r?\n\r?\n/);
      if (pb < 0) continue;
      const ph  = part.slice(0, pb).replace(/\r?\n[ \t]+/g, ' '); // unfold
      const pct = (ph.match(/Content-Type:\s*([^;\r\n]+)/i)?.[1] || '').trim().toLowerCase();
      const pce = (ph.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)?.[1] || '').trim().toLowerCase();
      let   pb2 = part.slice(pb).replace(/^\r?\n\r?\n/, '').trimEnd();

      // Inline image/attachment with a Content-ID — keep its base64 payload
      // intact (do NOT run it through the text decoders below) so it can be
      // embedded directly as a data: URI.
      if (pct.startsWith('image/')) {
        const cid = ph.match(/Content-ID:\s*<?([^>\r\n]+)>?/i)?.[1]?.trim();
        if (cid) {
          const b64 = pce === 'base64' ? pb2.replace(/\s+/g, '') : Buffer.from(pb2, 'binary').toString('base64');
          cidImages[cid] = `data:${pct};base64,${b64}`;
        }
        continue;
      }

      if (pce === 'quoted-printable') pb2 = decodeQP(pb2);
      else if (pce === 'base64')      pb2 = Buffer.from(pb2.replace(/\s+/g, ''), 'base64').toString('utf8');

      if (pct === 'text/plain') {
        if (!plain) plain = pb2;
      } else if (pct === 'text/html') {
        if (!html) html = pb2;
      } else if (pct.startsWith('multipart/')) {
        const subBoundaryMatch = ph.match(/boundary="?([^"\s;]+)"?/i);
        if (subBoundaryMatch) {
          const sub = parseMultipart(pb2, subBoundaryMatch[1]);
          if (sub.html && !html) html = sub.html;
          if (sub.plain && !plain) plain = sub.plain;
        }
      }
    }
    return { html, plain };
  }

  /** Replace src="cid:xxx" (and url(cid:xxx) in inline CSS) with the matching data: URI. */
  function inlineCidImages(html: string): string {
    if (!html || Object.keys(cidImages).length === 0) return html;
    return html.replace(/cid:([^"'()\s]+)/gi, (match, cid) => cidImages[cid] || match);
  }

  // ── If this looks like a full RFC822 message, split headers from body ──
  const isFullMessage = /^(Return-Path|Received|MIME-Version|Content-Type|From|Date|Message-Id):/im.test(raw.slice(0, 3000));
  let headerSection = '';
  let bodySection = raw;

  if (isFullMessage) {
    // Find the first blank line (headers/body separator)
    const crlfBlank = raw.indexOf('\r\n\r\n');
    const lfBlank   = raw.indexOf('\n\n');
    let splitAt = -1;
    let splitLen = 2;
    if (crlfBlank !== -1 && (lfBlank === -1 || crlfBlank <= lfBlank)) { splitAt = crlfBlank; splitLen = 4; }
    else if (lfBlank !== -1) { splitAt = lfBlank; splitLen = 2; }

    if (splitAt > 0) {
      headerSection = raw.slice(0, splitAt);
      bodySection   = raw.slice(splitAt + splitLen);
    }
  }

  // ── Extract Content-Type and CTE from headers ──
  const unfoldHeader = (s: string) => s.replace(/\r?\n[ \t]+/g, ' ');
  const unfolded = unfoldHeader(headerSection || raw.slice(0, 3000));
  const ctMatch  = unfolded.match(/^Content-Type:\s*([^;\r\n]+)/im);
  const cteMatch = unfolded.match(/^Content-Transfer-Encoding:\s*([^\r\n]+)/im);
  const topCt    = (ctMatch?.[1]  || 'text/plain').trim().toLowerCase();
  const topCte   = (cteMatch?.[1] || '').trim().toLowerCase();
  const boundaryMatch = unfolded.match(/boundary="?([^"\s;]+)"?/i);

  let htmlText = '';
  let plainText = '';

  // ── Multipart ──
  if (topCt.startsWith('multipart/') && boundaryMatch) {
    const parsed = parseMultipart(bodySection, boundaryMatch[1]);
    htmlText = parsed.html;
    plainText = parsed.plain;
  } else {
    // ── Single-part ──
    let text = bodySection;
    if (topCte === 'quoted-printable' || (!topCte && /=[0-9A-Fa-f]{2}/.test(text))) {
      text = decodeQP(text);
    } else if (topCte === 'base64') {
      text = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
    }

    if (topCt === 'text/html' || /\<[a-zA-Z]/.test(text)) {
      htmlText = text;
    } else {
      plainText = text;
    }
  }

  let finalHtml = '';
  let finalFieldText = '';

  if (htmlText) {
    finalHtml = inlineCidImages(htmlText);
    finalFieldText = stripHtml(finalHtml);
  } else if (plainText) {
    finalHtml = `<div>${plainText.replace(/\r?\n/g, '<br>')}</div>`;
    finalFieldText = plainText;
  }

  const cleanPreview = removeQuotedThread(finalFieldText);

  return {
    html: finalHtml.trim(),
    text: cleanPreview.trim()
  };
}

/** Remove quoted reply thread — keep only the newest message */
function removeQuotedThread(text: string): string {
  const lines  = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd();

    // Stop at "On [date]...[person] wrote:" attribution line
    if (/^On .{5,}, \d{4}[\s\S]{0,60}wrote:?\s*$/i.test(trimmed)) break;
    if (/^On (Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(trimmed))        break;

    // Skip quoted lines (start with >)
    if (/^>/.test(trimmed)) continue;

    // Stop at common Outlook/Gmail quote separators
    if (/^-{3,}.*Original Message.*-{3,}/i.test(trimmed)) break;
    if (/^_{5,}$/.test(trimmed)) break;

    result.push(lines[i]);
  }

  return result.join('\n').trim().replace(/\n{3,}/g, '\n\n');
}

/** Sanitize subjects containing raw HTML elements or declarations */
function sanitizeSubject(subject: string, preview?: string): string {
  if (!subject) return '(no subject)';
  const s = subject.trim();
  // Check if subject starts with or contains raw HTML markers/tags
  if (/^(<!DOCTYPE|<html|<div|<body|<p|<head|<title)/i.test(s) || s.includes('<html') || s.includes('<!DOCTYPE')) {
    if (preview && preview.trim()) {
      const cleanPrev = preview.replace(/\s+/g, ' ').trim();
      const words = cleanPrev.split(' ').slice(0, 10).join(' ');
      return words ? words + (cleanPrev.split(' ').length > 10 ? '...' : '') : '(no subject)';
    }
    return '(no subject)';
  }
  return s;
}

// ─── SQLite-backed persistent inbox cache ────────────────────────────────────

function upsertEmail(email: any, userId: number) {
  // ID includes userId to ensure complete per-user isolation in inbox_cache
  const rowId = `${userId}-${email.accountId}-${email.uid}`;
  const r = db.prepare(`
    INSERT INTO inbox_cache
      (id, user_id, account_id, account_email, folder, uid, sender_name, sender_email,
       subject, preview, body, date_raw, unread, starred, spam, synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id, account_id, folder, uid) DO UPDATE SET
      unread=excluded.unread, starred=excluded.starred, synced_at=excluded.synced_at
  `).run(
    rowId, userId, email.accountId, email.account, email.folder, email.uid,
    email.name, email.email, sanitizeSubject(email.subject, email.preview), email.preview || '',
    email.body ?? null, email.dateRaw,
    email.unread ? 1 : 0, email.starred ? 1 : 0, email.spam ? 1 : 0,
    Date.now()
  );

  // If this is a new incoming email in the INBOX, check if it's a reply from a campaign lead
  if (r.changes > 0 && !email.spam && !email.folder.toLowerCase().includes('sent') && !email.folder.toLowerCase().includes('spam')) {
    const lead = db.prepare('SELECT id, campaign_id, replied FROM campaign_leads WHERE email=? AND user_id=?').get(email.email, userId) as any;
    if (lead && lead.replied === 0) {
      db.prepare("UPDATE campaign_leads SET replied=1, status='Replied' WHERE id=?").run(lead.id);
      db.prepare("UPDATE campaigns SET replies=replies+1 WHERE id=?").run(lead.campaign_id);
      console.log(`[Reply Tracked] Lead ${email.email} replied to campaign ${lead.campaign_id}`);
    }
  }
}


function dbEmailsForFolder(userId: number, folder: string): any[] {
  const rows = db.prepare(
    `SELECT * FROM inbox_cache WHERE user_id=? AND folder=? ORDER BY date_raw DESC`
  ).all(userId, folder) as any[];
  return rows.map(r => ({
    id: r.id, uid: r.uid, folder: r.folder,
    account: r.account_email, accountId: r.account_id,
    name: r.sender_name, email: r.sender_email,
    subject: r.subject, preview: r.preview, body: r.body,
    dateRaw: r.date_raw,
    date: new Date(r.date_raw).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }),
    unread: r.unread === 1, starred: r.starred === 1, spam: r.spam === 1,
    campaign: null,
  }));
}

// Prevent duplicate concurrent syncs per user+folder
const syncInProgress = new Set<string>();

async function syncAccountFolder(userId: number, account: any, imapFolder: string) {
  if (isAccountInCooldown(account.id)) return;
  const config = getImapConfig(account);
  const client = new ImapFlow({ ...config, logger: false } as any);
  try {
    await client.connect();
    let resolvedFolder = imapFolder;
    if (imapFolder === 'Spam') resolvedFolder = await resolveSpamFolder(client);
    if (imapFolder === 'Sent') resolvedFolder = await resolveSentFolder(client);
    const lock = await client.getMailboxLock(resolvedFolder);
    try {
      // Fetch ALL UIDs from last 2 years
      const since = new Date(); since.setFullYear(since.getFullYear() - 2);
      let imapUids: number[] = [];
      try {
        imapUids = (await (client as any).search({ since }, { uid: true })) as number[];
      } catch {
        const mbx = client.mailbox as any;
        const total = mbx?.exists ?? 0;
        if (total > 0) imapUids = Array.from({ length: total }, (_, i) => i + 1);
      }

      // Current cache for this account+folder
      const cached = db.prepare(
        'SELECT uid, id FROM inbox_cache WHERE account_id=? AND folder=? AND user_id=?'
      ).all(account.id, resolvedFolder, userId) as any[];
      const cachedUidSet = new Set<number>(cached.map((r: any) => r.uid));
      const imapUidSet   = new Set<number>(imapUids);

      // 1. Delete emails removed from IMAP
      for (const row of cached) {
        if (!imapUidSet.has(row.uid)) {
          db.prepare('DELETE FROM inbox_cache WHERE id=?').run(row.id);
        }
      }

      // 2. Fetch and store NEW emails
      const newUids = imapUids.filter(u => !cachedUidSet.has(u));
      if (newUids.length > 0) {
        const BATCH = 100;
        for (let i = 0; i < newUids.length; i += BATCH) {
          const batch = newUids.slice(i, i + BATCH);
          for await (const msg of client.fetch(batch, { envelope: true, flags: true }, { uid: true })) {
            const env    = msg.envelope;
            const sender = (env?.from?.[0] as any) || {};
            const flags  = msg.flags ?? new Set<string>();
            const dateVal = env?.date ? new Date(env.date) : new Date(0);
            const isSpam  = resolvedFolder.toLowerCase().includes('spam') || resolvedFolder.toLowerCase().includes('junk');
            upsertEmail({
              id: `${account.id}-${msg.uid}`, uid: msg.uid,
              folder: resolvedFolder, account: account.email, accountId: account.id,
              name:  sender.name || sender.address?.split('@')[0] || 'Unknown',
              email: sender.address || '',
              subject: env?.subject || '(no subject)',
              preview: '', body: null, dateRaw: dateVal.toISOString(),
              unread: !flags.has('\\Seen'), starred: flags.has('\\Flagged'), spam: isSpam,
            }, userId);
          }
        }
      }

      // 3. Update flags for already-cached emails
      const existingUids = imapUids.filter(u => cachedUidSet.has(u));
      if (existingUids.length > 0) {
        for await (const msg of client.fetch(existingUids, { flags: true }, { uid: true })) {
          const flags = msg.flags ?? new Set<string>();
          db.prepare(
            'UPDATE inbox_cache SET unread=?, starred=?, synced_at=? WHERE account_id=? AND folder=? AND uid=? AND user_id=?'
          ).run(!flags.has('\\Seen') ? 1 : 0, flags.has('\\Flagged') ? 1 : 0,
                Date.now(), account.id, resolvedFolder, msg.uid, userId);

        }
      }
    } finally { lock.release(); }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    if (!isAccountInCooldown(account.id)) console.error(`[inbox] sync ${account.email}: ${m}`);
    markAccountFailed(account.id);
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
}

async function backgroundSync(userId: number, accounts: any[], imapFolder: string) {
  const key = `${userId}:${imapFolder}`;
  if (syncInProgress.has(key)) return;
  syncInProgress.add(key);
  try {
    await Promise.allSettled(accounts.map(acc => syncAccountFolder(userId, acc, imapFolder)));
  } finally { syncInProgress.delete(key); }
}


// ─── Fetch body of a single email on-demand ───────────────────────────────────
async function fetchEmailBody(account: any, folder: string, uid: number): Promise<{ body: string, preview: string }> {
  const config = getImapConfig(account);
  const client = new ImapFlow({ ...config, logger: false } as any);
  let body = '';
  let preview = '';
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      let raw = '';

      // Step 1: Try full source first (best to extract top-level headers + boundary)
      try {
        for await (const msg of client.fetch([uid], { source: true } as any, { uid: true })) {
          const src = (msg as any).source;
          if (src) raw = Buffer.isBuffer(src) ? src.toString('utf8') : Buffer.from(src).toString('utf8');
        }
      } catch { /* ignore, try fallback */ }

      // Step 2: Fallback to BODY[TEXT] if source was empty/failed
      if (!raw || !raw.trim()) {
        try {
          for await (const msg of client.fetch([uid], { bodyParts: ['TEXT'] } as any, { uid: true })) {
            const part = msg.bodyParts?.get('TEXT');
            if (part) raw = Buffer.from(part as Uint8Array).toString('utf8');
          }
        } catch { /* ignore */ }
      }

      // Step 3: Fallback to individual numbered parts
      if (!raw || !raw.trim()) {
        try {
          for await (const msg of client.fetch([uid], { bodyParts: ['1', '1.1', '2', 'text', '1.2'] } as any, { uid: true })) {
            for (const key of ['1', '1.1', '2', 'text', '1.2']) {
              const part = msg.bodyParts?.get(key);
              if (part) { raw = Buffer.from(part as Uint8Array).toString('utf8'); break; }
            }
          }
        } catch { /* ignore */ }
      }

      if (raw && raw.trim()) {
        const parsed = extractCleanBody(raw);
        body = parsed.html;
        preview = parsed.text;
      }
    } finally { lock.release(); }
  } catch (err) {
    console.error('[inbox] fetchEmailBody error:', err instanceof Error ? err.message : err);
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
  return { body, preview };
}


// ─── Helper: run an IMAP action on a specific account + folder ────────────────
async function withImap(account: any, folder: string, action: (client: ImapFlow) => Promise<void>) {
  const config = getImapConfig(account);
  const client = new ImapFlow({ ...config, logger: false } as any);
  await client.connect();
  const lock = await client.getMailboxLock(folder);
  try { await action(client); }
  finally { lock.release(); }
  await client.logout();
}

// ─── GET /api/inbox?folder=inbox|spam|sent|starred[&since=ISO] ───────────────
// ─── GET /api/inbox ─────────────────────────────────────────────────────────────────
// 1. Responds INSTANTLY from SQLite cache (ALL historical records)
// 2. Fires background IMAP sync to add new / remove deleted emails
// ?force=true  → clear DB cache first, then sync live from IMAP before responding
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const folderParam = ((req.query.folder as string) || 'inbox').toLowerCase();
  const force       = req.query.force === 'true';
  const sinceParam  = req.query.since as string | undefined;
  const sinceTime   = sinceParam ? new Date(sinceParam).getTime() : NaN;
  const accounts    = db.prepare('SELECT * FROM email_accounts WHERE user_id=?').all(req.userId) as any[];

  // Clean up stale cached emails belonging to deleted or non-existent accounts for this user
  db.prepare(`
    DELETE FROM inbox_cache 
    WHERE user_id = ? 
      AND account_id NOT IN (SELECT id FROM email_accounts WHERE user_id = ?)
  `).run(req.userId, req.userId);

  const imapFolderMap: Record<string, string> = {
    inbox: 'INBOX', spam: 'Spam', sent: 'Sent', starred: 'INBOX',
  };
  const imapFolder = imapFolderMap[folderParam] || 'INBOX';

  const accountList = accounts.map(a => ({
    id: a.id, email: a.email, esp: a.esp,
    name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email,
  }));

  if (force && accounts.length > 0) {
    // ── Force refresh: wipe cache + do live sync NOW (await), then respond ──
    db.prepare('DELETE FROM inbox_cache WHERE user_id=? AND folder=?').run(req.userId, imapFolder);
    await backgroundSync(req.userId!, accounts, imapFolder);
    const fresh = dbEmailsForFolder(req.userId!, imapFolder);
    const result = folderParam === 'starred' ? fresh.filter(e => e.starred) : fresh;
    return res.json({ emails: result, total: result.length, incremental: false, accounts: accountList, fromCache: false });
  }

  // ── Normal: return cached emails immediately ──────────────────────────────
  // When `since` is provided (incremental poll), only return rows newer than
  // that cursor — otherwise every poll re-sends the whole folder, which both
  // wastes bandwidth and makes the client miscount "new unread" as the count
  // of ALL unread mail instead of genuinely new arrivals.
  let cached = dbEmailsForFolder(req.userId!, imapFolder);
  if (folderParam === 'starred') cached = cached.filter(e => e.starred);
  if (!isNaN(sinceTime)) cached = cached.filter(e => new Date(e.dateRaw).getTime() > sinceTime);

  res.json({ emails: cached, total: cached.length, incremental: !isNaN(sinceTime), accounts: accountList, fromCache: true });

  // ── Background IMAP sync (add new, remove deleted, refresh flags) ────────
  if (accounts.length > 0) {
    backgroundSync(req.userId!, accounts, imapFolder).catch(() => {});
  }
});


// ─── GET /api/inbox/message/:accountId/:uid?folder=INBOX ────────────────────
// Load body on demand when user clicks an email (keeps list fast)
// ─── GET /api/inbox/message/:accountId/:uid ───────────────────────────────────
router.get('/message/:accountId/:uid', requireAuth, async (req: AuthRequest, res: Response) => {
  const { accountId, uid } = req.params;
  const folder  = (req.query.folder as string) || 'INBOX';
  const uidNum  = parseInt(uid as string, 10);
  const account = db.prepare('SELECT * FROM email_accounts WHERE id=? AND user_id=?').get(accountId, req.userId) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });
  // Serve cached body instantly ONLY if it is non-empty (empty = parsing failed before)
  const row = db.prepare('SELECT body, preview, subject FROM inbox_cache WHERE account_id=? AND uid=? AND user_id=?').get(accountId, uidNum, req.userId) as any;
  if (row?.body && row.body.trim().length > 0) {
    const cleanSubject = sanitizeSubject(row.subject || '', row.preview || '');
    if (cleanSubject !== row.subject) {
      db.prepare('UPDATE inbox_cache SET subject=? WHERE account_id=? AND uid=? AND user_id=?')
        .run(cleanSubject, accountId, uidNum, req.userId);
    }
    return res.json({ body: row.body, preview: row.preview || '', subject: cleanSubject });
  }
  try {
    const { body, preview } = await fetchEmailBody(account, folder, uidNum);
    // Always persist (even empty) so next fetch knows to re-try via the improved parser
    const dbSubject = row?.subject || '';
    const cleanSubject = sanitizeSubject(dbSubject, preview);
    db.prepare('UPDATE inbox_cache SET body=?, preview=?, subject=? WHERE account_id=? AND uid=? AND user_id=?')
      .run(body || null, preview || '', cleanSubject, accountId, uidNum, req.userId);
    res.json({ body: body || '', preview: preview || '', subject: cleanSubject });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to fetch message' });
  }
});


// ─── POST /api/inbox/mark-read ────────────────────────────────────────────────
router.post('/mark-read', requireAuth, async (req: AuthRequest, res: Response) => {
  const { accountId, uid, folder = 'INBOX' } = req.body as any;
  const account = db.prepare('SELECT * FROM email_accounts WHERE id=? AND user_id=?').get(accountId, req.userId) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });
  db.prepare('UPDATE inbox_cache SET unread=0 WHERE account_id=? AND uid=? AND user_id=?').run(accountId, uid, req.userId);
  withImap(account, folder, async c => { await c.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true } as any); })
    .catch(e => console.error('[inbox] mark-read:', e instanceof Error ? e.message : e));
  res.json({ success: true });
});

// ─── POST /api/inbox/mark-unread ─────────────────────────────────────────────
router.post('/mark-unread', requireAuth, async (req: AuthRequest, res: Response) => {
  const { accountId, uid, folder = 'INBOX' } = req.body as any;
  const account = db.prepare('SELECT * FROM email_accounts WHERE id=? AND user_id=?').get(accountId, req.userId) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });
  db.prepare('UPDATE inbox_cache SET unread=1 WHERE account_id=? AND uid=? AND user_id=?').run(accountId, uid, req.userId);
  withImap(account, folder, async c => { await c.messageFlagsRemove({ uid }, ['\\Seen'], { uid: true } as any); })
    .catch(e => console.error('[inbox] mark-unread:', e instanceof Error ? e.message : e));
  res.json({ success: true });
});


// ─── POST /api/inbox/star ────────────────────────────────────────────────────
router.post('/star', requireAuth, async (req: AuthRequest, res: Response) => {
  const { accountId, uid, starred, folder = 'INBOX' } = req.body as any;
  const account = db.prepare('SELECT * FROM email_accounts WHERE id=? AND user_id=?').get(accountId, req.userId) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });
  try {
    await withImap(account, folder, async (client) => {
      if (starred) {
        await client.messageFlagsAdd({ uid }, ['\\Flagged'], { uid: true } as any);
      } else {
        await client.messageFlagsRemove({ uid }, ['\\Flagged'], { uid: true } as any);
      }
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[inbox] star error:', err instanceof Error ? err.message : err);
    res.json({ success: true });
  }
});

// ─── POST /api/inbox/reply ───────────────────────────────────────────────────
router.post('/reply', requireAuth, async (req: AuthRequest, res: Response) => {
  const { accountId, toEmail, subject, body } = req.body as any;
  const account = db.prepare('SELECT * FROM email_accounts WHERE id=? AND user_id=?').get(accountId, req.userId) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    const esp = (account.esp || '').toLowerCase();
    const smtpConfig: any = esp === 'google'
      ? { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: account.email, pass: account.app_password } }
      : esp === 'microsoft'
        ? { host: 'smtp.office365.com', port: 587, secure: false, auth: { user: account.email, pass: account.app_password } }
        : { host: account.smtp_host, port: parseInt(account.smtp_port || '465', 10),
            secure: parseInt(account.smtp_port || '465', 10) === 465,
            auth: { user: account.smtp_user || account.email, pass: account.smtp_pass },
            tls: tlsOptionsFor(account) };

    const transporter = nodemailer.createTransport(smtpConfig);
    const { html: inlinedHtml, attachments } = extractInlineImages(body);
    await transporter.sendMail({
      from:    account.email,
      to:      toEmail,
      subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
      html:    inlinedHtml,
      text:    stripHtml(body),
      attachments,
    });
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send reply';
    console.error('[inbox] reply error:', msg);
    res.status(400).json({ error: friendlySendError(msg) });
  }
});

// ─── POST /api/inbox/send ────────────────────────────────────────────────────
router.post('/send', requireAuth, async (req: AuthRequest, res: Response) => {
  const { accountId, toEmail, subject, body } = req.body as any;
  const numAccountId = parseInt(accountId, 10);
  const account = db.prepare('SELECT * FROM email_accounts WHERE id=? AND user_id=?').get(numAccountId, req.userId) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    const esp = (account.esp || '').toLowerCase();
    const smtpConfig: any = esp === 'google'
      ? { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: account.email, pass: account.app_password } }
      : esp === 'microsoft'
        ? { host: 'smtp.office365.com', port: 587, secure: false, auth: { user: account.email, pass: account.app_password } }
        : { host: account.smtp_host, port: parseInt(account.smtp_port || '465', 10),
            secure: parseInt(account.smtp_port || '465', 10) === 465,
            auth: { user: account.smtp_user || account.email, pass: account.smtp_pass },
            tls: tlsOptionsFor(account) };

    const transporter = nodemailer.createTransport(smtpConfig);
    const { html: inlinedHtml, attachments } = extractInlineImages(body);
    await transporter.sendMail({
      from:    account.email,
      to:      toEmail,
      subject: subject,
      html:    inlinedHtml,
      text:    stripHtml(body),
      attachments,
    });
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send email';
    console.error('[inbox] send error:', msg);
    res.status(400).json({ error: friendlySendError(msg) });
  }
});

export default router;
