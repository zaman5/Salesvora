import { Router } from 'express';
import type { Response } from 'express';
import nodemailer from 'nodemailer';
import db from '../db';
import { requireAuth } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { applyVariables } from './send';
import { extractInlineImages } from '../utils/inlineImages';
import { publicAccountColumns, toPublicAccounts, MAX_LEADS_PER_REQUEST } from '../utils/security';

const router = Router();

// GET /api/campaigns
router.get('/', requireAuth, (req: AuthRequest, res: Response) => {
  const rows = db.prepare('SELECT * FROM campaigns WHERE user_id=? ORDER BY created_at DESC').all(req.userId);
  res.json(rows);
});

// POST /api/campaigns
router.post('/', requireAuth, (req: AuthRequest, res: Response) => {
  const { name } = req.body as { name: string };
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const r = db.prepare('INSERT INTO campaigns (user_id, name, status) VALUES (?, ?, ?)').run(req.userId, name.trim(), 'draft');
  res.json(db.prepare('SELECT * FROM campaigns WHERE id=?').get(r.lastInsertRowid));
});

// GET /api/campaigns/:id
router.get('/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

// PATCH /api/campaigns/:id
router.patch('/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const { status, name, settings_json } = req.body as { status?: string; name?: string; settings_json?: string };
  const c = db.prepare('SELECT * FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE campaigns SET status=?, name=?, settings_json=? WHERE id=?')
    .run(status ?? c.status, name ?? c.name, settings_json ?? c.settings_json, c.id);
  res.json(db.prepare('SELECT * FROM campaigns WHERE id=?').get(c.id));
});

// DELETE /api/campaigns/:id
router.delete('/:id', requireAuth, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM campaigns WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// GET /api/campaigns/:id/analytics — real stats
router.get('/:id/analytics', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });

  const totalLeads   = (db.prepare('SELECT COUNT(*) as n FROM campaign_leads WHERE campaign_id=?').get(c.id) as any).n;
  const replied      = (db.prepare("SELECT COUNT(*) as n FROM campaign_leads WHERE campaign_id=? AND status='Replied'").get(c.id) as any).n;
  const completed    = (db.prepare("SELECT COUNT(*) as n FROM campaign_leads WHERE campaign_id=? AND status='Completed'").get(c.id) as any).n;
  const bounced      = c.bounced || 0;
  const sent         = c.sent    || 0;
  const opens        = c.opens   || 0;

  const replyRate    = sent > 0 ? ((replied / sent) * 100).toFixed(1) : '0.0';
  const bounceRate   = sent > 0 ? ((bounced / sent) * 100).toFixed(1) : '0.0';
  const openRate     = sent > 0 ? ((opens   / sent) * 100).toFixed(1) : '0.0';

  // Check bounce threshold & auto-pause
  let autoPaused = false;
  const settings = c.settings_json ? (() => { try { return JSON.parse(c.settings_json); } catch { return {}; } })() : {};
  const threshold = parseFloat(settings?.bounceThreshold ?? '10');
  if (sent >= 10 && parseFloat(bounceRate) >= threshold && c.status === 'active') {
    db.prepare("UPDATE campaigns SET status='paused' WHERE id=?").run(c.id);
    autoPaused = true;
  }

  res.json({
    sent, opens, replies: replied, bounced, totalLeads, completed,
    replyRate: `${replyRate}%`, bounceRate: `${bounceRate}%`, openRate: `${openRate}%`,
    status: autoPaused ? 'paused' : c.status,
    autoPaused,
    bounceThreshold: threshold,
  });
});

// POST /api/campaigns/:id/analytics/reset — reset counters
router.post('/:id/analytics/reset', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });
  // Reset campaign counters (replies column added via migration in db.ts)
  db.prepare('UPDATE campaigns SET sent=0, opens=0, replies=0, bounced=0 WHERE id=?').run(c.id);
  // Reset ALL lead counters and statuses back to fresh
  db.prepare(`
    UPDATE campaign_leads 
    SET sent=0, opened=0, clicked=0, replied=0, step_index=0, status='In Progress', next_step_at=0
    WHERE campaign_id=?
  `).run(c.id);
  res.json({ success: true });
});

