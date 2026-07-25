#!/usr/bin/env node
/**
 * Salesvora process supervisor — plain Node, no dependencies.
 *
 * Run from cron every minute:
 *   * * * * * /opt/alt/alt-nodejs24/root/usr/bin/node ~/salesvora-data/keepalive.cjs
 *
 * WHY THIS EXISTS
 * ---------------
 * Everything here used to live in scripts/api-proxy.php, because a web request
 * into PHP was the only thing on this plan that could start a process. That put
 * the most failure-prone logic in the least testable place, and it showed:
 * the checkout locator silently resolved to a different domain on the account,
 * the shell spawn was called with the wrong signature for the only shell
 * function the host leaves enabled, and every one of those bugs presented
 * identically as "the API returns 503".
 *
 * With cron available, Node supervises itself. This file is ordinary
 * JavaScript: it can be read, run by hand (`node keepalive.cjs --status`) and
 * reasoned about, and PHP no longer needs to know how to build an environment
 * or find a build. The proxy keeps only the one job it is actually needed for,
 * forwarding HTTP, because LiteSpeed owns port 443.
 *
 * It also removes a recurring operational trap. Environment variables are read
 * once at spawn, so seeding an admin or resetting a password used to require
 * someone to remember to restart Node by hand. Cron notices the process is gone
 * and brings it back within a minute, so dropping app_admin_reset and waiting
 * is enough.
 *
 * CommonJS on purpose: it must run from any directory, under whatever Node the
 * host provides, with no package.json in scope.
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.SALESVORA_PORT || '3000', 10);
const HOST = '127.0.0.1';
const CONNECT_TIMEOUT_MS = 2000;

/** The account home, resolved without depending on any checkout existing. */
function accountHome() {
  return process.env.HOME || os.homedir() || null;
}

function dataDir() {
  const home = accountHome();
  return home ? path.join(home, 'salesvora-data') : null;
}

/**
 * Locate the server bundle.
 *
 * The data-directory mirror is preferred, and that ordering matters: Hostinger
 * DELETES .builds/source/repository once a deploy finishes, so the checkout is
 * present only briefly. The deploy writes both copies from the same build in
 * the same run, so the mirror is never staler than the checkout — it is simply
 * the one that still exists later.
 */
function findBootScript() {
  const candidates = [];
  const dir = dataDir();
  if (dir) candidates.push(path.join(dir, 'boot.js'));

  const home = accountHome();
  if (home) {
    const domains = path.join(home, 'domains');
    let entries = [];
    try {
      entries = fs.readdirSync(domains);
    } catch {
      entries = [];
    }
    for (const d of entries) {
      candidates.push(
        path.join(domains, d, 'public_html/.builds/source/repository/dist/boot.js'),
      );
    }
  }

  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Read an "email:password" credential file, or null. */
function readCredentialFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  // Strip a UTF-8 BOM: file managers add one invisibly and it would otherwise
  // become part of the email address, seeding an account nobody can address.
  const line = raw.replace(/^﻿/, '').trim();
  const sep = line.indexOf(':');
  if (sep === -1) return null;
  // Both halves trimmed: "you@example.com: secret" is how anyone naturally
  // writes a pair, and storing " secret" produces a password that silently
  // never matches anything typeable.
  const email = line.slice(0, sep).trim();
  const password = line.slice(sep + 1).trim();
  if (!email || !password) return null;
  return { email, password };
}

/**
 * The environment the server needs. Mirrors what api-proxy.php used to build,
 * with the same rule: nothing persistent may live inside the checkout, which
 * every deploy replaces.
 */
function buildEnv() {
  const dir = dataDir();
  const env = {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'production',
  };
  if (!dir) return env;

  fs.mkdirSync(dir, { recursive: true });
  env.DB_JSON_PATH = path.join(dir, 'db.json');
  env.MAIL_DB_PATH = path.join(dir, 'mailsender.db');

  // APP_SECRET signs session tokens; the app refuses to start in production
  // without one. Generated once and persisted outside the web root so it
  // survives deploys — regenerating it invalidates every session cookie in
  // every browser at once.
  const secretFile = path.join(dir, 'app_secret');
  try {
    if (!fs.existsSync(secretFile)) {
      fs.writeFileSync(secretFile, require('crypto').randomBytes(32).toString('hex'), {
        mode: 0o600,
      });
    }
    const secret = fs.readFileSync(secretFile, 'utf8').trim();
    if (secret) env.APP_SECRET = secret;
  } catch (err) {
    console.error('[keepalive] could not read/create app_secret:', err.message);
  }

  // Bootstrap superadmin for an empty database.
  const seed = readCredentialFile(path.join(dir, 'app_admin'));
  if (seed) {
    env.ADMIN_EMAIL = seed.email;
    env.ADMIN_PASSWORD = seed.password;
  }

  // Password recovery for an account that already exists. The app deletes the
  // file once applied, so this clears itself.
  const resetFile = path.join(dir, 'app_admin_reset');
  const reset = readCredentialFile(resetFile);
  if (reset) {
    env.ADMIN_RESET_EMAIL = reset.email;
    env.ADMIN_RESET_PASSWORD = reset.password;
    env.ADMIN_RESET_FILE = resetFile;
  }
  return env;
}

/** True when something is already listening on the app port. */
function isRunning() {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(result);
    };
    sock.setTimeout(CONNECT_TIMEOUT_MS);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(PORT, HOST);
  });
}

function logPath() {
  const dir = dataDir();
  return dir ? path.join(dir, 'salesvora.log') : path.join(os.tmpdir(), 'salesvora.log');
}

function start() {
  const script = findBootScript();
  if (!script) {
    console.error('[keepalive] no boot.js found — cannot start. Has a deploy completed?');
    process.exitCode = 1;
    return;
  }

  const file = logPath();
  let out;
  try {
    out = fs.openSync(file, 'a');
  } catch {
    out = 'ignore';
  }

  // Detached with the parent's stdio released, so the server outlives this
  // one-minute cron invocation instead of dying with it.
  const child = spawn(process.execPath, [script], {
    cwd: path.dirname(script),
    env: buildEnv(),
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  console.log(`[keepalive] started ${script} (pid ${child.pid})`);
}

async function main() {
  if (process.argv.includes('--status')) {
    const running = await isRunning();
    console.log(
      JSON.stringify(
        {
          running,
          port: PORT,
          node: process.execPath,
          data_dir: dataDir(),
          boot_script: findBootScript(),
          log: logPath(),
          admin_seed_file: fs.existsSync(path.join(dataDir() || '', 'app_admin')),
          admin_reset_file: fs.existsSync(path.join(dataDir() || '', 'app_admin_reset')),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (await isRunning()) {
    if (process.argv.includes('--verbose')) console.log('[keepalive] already running');
    return;
  }
  start();
}

main().catch((err) => {
  console.error('[keepalive] failed:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
