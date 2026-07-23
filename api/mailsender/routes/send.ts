import { Router } from 'express';
import type { Response, Request } from 'express';
import nodemailer from 'nodemailer';
import db from '../db';
import { requireAuth } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { extractInlineImages } from '../utils/inlineImages';
import { trackingToken, verifyTrackingToken, getTrackingBaseUrl, tlsOptionsFor } from '../utils/security';

const router = Router();

// ─── 1×1 transparent GIF ────────────────────────────────────────────────────
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// ─── Concurrency lock: only ONE run per campaign at a time ──────────────────
const runningCampaigns = new Set<string>();

// ─── Template variables ──────────────────────────────────────────────────────
export function applyVariables(text: string, lead: any, account: any, signature: string): string {
  // Spintax: {{random|A|B|C}}
  text = text.replace(/\{\{random\|([^}]+)\}\}/g, (_: string, opts: string) => {
    const choices = opts.split('|');
    return choices[Math.floor(Math.random() * choices.length)];
  });
  const name       = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.name || lead.email;
  const senderName = [account.first_name, account.last_name].filter(Boolean).join(' ') || account.email;
  const vars: Record<string, string> = {
    '{{first_name}}':       lead.first_name || name.split(' ')[0] || '',
    '{{last_name}}':        lead.last_name  || name.split(' ').slice(1).join(' ') || '',
    '{{full_name}}':        name,
    '{{email}}':            lead.email || '',
    '{{company}}':          lead.company || '',
    '{{job_title}}':        lead.title || '',
    '{{phone}}':            lead.phone || '',
    '{{city}}':             lead.city || '',
    '{{state}}':            lead.state || '',
    '{{country}}':          lead.country || '',
    '{{linkedin_url}}':     lead.linkedin_url || '',
    '{{sender_name}}':      senderName,
    // Convert \n to <br> so multi-line signatures render correctly in HTML email
    '{{sender_signature}}': (signature || senderName).replace(/\r?\n/g, '<br>'),
  };
  for (const [key, val] of Object.entries(vars)) {
    text = text.split(key).join(val);
  }
  return text;
}