// POST /api/campaigns/send-test
// Send a real test email using one of the user's verified email accounts
router.post('/send-test', requireAuth, async (req: AuthRequest, res: Response) => {
  const { toEmail, subject, body, accountId } = req.body as {
    toEmail: string;
    subject: string;
    body: string;
    accountId?: number;
  };

  if (!toEmail?.includes('@')) return res.status(400).json({ error: 'Valid recipient email is required' });
  if (!subject?.trim())        return res.status(400).json({ error: 'Subject is required' });
  if (!body?.trim())           return res.status(400).json({ error: 'Email body is required' });

  // Pick the account to send from
  let account: any = null;
  if (accountId) {
    account = db.prepare('SELECT * FROM email_accounts WHERE id=? AND user_id=?').get(accountId, req.userId);
  }
  if (!account) {
    account = db.prepare('SELECT * FROM email_accounts WHERE user_id=? LIMIT 1').get(req.userId);
  }
  if (!account) {
    return res.status(400).json({
      error: 'No email account found. Please add an email account first in the Email Accounts section.',
    });
  }

  try {
    let transport: nodemailer.Transporter;

    if (account.esp === 'Google') {
      transport = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: account.email, pass: account.app_password },
      });
    } else if (account.esp === 'Microsoft') {
      transport = nodemailer.createTransport({
        host: 'smtp.office365.com', port: 587, secure: false,
        auth: { user: account.email, pass: account.app_password },
        tls: { ciphers: 'SSLv3' },
      });
    } else {
      const port = parseInt(account.smtp_port || '587', 10);
      transport = nodemailer.createTransport({
        host: account.smtp_host, port, secure: port === 465,
        auth: { user: account.smtp_user || account.email, pass: account.smtp_pass },
        tls: { rejectUnauthorized: false },
      });
    }

    const senderName = [account.first_name, account.last_name].filter(Boolean).join(' ') || account.email;

    // Resolve {{variables}} the same way a real send would, so a test email
    // that still has {{first_name}} etc. in it (e.g. sent straight from the
    // sequence without editing) previews as a recipient would actually see it.
    const sigRow    = db.prepare('SELECT signature FROM user_settings WHERE user_id=?').get(req.userId) as any;
    const signature = sigRow?.signature || '';
    const sampleLead = {
      first_name: 'Alex', last_name: 'Morgan', email: toEmail,
      company: 'Acme Inc', title: 'Marketing Manager',
      phone: '', city: '', state: '', country: '', linkedin_url: '',
    };
    const resolvedSubject = applyVariables(subject, sampleLead, account, signature);
    const resolvedBody    = applyVariables(body, sampleLead, account, signature);
    const { html: inlinedHtml, attachments } = extractInlineImages(resolvedBody.replace(/\n/g, '<br>'));

    await transport.sendMail({
      from:    `"${senderName}" <${account.email}>`,
      to:      toEmail,
      subject: `[TEST] ${resolvedSubject}`,
      html:    inlinedHtml,
      text:    resolvedBody,
      attachments,
    });

    return res.json({
      success: true,
      message: `Test email sent from ${account.email} to ${toEmail}`,
      fromAccount: account.email,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[send-test]', msg);
    return res.status(400).json({ error: `Failed to send: ${msg}` });
  }
});

// ── Campaign Leads ────────────────────────────────────────────────────────────

// GET /api/campaigns/:id/leads
router.get('/:id/leads', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const rows = db.prepare('SELECT * FROM campaign_leads WHERE campaign_id=? ORDER BY created_at ASC').all(req.params.id);
  // Get total steps count so frontend can show step progress
  const seqRow = db.prepare('SELECT steps_json FROM campaign_sequences WHERE campaign_id=?').get(req.params.id) as any;
  const totalSteps = seqRow?.steps_json ? (() => { try { return JSON.parse(seqRow.steps_json).length; } catch { return 1; } })() : 1;
  const enriched = (rows as any[]).map(r => ({ ...r, total_steps: totalSteps }));
  res.json(enriched);
});

