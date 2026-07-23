import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

// Vite's SSR module runner (dev mode) evaluates this file without a CJS
// `require` in scope, so a bare `require(...)` throws "require is not
// defined" there even though it works fine under plain Node (prod/boot.ts).
// createRequire gives a real require function regardless of how this module
// itself was loaded.
const require = createRequire(import.meta.url);

const DB_PATH = process.env.MAIL_DB_PATH || process.env.DB_PATH || path.join(process.cwd(), 'data/mailsender.db');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// node:sqlite needs Node 22.5+; Hostinger's pinned Node (.nvmrc: 20) doesn't have it,
// so fall back to better-sqlite3 there. Locally, node:sqlite avoids the native-binary
// signing issue better-sqlite3's prebuilt binary hits under Windows Smart App Control.
type SqliteLike = {
  exec: (sql: string) => void;
  pragma: (sql: string) => void;
  prepare: (sql: string) => any;
  transaction: <T extends (...args: any[]) => any>(fn: T) => (...args: Parameters<T>) => ReturnType<T>;
};

function openDb(): SqliteLike {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(DB_PATH);
    return {
      exec: (sql: string) => raw.exec(sql),
      pragma: (sql: string) => raw.exec(`PRAGMA ${sql}`),
      prepare: (sql: string): any => raw.prepare(sql),
      transaction: <T extends (...args: any[]) => any>(fn: T) => {
        return (...args: Parameters<T>): ReturnType<T> => {
          raw.exec('BEGIN');
          try {
            const result = fn(...args);
            raw.exec('COMMIT');
            return result;
          } catch (e) {
            raw.exec('ROLLBACK');
            throw e;
          }
        };
      },
    };
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const raw = new Database(DB_PATH);
    return {
      exec: (sql: string) => raw.exec(sql),
      pragma: (sql: string) => raw.pragma(sql),
      prepare: (sql: string) => raw.prepare(sql),
      transaction: (fn: any) => raw.transaction(fn),
    };
  }
}

const db = openDb();

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    verified INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS email_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    email TEXT NOT NULL,
    esp TEXT DEFAULT 'Google',
    status TEXT DEFAULT 'active',
    sent INTEGER DEFAULT 0,
    limit_per_day INTEGER DEFAULT 150,
    warmup INTEGER DEFAULT 0,
    bounce TEXT DEFAULT '0%',
    reply_rate TEXT DEFAULT '0%',
    campaigns INTEGER DEFAULT 0,
    spf INTEGER DEFAULT 1,
    dkim INTEGER DEFAULT 1,
    dmarc INTEGER DEFAULT 1,
    mx INTEGER DEFAULT 1,
    app_password TEXT DEFAULT '',
    smtp_host TEXT DEFAULT '',
    smtp_port TEXT DEFAULT '587',
    smtp_user TEXT DEFAULT '',
    smtp_pass TEXT DEFAULT '',
    imap_host TEXT DEFAULT '',
    imap_port TEXT DEFAULT '993',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    sent INTEGER DEFAULT 0,
    opens INTEGER DEFAULT 0,
    replies INTEGER DEFAULT 0,
    bounced INTEGER DEFAULT 0,
    prospects INTEGER DEFAULT 0,
    created_at DATE DEFAULT (date('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS lead_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER,
    user_id INTEGER NOT NULL,
    name TEXT DEFAULT '',
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    email TEXT NOT NULL,
    company TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    title TEXT DEFAULT '',
    city TEXT DEFAULT '',
    state TEXT DEFAULT '',
    country TEXT DEFAULT '',
    linkedin_url TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(list_id, email),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (list_id) REFERENCES lead_lists(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS campaign_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    name TEXT DEFAULT '',
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    email TEXT NOT NULL,
    company TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    title TEXT DEFAULT '',
    city TEXT DEFAULT '',
    state TEXT DEFAULT '',
    country TEXT DEFAULT '',
    linkedin_url TEXT DEFAULT '',
    status TEXT DEFAULT 'In Progress',
    sent INTEGER DEFAULT 0,
    opened INTEGER DEFAULT 0,
    clicked INTEGER DEFAULT 0,
    replied INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, email),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS campaign_sequences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    steps_json TEXT NOT NULL DEFAULT '[]',
    schedule_json TEXT DEFAULT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    signature TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS account_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    tag        TEXT NOT NULL,
    UNIQUE(account_id, tag),
    FOREIGN KEY (account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS campaign_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    account_id  INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    UNIQUE(campaign_id, account_id),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id)  REFERENCES email_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS inbox_cache (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    account_email TEXT NOT NULL,
    folder TEXT NOT NULL,
    uid INTEGER NOT NULL,
    sender_name TEXT DEFAULT '',
    sender_email TEXT DEFAULT '',
    subject TEXT DEFAULT '',
    preview TEXT DEFAULT '',
    body TEXT DEFAULT NULL,
    date_raw TEXT NOT NULL,
    unread INTEGER DEFAULT 1,
    starred INTEGER DEFAULT 0,
    spam INTEGER DEFAULT 0,
    synced_at INTEGER DEFAULT 0,
    UNIQUE(user_id, account_id, folder, uid)
  );
  CREATE TABLE IF NOT EXISTS campaign_sends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    lead_id INTEGER NOT NULL,
    step_index INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id) REFERENCES campaign_leads(id) ON DELETE CASCADE
  );
