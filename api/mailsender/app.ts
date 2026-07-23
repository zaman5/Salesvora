import express from 'express';
import bodyParser from 'body-parser';
import './db'; // initialize schema/migrations
import accountRoutes from './routes/accounts';
import campaignRoutes from './routes/campaigns';
import leadsRoutes from './routes/leads';
import inboxRoutes from './routes/inbox';
import sendRoutes from './routes/send';
import dashboardRoutes from './routes/dashboard';
import warmupRoutes from './routes/warmup';
import { startCronService } from './cron';

// Background scheduler: active campaign sends + warmup send/receive cycles.
// Same in-process long-lived interval pattern as smsCampaignWorker in api/app.ts.
if (!process.env.VITEST) startCronService();

// Mail Sender's Express sub-app — mounted inside Salesvora's single Node process
// (see api/boot.ts for prod, vite.config.ts for dev) rather than run as a
// separate server, since Hostinger only keeps one Node process alive.
const mailApp = express();

mailApp.use(bodyParser.json({ limit: 52428800 }));
// NOTE: bodyParser.urlencoded was removed. Nothing in this app posts urlencoded
// bodies (the only client is src/features/mailsender/lib/api.js, which always
// sends Content-Type: application/json), and accepting them is precisely what
// made a cross-site auto-submitting <form> able to reach these routes — a plain
// HTML form cannot send application/json, so JSON-only is itself a CSRF barrier.

// ─── CSRF: Origin / Referer check ────────────────────────────────────────────
// Second layer behind SameSite=Lax (api/lib/cookies.ts). Any state-changing
// request must either carry no Origin/Referer at all (same-origin navigations
// and non-browser callers such as curl or the cron worker) or one whose host
// matches the Host header this request arrived on.
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

mailApp.use((req, res, next) => {
  if (!STATE_CHANGING.has(req.method)) return next();

  const stated = req.get('origin') || req.get('referer') || '';
  if (!stated) return next(); // no browser context to compare against

  let statedHost: string;
  try {
    statedHost = new URL(stated).host;
  } catch {
    return res.status(403).json({ error: 'Request blocked: malformed Origin header.' });
  }

  const selfHost = req.get('host') || '';
  // Allow an explicit extra origin if the owner ever needs a real cross-site
  // embed (comma-separated hostnames in MAILSENDER_ALLOWED_ORIGINS).
  const extra = (process.env.MAILSENDER_ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(s => { try { return new URL(s.includes('://') ? s : `https://${s}`).host; } catch { return s; } });

  if (statedHost === selfHost || extra.includes(statedHost)) return next();

  console.warn(`[MailSender] CSRF block: ${req.method} ${req.url} origin=${statedHost} host=${selfHost}`);
  return res.status(403).json({ error: 'Request blocked: cross-site request rejected.' });
});

mailApp.get('/api/mail/health', (_req, res) => res.json({ status: 'ok' }));

mailApp.use('/api/mail/accounts', accountRoutes);
mailApp.use('/api/mail/campaigns', campaignRoutes);
mailApp.use('/api/mail/leads', leadsRoutes);
mailApp.use('/api/mail/inbox', inboxRoutes);
mailApp.use('/api/mail/send', sendRoutes);
mailApp.use('/api/mail/dashboard', dashboardRoutes);
mailApp.use('/api/mail/warmup', warmupRoutes);

export default mailApp;