// POST /api/campaigns/:id/leads  — bulk upsert (insert or ignore duplicates)
router.post('/:id/leads', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });
  const leads: any[] = Array.isArray(req.body) ? req.body : req.body.leads || [];
  // Cap the batch size — the 50 MB body limit otherwise allowed an unbounded
  // array that pins the event loop inside one synchronous transaction.
  if (leads.length > MAX_LEADS_PER_REQUEST) {
    return res.status(413).json({
      error: `Too many leads in one request. Import at most ${MAX_LEADS_PER_REQUEST.toLocaleString()} leads at a time (received ${leads.length.toLocaleString()}).`,
    });
  }
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO campaign_leads
      (campaign_id, user_id, name, first_name, last_name, email, company, phone, title, city, state, country, linkedin_url, status)
    VALUES
      (@campaign_id, @user_id, @name, @first_name, @last_name, @email, @company, @phone, @title, @city, @state, @country, @linkedin_url, @status)
  `);
  const insert = db.transaction((items: any[]) => {
    let inserted = 0;
    for (const l of items) {
      if (!l.email?.includes('@')) continue;
      const r = stmt.run({
        campaign_id: c.id,
        user_id:     req.userId,
        name:         l.name         || '',
        first_name:   l.first_name   || '',
        last_name:    l.last_name    || '',
        email:        l.email.toLowerCase().trim(),
        company:      l.company      || '',
        phone:        l.phone        || '',
        title:        l.title        || '',
        city:         l.city         || '',
        state:        l.state        || '',
        country:      l.country      || '',
        linkedin_url: l.linkedin_url || '',
        status:       l.status       || 'In Progress',
      });
      if (r.changes) inserted++;
    }
    return inserted;
  });
  const inserted = insert(leads);
  // Update campaign prospects count
  const total = (db.prepare('SELECT COUNT(*) as n FROM campaign_leads WHERE campaign_id=?').get(c.id) as any).n;
  db.prepare('UPDATE campaigns SET prospects=? WHERE id=?').run(total, c.id);
  // Return the stored rows so the client gets the server-assigned ids — without
  // them a freshly-added lead can't be edited or deleted until a full refetch.
  const emails = leads.map(l => l.email?.toLowerCase().trim()).filter(Boolean);
  const rows = emails.length
    ? db.prepare(
        `SELECT * FROM campaign_leads WHERE campaign_id=? AND email IN (${emails.map(() => '?').join(',')})`
      ).all(c.id, ...emails)
    : [];
  res.json({ inserted, total, leads: rows });
});

// DELETE /api/campaigns/:id/leads/:leadId
router.delete('/:id/leads/:leadId', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM campaign_leads WHERE id=? AND campaign_id=?').run(req.params.leadId, c.id);
  const total = (db.prepare('SELECT COUNT(*) as n FROM campaign_leads WHERE campaign_id=?').get(c.id) as any).n;
  db.prepare('UPDATE campaigns SET prospects=? WHERE id=?').run(total, c.id);
  res.json({ success: true, total });
});

// PATCH /api/campaigns/:id/leads/:leadId
router.patch('/:id/leads/:leadId', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });
  
  const { email, firstName, lastName, company, jobTitle, phone, city, status, label, replied } = req.body;

  // Triage-only updates (status / label from the Leads table row menu) carry no
  // contact fields — patch just those columns instead of blanking the record.
  const isContactEdit = email !== undefined;
  if (!isContactEdit) {
    const sets: string[] = [];
    const vals: any[] = [];
    if (status  !== undefined) { sets.push('status=?');  vals.push(status); }
    if (label   !== undefined) { sets.push('label=?');   vals.push(label || null); }
    if (replied !== undefined) { sets.push('replied=?'); vals.push(replied ? 1 : 0); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.leadId, c.id);
    db.prepare(`UPDATE campaign_leads SET ${sets.join(', ')} WHERE id=? AND campaign_id=?`).run(...vals);
    return res.json({ success: true });
  }

  if (!email?.includes('@')) return res.status(400).json({ error: 'A valid email is required' });
  const name = [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0];

  db.prepare(`
    UPDATE campaign_leads
    SET name=?, first_name=?, last_name=?, email=?, company=?, title=?, phone=?, city=?
    WHERE id=? AND campaign_id=?
  `).run(name, firstName || '', lastName || '', email, company || '', jobTitle || '', phone || '', city || '', req.params.leadId, c.id);

  res.json({ success: true });
});

// ── Sequences (stored as JSON blob per campaign) ───────────────────────────────
router.get('/:id/sequences', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });
  const row = db.prepare('SELECT steps_json FROM campaign_sequences WHERE campaign_id=?').get(c.id) as any;
  res.json(row ? JSON.parse(row.steps_json) : []);
});

router.post('/:id/sequences', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });
  const steps = req.body;
  const json = JSON.stringify(steps);
  db.prepare(`
    INSERT INTO campaign_sequences (campaign_id, user_id, steps_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(campaign_id) DO UPDATE SET steps_json=excluded.steps_json, updated_at=CURRENT_TIMESTAMP
  `).run(c.id, req.userId, json);
  res.json({ success: true });
});

// ── User Sender Signature ──────────────────────────────────────────────────────
router.get('/signature/me', requireAuth, (req: AuthRequest, res: Response) => {
  const row = db.prepare('SELECT signature FROM user_settings WHERE user_id=?').get(req.userId) as any;
  res.json({ signature: row?.signature || '' });
});

router.post('/signature/me', requireAuth, (req: AuthRequest, res: Response) => {
  const { signature } = req.body as { signature: string };
  db.prepare(`
    INSERT INTO user_settings (user_id, signature, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET signature=excluded.signature, updated_at=CURRENT_TIMESTAMP
  `).run(req.userId, signature || '');
  res.json({ success: true });
});

// ── Campaign Schedule ──────────────────────────────────────────────────────────
router.get('/:id/schedule', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });
  const row = db.prepare('SELECT schedule_json FROM campaign_sequences WHERE campaign_id=?').get(c.id) as any;
  res.json(row?.schedule_json ? JSON.parse(row.schedule_json) : null);
});

router.post('/:id/schedule', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });
  const json = JSON.stringify(req.body);
  db.prepare(`
    INSERT INTO campaign_sequences (campaign_id, user_id, steps_json, schedule_json, updated_at)
    VALUES (?, ?, '[]', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(campaign_id) DO UPDATE SET schedule_json=excluded.schedule_json, updated_at=CURRENT_TIMESTAMP
  `).run(c.id, req.userId, json);
  res.json({ success: true });
});

// ── Campaign Assigned Accounts ─────────────────────────────────────────────────
// GET  /api/campaigns/:id/accounts  → list full account rows assigned to campaign
router.get('/:id/accounts', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });
  // SECURITY: explicit column list — `ea.*` returned app_password / smtp_pass /
  // smtp_user / smtp_host to the browser.
  const rows = db.prepare(`
    SELECT ${publicAccountColumns('ea')} FROM campaign_accounts ca
    JOIN email_accounts ea ON ea.id = ca.account_id
    WHERE ca.campaign_id = ? AND ea.user_id = ?
  `).all(c.id, req.userId) as any[];
  res.json(toPublicAccounts(rows));
});

// POST /api/campaigns/:id/accounts  body: { accountIds: number[] }
router.post('/:id/accounts', requireAuth, (req: AuthRequest, res: Response) => {
  const c = db.prepare('SELECT id FROM campaigns WHERE id=? AND user_id=?').get(req.params.id, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Not found' });
  const { accountIds } = req.body as { accountIds: number[] };
  // Only assign accounts that actually belong to the requesting user — otherwise
  // a user could attach another user's email_accounts.id to their own campaign,
  // then read that account's stored credentials via GET, or send mail as them.
  const owned = new Set(
    (db.prepare('SELECT id FROM email_accounts WHERE user_id=?').all(req.userId) as any[]).map(a => a.id)
  );
  const validIds = (accountIds || []).filter(aid => owned.has(aid));
  // Replace all existing assignments
  db.prepare('DELETE FROM campaign_accounts WHERE campaign_id=?').run(c.id);
  const insert = db.prepare('INSERT OR IGNORE INTO campaign_accounts (campaign_id, account_id, user_id) VALUES (?,?,?)');
  for (const aid of validIds) {
    insert.run(c.id, aid, req.userId);
  }
  res.json({ success: true, count: validIds.length });
});

export default router;