function stripHtml(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function makeTransport(account: any): nodemailer.Transporter {
  const timeoutConfig = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 };
  
  if (account.esp === 'Google') {
    return nodemailer.createTransport({ service: 'gmail', auth: { user: account.email, pass: account.app_password }, ...timeoutConfig });
  }
  if (account.esp === 'Microsoft') {
    return nodemailer.createTransport({
      host: 'smtp.office365.com', port: 587, secure: false,
      auth: { user: account.email, pass: account.app_password },
      tls: { ciphers: 'SSLv3' },
      ...timeoutConfig
    });
  }
  const port = parseInt(account.smtp_port || '587', 10);
  return nodemailer.createTransport({
    host: account.smtp_host, port, secure: port === 465,
    auth: { user: account.smtp_user || account.email, pass: account.smtp_pass },
    // Verify the server certificate unless this specific account opted out.
    tls: tlsOptionsFor(account),
    ...timeoutConfig
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Open Tracking Pixel ─────────────────────────────────────────────────────
// GET /api/send/track/open/:campaignId/:leadId?t=<hmac>
//
// SECURITY: intentionally unauthenticated — mail clients have no session — but
// the ids are sequential integers, so without a token anyone could loop them to
// forge open statistics. The `t` HMAC (server secret over campaignId+leadId) is
// the authorization. An unsigned/incorrect request still gets a valid pixel back
// (so nothing looks broken in a mail client) but records nothing.
router.get('/track/open/:campaignId/:leadId', (req: Request, res: Response) => {
  const campaignId = req.params.campaignId as string;
  const leadId = req.params.leadId as string;
  const tokenOk = verifyTrackingToken('open', campaignId, leadId, req.query.t);
  try {
    // Only count FIRST open per lead-step to avoid inflating numbers
    const lead = tokenOk
      ? db.prepare('SELECT opened FROM campaign_leads WHERE id=? AND campaign_id=?').get(leadId, campaignId) as any
      : null;
    if (lead) {
      db.prepare('UPDATE campaign_leads SET opened=opened+1 WHERE id=? AND campaign_id=?').run(leadId, campaignId);
      db.prepare('UPDATE campaigns SET opens=opens+1 WHERE id=?').run(campaignId);
      console.log(`[Track] Open recorded: lead=${leadId} campaign=${campaignId} (total opens=${lead.opened + 1})`);
    }
  } catch (e) {
    console.error('[Track] Error recording open:', e);
  }
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': TRACKING_PIXEL.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache', 'Expires': '0',
  });
  res.end(TRACKING_PIXEL);
});

// ─── Unsubscribe Tracking ────────────────────────────────────────────────────
// GET /api/send/unsubscribe/:campaignId/:leadId?t=<hmac>
//
// SECURITY: publicly reachable by design (recipients click it from their inbox),
// but the sequential ids previously let anyone walk /unsubscribe/1/1,1/2,… and
// mass-unsubscribe every lead in every campaign. The `t` HMAC is the
// authorization; without a valid one we do not mutate anything.
router.get('/unsubscribe/:campaignId/:leadId', (req: Request, res: Response) => {
  const page = (heading: string, detail: string) =>
    `<html><body style="font-family:sans-serif;text-align:center;padding:50px;"><h2>${heading}</h2><p>${detail}</p></body></html>`;

  if (!verifyTrackingToken('unsub', req.params.campaignId as string, req.params.leadId as string, req.query.t)) {
    return res.status(400).send(page(
      'This unsubscribe link is not valid.',
      'Please use the link exactly as it appears in the email, or reply to the sender to be removed.',
    ));
  }
  try {
    db.prepare("UPDATE campaign_leads SET status='Unsubscribed' WHERE id=? AND campaign_id=?").run(req.params.leadId, req.params.campaignId);
    res.send(page('You have been unsubscribed.', 'You will no longer receive emails from this campaign.'));
  } catch(e) {
    res.send(page('Error processing request.', ''));
  }
});

// ─── Activate / Validate ─────────────────────────────────────────────────────
// POST /api/send/campaign/:id/activate
router.post('/campaign/:id/activate', requireAuth, async (req: AuthRequest, res: Response) => {
  const campaignId = req.params.id as string;
  const c = db.prepare('SELECT * FROM campaigns WHERE id=? AND user_id=?').get(campaignId, req.userId) as any;
  if (!c) return res.status(404).json({ error: 'Campaign not found' });

  const accounts: any[] = db.prepare(
    `SELECT ea.id FROM campaign_accounts ca JOIN email_accounts ea ON ea.id=ca.account_id WHERE ca.campaign_id=?`
  ).all(campaignId);

  const seqRow = db.prepare('SELECT steps_json FROM campaign_sequences WHERE campaign_id=?').get(campaignId) as any;
  const steps  = seqRow?.steps_json ? (() => { try { return JSON.parse(seqRow.steps_json); } catch { return []; } })() : [];

  // Count leads that still have pending steps (not Bounced/Replied, AND step_index < total steps)
  const totalSteps   = steps.length;
  const allLeads     = db.prepare("SELECT * FROM campaign_leads WHERE campaign_id=?").all(campaignId) as any[];
  const pendingLeads = allLeads.filter(l => 
    !['Bounced', 'Replied', 'Completed'].includes(l.status) && (l.step_index ?? 0) < totalSteps
  );

  const warnings: string[] = [];
  if (!accounts.length)    warnings.push('No email accounts assigned — go to Settings tab');
  if (!steps.length)       warnings.push('No email sequence — go to Sequences tab and write your email');
  if (!pendingLeads.length && allLeads.length === 0) warnings.push('No leads found — go to Leads tab and add leads');
  // NOTE: Don't warn "no pending leads" if all leads already completed — that's fine!

  db.prepare("UPDATE campaigns SET status='active' WHERE id=?").run(campaignId);

  res.json({
    success: true,
    ready: warnings.length === 0,
    warnings,
    accounts: accounts.length,
    steps: steps.length,
    pendingLeads: pendingLeads.length,
    totalLeads: allLeads.length,
  });
});

import { isCampaignWithinSchedule, getLocalMidnightTimestamp, parseTime } from '../utils/schedule';

// ─── Main Sending Engine ─────────────────────────────────────────────────────

// `_reqOrigin` is accepted only for call-site compatibility and is NEVER used —
// the tracking base URL comes from server config. See getTrackingBaseUrl.
export async function runCampaignEngine(campaignId: string, userId: number, _reqOrigin?: string, reqHost?: string, reqProto?: string): Promise<{ started: boolean, message: string, leads?: number, accounts?: number }> {
  // ── Concurrency guard: prevent double-run ──────────────────────────────────
  if (runningCampaigns.has(campaignId)) {
    return { started: false, message: 'Campaign is already sending. Wait for the current batch to finish.' };
  }

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id=? AND user_id=?').get(campaignId, userId) as any;
  if (!campaign)                       return { started: false, message: 'Campaign not found' };
  if (campaign.status !== 'active')    return { started: false, message: 'Campaign is paused. Toggle it ON first.' };

  // Scoped by ea.user_id too (defense in depth) — sending must only ever use
  // email accounts owned by the campaign's own user.
  const allAccounts: any[] = db.prepare(`
    SELECT ea.* FROM campaign_accounts ca
    JOIN email_accounts ea ON ea.id = ca.account_id
    WHERE ca.campaign_id = ? AND ea.user_id = ?
  `).all(campaignId, userId);
  if (!allAccounts.length) return { started: false, message: 'No email accounts assigned. Go to Settings → Sending Email Accounts.' };

  // ── Shuffle accounts randomly so different accounts are used each run ─────
  const accounts = [...allAccounts].sort(() => Math.random() - 0.5);

  const seqRow = db.prepare('SELECT steps_json, schedule_json FROM campaign_sequences WHERE campaign_id=?').get(campaignId) as any;
  const steps: any[] = seqRow?.steps_json ? (() => { try { return JSON.parse(seqRow.steps_json); } catch { return []; } })() : [];
  if (!steps.length) return { started: false, message: 'No sequence steps. Go to Sequences tab and write your email.' };

  // ── Enforce Schedule Window ───────────────────────────────────────────────
  const schedCheck = isCampaignWithinSchedule(seqRow?.schedule_json);
  if (!schedCheck.allowed) {
    return { started: false, message: `Queued: ${schedCheck.reason}` };
  }

  const schedule: any = seqRow?.schedule_json ? (() => { try { return JSON.parse(seqRow.schedule_json); } catch { return {}; } })() : {};
  const maxEmails    = parseInt(schedule.maxEmails || '100');
  const deliveryMode = schedule.deliveryMode || 'random';
  const quickMinutes = parseFloat(schedule.quickMinutes || '60');
  const customMs     = deliveryMode === 'custom'
    ? parseFloat(schedule.customInterval || '2') * (schedule.customUnit === 'seconds' ? 1000 : schedule.customUnit === 'hours' ? 3600000 : 60000)
    : 0;

  const rawTz = schedule.timezone || 'UTC';
  const tzParts = rawTz.split(' ');
  const tz = tzParts[0]; // e.g., 'Asia/Karachi'
  const midnightToday = getLocalMidnightTimestamp(tz);

  // Check how many emails sent today
  const sentTodayRow = db.prepare('SELECT COUNT(*) as count FROM campaign_sends WHERE campaign_id = ? AND sent_at >= ?').get(campaignId, midnightToday) as any;
  const sentToday = sentTodayRow?.count || 0;
  const remainingEmailsToday = Math.max(0, maxEmails - sentToday);

  if (remainingEmailsToday <= 0) {
    return { started: false, message: `Daily sending limit of ${maxEmails} emails reached for today.` };
  }

  // Check how many new leads sent today
  const maxLeadsStr = schedule.maxLeads;
  const maxLeads = maxLeadsStr && maxLeadsStr.trim() !== '' ? parseInt(maxLeadsStr, 10) : Infinity;

  const newLeadsSentTodayRow = db.prepare(`
    SELECT COUNT(*) as count FROM campaign_sends 
    WHERE campaign_id = ? AND step_index = 0 AND sent_at >= ?
  `).get(campaignId, midnightToday) as any;
  const newLeadsSentToday = newLeadsSentTodayRow?.count || 0;

  let remainingNewLeadsToday = Math.max(0, maxLeads - newLeadsSentToday);

  const sigRow    = db.prepare('SELECT signature FROM user_settings WHERE user_id=?').get(userId) as any;
  const signature = sigRow?.signature || '';

  // ── Tracking pixel URL: MUST be public (not localhost) ────────────────────
  // SECURITY: this used to fall back to a client-supplied `req.body.origin`,
  // which let any caller point every tracking beacon and unsubscribe link in
  // their outgoing mail at a server they control. It is now derived purely from
  // server config (BACKEND_URL / PUBLIC_URL), falling back to the host Express
  // itself observed. The client value is ignored entirely.
  const backendUrl = getTrackingBaseUrl(reqProto, reqHost);

  // Parse Settings
  const settings = campaign.settings_json ? (() => { try { return JSON.parse(campaign.settings_json); } catch { return {}; } })() : {};
  const safety = settings.safety || {};
  const openTracking = safety.openTracking ?? false;
  const unsubLink    = safety.unsubLink ?? false;
  const variationMode = settings.variationMode === 'match-initial' ? 'match-initial' : 'roundrobin';

  // ── Get only leads that STILL have pending steps ──────────────────────────
  const totalSteps = steps.length;
  const now = Date.now();
  const candidates: any[] = (db.prepare(`
    SELECT * FROM campaign_leads
    WHERE campaign_id=?
      AND status NOT IN ('Bounced', 'Completed', 'Replied')
      AND (step_index IS NULL OR step_index < ?)
      AND (
        -- New leads (step 0): always ready, next_step_at starts at 0
        (step_index IS NULL OR step_index = 0)
        OR
        -- Follow-up steps: only ready when next_step_at was explicitly set AND is in the past
        (step_index > 0 AND next_step_at IS NOT NULL AND next_step_at > 0 AND next_step_at <= ?)
      )
    ORDER BY step_index DESC, created_at ASC
  `).all(campaignId, totalSteps, now) as any[]);

  // Filter in memory to respect limits & prioritize follow-up steps
  const leads: any[] = [];
  let newLeadsCount = 0;

  for (const lead of candidates) {
    if (leads.length >= remainingEmailsToday) {
      break;
    }
    const stepIdx = lead.step_index ?? 0;
    if (stepIdx === 0) {
      if (newLeadsCount < remainingNewLeadsToday) {
        leads.push(lead);
        newLeadsCount++;
      }
    } else {
      leads.push(lead);
    }
  }

  if (!leads.length) {
    return { started: false, message: 'All leads have been contacted or daily limits reached. No pending leads remaining for today.' };
  }

  // ── Background Execution Context ───────────────────────────────────────────
  // We return immediately to the caller, and execute the loop asynchronously
  const responseObj = {
    started: true,
    leads: leads.length,
    accounts: accounts.length,
    message: `✅ Sending step emails to ${leads.length} lead(s) via ${accounts.length} account(s). Performance column updates live.`,
  };

  // ── Lock BEFORE launching async worker to prevent race-condition double-sends ──
  runningCampaigns.add(campaignId);

  // Launch async worker
  (async () => {
  try {
    let baseDelayMs = 2000;
    if (deliveryMode === 'quick') {
      baseDelayMs = Math.max(1000, (quickMinutes * 60 * 1000) / Math.max(1, maxEmails));
    } else if (deliveryMode === 'custom') {
      baseDelayMs = customMs;
    }

    for (let i = 0; i < leads.length; i++) {
      const lead    = leads[i];
      const account = accounts[i % accounts.length]; // round-robin

      const stepIdx = lead.step_index ?? 0;

      // Double-check: skip if step already done (guard against race conditions)
      if (stepIdx >= totalSteps) {
        db.prepare("UPDATE campaign_leads SET status='Completed' WHERE id=?").run(lead.id);
        continue;
      }

      // Re-verify campaign is within its schedule window before sending each email
      const windowCheck = isCampaignWithinSchedule(seqRow?.schedule_json);
      if (!windowCheck.allowed) {
        console.log(`[Campaign ${campaignId}] Out of schedule window: ${windowCheck.reason}. Suspending batch.`);
        break;
      }

      const step       = steps[stepIdx];
      const variations = step.variations || [];
      if (variations.length === 0) continue;
      // "Round Robin" spreads variations evenly across this send batch; "Match
      // Initial Variation" keeps each lead on the same variation letter for
      // every step by deriving it from their own (stable) lead id.
      const variationIdx = variationMode === 'match-initial'
        ? lead.id % variations.length
        : i % variations.length;
      const variation = variations[variationIdx];
      if (!variation?.subject && !variation?.body) continue;

      const subject = applyVariables(variation.subject || '(no subject)', lead, account, signature);
      let   html    = applyVariables(variation.body    || '', lead, account, signature);
      const text    = stripHtml(html);

      // Embed tracking pixel
      if (openTracking) {
        // Signed so the open cannot be forged by walking sequential ids.
        const openTok = trackingToken('open', campaignId, lead.id);
        const pixel = `<img src="${backendUrl}/api/mail/send/track/open/${campaignId}/${lead.id}?t=${openTok}" width="1" height="1" style="display:none;border:none;outline:none" alt="" />`;
        html = html.includes('</body>') ? html.replace('</body>', `${pixel}</body>`) : html + pixel;
      }

      // Add Unsubscribe link
      if (unsubLink) {
        // Signed so the link cannot be forged to mass-unsubscribe other leads.
        const unsubTok = trackingToken('unsub', campaignId, lead.id);
        const unsubUrl = `${backendUrl}/api/mail/send/unsubscribe/${campaignId}/${lead.id}?t=${unsubTok}`;
        const unsubHtml = `<br><br><div style="font-size:11px;color:#888;">If you no longer wish to receive these emails, you may <a href="${unsubUrl}" style="color:#888;text-decoration:underline;">unsubscribe here</a>.</div>`;
        html = html.includes('</body>') ? html.replace('</body>', `${unsubHtml}</body>`) : html + unsubHtml;
      }

      const senderName = [account.first_name, account.last_name].filter(Boolean).join(' ') || account.email;

      // Delay between emails
      if (i > 0) {
        let wait = baseDelayMs;
        if (deliveryMode === 'random') {
          // Re-calculate remaining minutes and remaining emails to send today to be dynamically self-adjusting
          const freshSched = db.prepare('SELECT schedule_json FROM campaign_sequences WHERE campaign_id=?').get(campaignId) as any;
          const currentSchedule = freshSched?.schedule_json ? JSON.parse(freshSched.schedule_json) : {};
          const currentMaxEmails = parseInt(currentSchedule.maxEmails || '100');
          
          const freshSentTodayRow = db.prepare('SELECT COUNT(*) as count FROM campaign_sends WHERE campaign_id = ? AND sent_at >= ?').get(campaignId, midnightToday) as any;
          const freshSentToday = freshSentTodayRow?.count || 0;
          const freshRemainingEmails = Math.max(1, currentMaxEmails - freshSentToday);
          
          // Re-calculate remaining minutes
          const freshParts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
          }).formatToParts(new Date());
          const fp: Record<string, string> = {};
          for (const part of freshParts) fp[part.type] = part.value;
          const freshCurrentMinutes = parseInt(fp.hour, 10) * 60 + parseInt(fp.minute, 10);
          const freshEndMins = parseTime(currentSchedule.endTime || '6:00 PM');
          const freshRemainingMins = Math.max(1, freshEndMins - freshCurrentMinutes);
          
          const avgIntervalMs = (freshRemainingMins * 60 * 1000) / freshRemainingEmails;
          const minDelay = avgIntervalMs * 0.3;
          const maxDelay = avgIntervalMs * 1.0;
          wait = Math.max(2000, Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay);
        }
        if (wait > 0) {
          console.log(`[Campaign ${campaignId}] Waiting ${Math.round(wait / 1000)}s before next send...`);
          await sleep(wait);
        }
      }

      // Re-check campaign is still active before each send
      const fresh = db.prepare('SELECT status FROM campaigns WHERE id=?').get(campaignId) as any;
      if (fresh?.status !== 'active') {
        console.log(`[Campaign ${campaignId}] Paused at lead ${i + 1}/${leads.length}`);
        break;
      }

      // Also re-check the lead hasn't been modified by another process
      const freshLead = db.prepare('SELECT step_index, status FROM campaign_leads WHERE id=?').get(lead.id) as any;
      if (!freshLead || ['Bounced', 'Completed', 'Replied'].includes(freshLead.status) || (freshLead.step_index ?? 0) > stepIdx) {
        console.log(`[Campaign ${campaignId}] Skipping lead ${lead.email} — already processed`);
        continue;
      }

      try {
        const { html: inlinedHtml, attachments } = extractInlineImages(html);
        const transport = makeTransport(account);
        await transport.sendMail({
          from:    `"${senderName}" <${account.email}>`,
          to:      lead.email,
          attachments,
          subject,
          html: inlinedHtml,
          text,
        });

        const nextStep  = stepIdx + 1;
        const newStatus = nextStep >= totalSteps ? 'Completed' : 'In Progress';

        // Calculate exact timestamp when the next step is allowed to send.
        // NOTE: SequenceBuilder stores delay as 'waitDays' (integer days) — use that field.
        let nextStepAt = 0;
        if (nextStep < totalSteps) {
          const ns = steps[nextStep];
          // Support both field names for backward compatibility
          const waitDays = parseFloat(ns.waitDays ?? ns.delayDays ?? '0') || 0;
          const waitMinutes = parseFloat(ns.delayMinutes ?? '0') || 0;
          const delayMs = (waitDays * 86400000) + (waitMinutes * 60000);
          // Minimum 60 seconds to prevent instant resend on next cron tick
          nextStepAt = Date.now() + Math.max(delayMs, 60000);
        }

        // ── Per-lead counters (this is the only place that increments them) ──
        db.prepare('UPDATE campaign_leads SET sent=sent+1, step_index=?, status=?, next_step_at=? WHERE id=?')
          .run(nextStep, newStatus, nextStepAt, lead.id);
        // ── Campaign-level counter ──
        db.prepare('UPDATE campaigns SET sent=sent+1 WHERE id=?').run(campaignId);

        // ── Record send in campaign_sends ──
        db.prepare('INSERT INTO campaign_sends (campaign_id, account_id, lead_id, step_index, sent_at) VALUES (?, ?, ?, ?, ?)')
          .run(campaignId, account.id, lead.id, stepIdx, Date.now());

        console.log(`[Campaign ${campaignId}] ✅ Step ${stepIdx + 1}/${totalSteps} → ${lead.email} (${account.email})`);

    } catch (err: any) {
        console.error(`[Campaign ${campaignId}] ❌ Failed ${lead.email}: ${err?.message}`);
        db.prepare("UPDATE campaign_leads SET status='Bounced' WHERE id=?").run(lead.id);
        db.prepare('UPDATE campaigns SET bounced=bounced+1 WHERE id=?').run(campaignId);

        // ── Record send in campaign_sends for failed attempts too ──
        db.prepare('INSERT INTO campaign_sends (campaign_id, account_id, lead_id, step_index, sent_at) VALUES (?, ?, ?, ?, ?)')
          .run(campaignId, account.id, lead.id, stepIdx, Date.now());

        // Auto-pause if bounce rate exceeds threshold
        const stats = db.prepare('SELECT sent, bounced, settings_json FROM campaigns WHERE id=?').get(campaignId) as any;
        if (stats?.sent >= 5) {
          const settings    = stats.settings_json ? (() => { try { return JSON.parse(stats.settings_json); } catch { return {}; } })() : {};
          const threshold   = parseFloat(settings?.bounceThreshold ?? '10');
          const bounceRate  = (stats.bounced / Math.max(stats.sent, 1)) * 100;
          if (bounceRate >= threshold) {
            db.prepare("UPDATE campaigns SET status='paused' WHERE id=?").run(campaignId);
            console.log(`[Campaign ${campaignId}] ⚠️ Auto-paused: bounce rate ${bounceRate.toFixed(1)}% >= ${threshold}%`);
            break;
          }
        }
      }
    }
  } catch (err) {
    console.error(`[Engine] Fatal error in campaign ${campaignId}:`, err);
  } finally {
    // Always release the lock
    runningCampaigns.delete(campaignId);
    // Sync prospects count
    const total = (db.prepare('SELECT COUNT(*) as n FROM campaign_leads WHERE campaign_id=?').get(campaignId) as any).n;
    db.prepare('UPDATE campaigns SET prospects=? WHERE id=?').run(total, campaignId);
    console.log(`[Campaign ${campaignId}] Batch complete`);
  }
  })();

  return responseObj;
}

// POST /api/send/campaign/:id/run
router.post('/campaign/:id/run', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const proto = (req.get('x-forwarded-proto') || req.protocol) as string;
    const host  = (req.get('host')) as string;
    // SECURITY: req.body.origin is deliberately ignored — see getTrackingBaseUrl.
    const campaignId = (req.params.id) as string;
    const result = await runCampaignEngine(campaignId, req.userId!, undefined, host, proto);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to start campaign' });
  }
});

export default router;
