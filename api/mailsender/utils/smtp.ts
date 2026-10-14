import nodemailer from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import { tlsOptionsFor } from './security';

// Many ISPs and office/home networks block outbound SMTP on 465 (and 25) but
// leave 587 / 2525 open. Instead of failing with "port blocked, use a VPN",
// every send tries the account's configured port first and then the other
// submission ports. The port that worked is remembered per host so later
// sends go straight to it.

const TIMEOUTS = { connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 30000 };
const FALLBACK_PORTS = [465, 587, 2525];
const workingPort = new Map<string, number>();

export const SMTP_CONNECTION_ERROR =
  /ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|ESOCKET|EHOSTUNREACH|ENETUNREACH|timeout|timed out|Connection closed|Greeting never received|Network is unreachable/i;

export function isSmtpConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as any)?.code ? String((err as any).code) : '';
  return SMTP_CONNECTION_ERROR.test(msg) || SMTP_CONNECTION_ERROR.test(code);
}

function baseConfig(account: any): { host: string; port: number; auth: any; tls?: any; service?: string } {
  const esp = String(account.esp || '').toLowerCase();
  if (esp === 'google') {
    return { host: 'smtp.gmail.com', port: 465, auth: { user: account.email, pass: account.app_password } };
  }
  if (esp === 'microsoft') {
    return {
      host: 'smtp.office365.com', port: 587,
      auth: { user: account.email, pass: account.app_password },
      tls: { ciphers: 'SSLv3' },
    };
  }
  return {
    host: String(account.smtp_host || '').trim(),
    port: parseInt(account.smtp_port || '465', 10) || 465,
    auth: { user: account.smtp_user || account.email, pass: account.smtp_pass },
    tls: tlsOptionsFor(account),
  };
}

/** Ports to try, in order: last known-good, configured, then the rest. */
function portOrder(host: string, configured: number): number[] {
  const order = [workingPort.get(host), configured, ...FALLBACK_PORTS].filter(Boolean) as number[];
  return [...new Set(order)];
}

/**
 * Send one email through the account's SMTP server, automatically falling
 * back to other submission ports (465 ⇄ 587 ⇄ 2525) when the network blocks
 * the configured one. Auth / recipient errors are thrown immediately.
 */
export async function sendAccountMail(account: any, mail: SendMailOptions) {
  const cfg = baseConfig(account);
  const ports = portOrder(cfg.host, cfg.port);
  let lastErr: unknown;

  for (const port of ports) {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port,
      secure: port === 465,      // 465 = implicit TLS, others = STARTTLS
      requireTLS: port !== 465,  // never send credentials in plain text
      auth: cfg.auth,
      tls: { ...(cfg.tls || {}), servername: cfg.host },
      ...TIMEOUTS,
    });
    try {
      const info = await transport.sendMail(mail);
      if (port !== cfg.port) {
        console.log(`[smtp] ${cfg.host}:${cfg.port} unreachable — delivered via fallback port ${port}`);
      }
      workingPort.set(cfg.host, port);
      return info;
    } catch (err) {
      lastErr = err;
      transport.close();
      if (!isSmtpConnectionError(err)) throw err;
      if (workingPort.get(cfg.host) === port) workingPort.delete(cfg.host);
      console.warn(`[smtp] ${cfg.host}:${port} failed (${err instanceof Error ? err.message : err}) — trying next port`);
    }
  }

  console.error(`[smtp] ${cfg.host} unreachable on ports ${ports.join(', ')}:`, lastErr instanceof Error ? lastErr.message : lastErr);
  const e = new Error(
    `This network is blocking outgoing email (tried ${cfg.host} on ports ${ports.join(', ')}). ` +
    `Emails send normally from the live server; to send from this computer, use a VPN or another network.`
  );
  (e as any).code = 'ESMTPUNREACHABLE';
  throw e;
}