`);

// ── Migration: rebuild inbox_cache with user_id in UNIQUE constraint ──────────
try {
  const tableInfo = db.prepare("PRAGMA index_list(inbox_cache)").all() as any[];
  const hasUserIdUnique = tableInfo.some((idx: any) => {
    const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all() as any[];
    return cols.some((c: any) => c.name === 'user_id') && cols.some((c: any) => c.name === 'uid');
  });
  if (!hasUserIdUnique) {
    console.log('[MailDB] Migrating inbox_cache to add user_id to unique constraint...');
    db.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS inbox_cache_new (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        account_id INTEGER NOT NULL,
        account_email TEXT NOT NULL,
        folder TEXT NOT NULL,
        uid INTEGER NOT NULL,
        sender_name TEXT DEFAULT '',
        sender_email TEXT DEFAULT '',
        subject TEXT DEFAULT '',
        preview TEXT DEFAULT '',
        body TEXT DEFAULT NULL,
        date_raw TEXT NOT NULL,
        unread INTEGER DEFAULT 1,
        starred INTEGER DEFAULT 0,
        spam INTEGER DEFAULT 0,
        synced_at INTEGER DEFAULT 0,
        UNIQUE(user_id, account_id, folder, uid)
      );
      INSERT OR IGNORE INTO inbox_cache_new
        SELECT id, user_id, account_id, account_email, folder, uid,
               sender_name, sender_email, subject, preview, body, date_raw,
               unread, starred, spam, synced_at
        FROM inbox_cache;
      DROP TABLE inbox_cache;
      ALTER TABLE inbox_cache_new RENAME TO inbox_cache;
      COMMIT;
    `);
    console.log('[MailDB] inbox_cache migration complete.');
  }
} catch (e) {
  console.error('[MailDB] inbox_cache migration error:', e);
}

const credCols = [
  ['app_password', "TEXT DEFAULT ''"],
  ['smtp_host',    "TEXT DEFAULT ''"],
  ['smtp_port',    "TEXT DEFAULT '587'"],
  ['smtp_user',    "TEXT DEFAULT ''"],
  ['smtp_pass',    "TEXT DEFAULT ''"],
  ['imap_host',    "TEXT DEFAULT ''"],
  ['imap_port',    "TEXT DEFAULT '993'"],
];
for (const [col, def] of credCols) {
  try { db.prepare(`ALTER TABLE email_accounts ADD COLUMN ${col} ${def}`).run(); } catch (_) { /* exists */ }
}

const leadsCols: [string, string][] = [
  ['list_id',     'INTEGER'],
  ['user_id',     'INTEGER'],
  ['company',     "TEXT DEFAULT ''"],
  ['phone',       "TEXT DEFAULT ''"],
  ['title',       "TEXT DEFAULT ''"],
  ['city',        "TEXT DEFAULT ''"],
  ['state',       "TEXT DEFAULT ''"],
  ['country',     "TEXT DEFAULT ''"],
  ['linkedin_url',"TEXT DEFAULT ''"],
  ['first_name',  "TEXT DEFAULT ''"],
  ['last_name',   "TEXT DEFAULT ''"],
];
for (const [col, def] of leadsCols) {
  try { db.prepare(`ALTER TABLE leads ADD COLUMN ${col} ${def}`).run(); } catch (_) { /* exists */ }
}

try { db.prepare(`ALTER TABLE campaign_sequences ADD COLUMN schedule_json TEXT DEFAULT NULL`).run(); } catch (_) { /* exists */ }
try { db.prepare(`ALTER TABLE campaign_leads ADD COLUMN next_step_at INTEGER DEFAULT 0`).run(); } catch (_) { /* exists */ }
try { db.prepare(`ALTER TABLE campaigns ADD COLUMN settings_json TEXT DEFAULT NULL`).run(); } catch (_) { /* exists */ }
try { db.prepare(`ALTER TABLE campaigns ADD COLUMN replies INTEGER DEFAULT 0`).run(); } catch (_) { /* exists */ }
try { db.prepare(`ALTER TABLE email_accounts ADD COLUMN warmup_status TEXT DEFAULT 'inactive'`).run(); } catch (_) { /* exists */ }
try { db.prepare(`ALTER TABLE campaign_leads ADD COLUMN step_index INTEGER DEFAULT 0`).run(); } catch (_) { /* exists */ }
// Manual triage label (Interested / Meeting Booked / …) set from the campaign
// Leads table — previously held only in React state, so it was wiped by the
// 8s refresh poll.
try { db.prepare(`ALTER TABLE campaign_leads ADD COLUMN label TEXT DEFAULT NULL`).run(); } catch (_) { /* exists */ }

const trackCols = ['sent INTEGER DEFAULT 0', 'opened INTEGER DEFAULT 0', 'clicked INTEGER DEFAULT 0', 'replied INTEGER DEFAULT 0'];
for (const col of trackCols) {
  try { db.prepare(`ALTER TABLE campaign_leads ADD COLUMN ${col}`).run(); } catch (_) { /* exists */ }
}

['sent', 'opened', 'clicked', 'replied', 'step_index'].forEach(col => {
  db.prepare(`UPDATE campaign_leads SET ${col}=0 WHERE ${col} IS NULL`).run();
});
['sent', 'opens', 'replies', 'bounced'].forEach(col => {
  db.prepare(`UPDATE campaigns SET ${col}=0 WHERE ${col} IS NULL`).run();
});

try {
  db.prepare(`
    UPDATE inbox_cache
    SET subject = '(no subject)'
    WHERE subject LIKE '%<!DOCTYPE%' OR subject LIKE '%<html%' OR subject LIKE '%<div%' OR subject LIKE '%<body%'
  `).run();
} catch (e) {
  console.error('[MailDB] Error cleaning up malformed subjects:', e);
}

try {
  const acctRows = db.prepare('SELECT id, app_password, smtp_pass FROM email_accounts').all() as any[];
  const fixPass = db.prepare('UPDATE email_accounts SET app_password=?, smtp_pass=? WHERE id=?');
  for (const r of acctRows) {
    const cleanApp  = (r.app_password || '').replace(/\s+/g, '');
    const cleanSmtp = (r.smtp_pass    || '').replace(/\s+/g, '');
    if (cleanApp !== r.app_password || cleanSmtp !== r.smtp_pass) {
      fixPass.run(cleanApp, cleanSmtp, r.id);
    }
  }
} catch (e) {
  console.error('[MailDB] Error cleaning account passwords:', e);
}

try { db.prepare(`ALTER TABLE email_accounts ADD COLUMN warmup_settings_json TEXT DEFAULT NULL`).run(); } catch (_) { /* exists */ }

// ── Security: per-account TLS certificate policy ──────────────────────────────
// Outbound SMTP/IMAP used to run with `rejectUnauthorized: false` everywhere,
// which silently accepts any certificate (MITM on the mailbox credentials).
// Verification is now ON by default (tls_insecure = 0). Because self-hosted mail
// servers legitimately use self-signed certs, accounts that ALREADY EXISTED when
// this migration first ran are grandfathered to tls_insecure = 1 so live
// mailboxes keep working exactly as before; the owner can tighten them one by
// one from the account settings, or set MAILSENDER_STRICT_TLS=1 to force
// verification everywhere. New accounts always default to 0 (verify).
try {
  db.prepare(`ALTER TABLE email_accounts ADD COLUMN tls_insecure INTEGER DEFAULT 0`).run();
  // The ALTER only succeeds once — the first time, backfill existing rows.
  db.prepare(`UPDATE email_accounts SET tls_insecure = 1`).run();
  console.log('[MailDB] Added tls_insecure column; grandfathered existing accounts to lenient TLS.');
} catch (_) { /* exists */ }

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS warmup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_account_id INTEGER NOT NULL,
      recipient_email TEXT NOT NULL,
      subject TEXT DEFAULT '',
      status TEXT DEFAULT 'sent',
      folder_found TEXT DEFAULT 'INBOX',
      date_sent DATE DEFAULT (date('now')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_account_id) REFERENCES email_accounts(id) ON DELETE CASCADE
    );
  `);
} catch (e) {
  console.error('[MailDB] Error creating warmup_logs table:', e);
}

try {
  const defaultWarmupSettings = {
    filterTag: 'helpful', includeFilterTag: false, dailyLimit: 20, emailReply: true,
    activeLimit: 1, dailyIncrement: 1, replyRate: 50, personalizedList: '', businessType: '',
    universe: '', customContent: '', signature: '', openaiKey: '', warmupMode: 'ai', customTemplates: [],
  };
  db.prepare(`
    UPDATE email_accounts SET warmup_status = 'paused'
    WHERE warmup_status IS NULL OR warmup_status = 'inactive' OR warmup_status = ''
  `).run();
  db.prepare(`UPDATE email_accounts SET warmup_settings_json = ? WHERE warmup_settings_json IS NULL`)
    .run(JSON.stringify(defaultWarmupSettings));
} catch (e) {
  console.error('[MailDB] Error seeding default warmup status:', e);
}

export default db;
