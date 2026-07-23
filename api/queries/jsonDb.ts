import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { hasDatabase } from "./connection";
import { env } from "../lib/env";
// Dependency-free hashing (Node crypto). The helper lives outside ./users to
// avoid the users.ts <-> jsonDb.ts import cycle.
import { hashPasswordSync } from "../lib/password";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  }
}

/**
 * Resolve where db.json lives.
 *
 * Priority:
 *  1. DB_JSON_PATH env var (explicit override — always respected)
 *  2. Auto-detect Hostinger: if process.cwd() is inside a .builds/ deployment
 *     directory, store data in ~/salesvora-data/ which survives redeployments.
 *  3. Any production run: ~/salesvora-data/db.json via os.homedir(). The
 *     .builds heuristic only fires for one specific checkout layout — if the
 *     server starts Node any other way the old code silently fell back to
 *     cwd/db.json inside the deploy folder, which is DELETED on every git
 *     push (this was the "database resets on deploy" bug).
 *  4. Fallback: process.cwd()/db.json  (local development)
 *
 * Why this matters on Hostinger:
 *   Each git push creates a fresh checkout at
 *   /home/<user>/domains/<domain>/public_html/.builds/source/repository/
 *   db.json inside that folder is wiped every deploy.
 *   Storing it at /home/<user>/salesvora-data/db.json means it is NEVER
 *   touched by deployments — data persists forever.
 *
 * One-time migration: if the persistent path doesn't exist yet but there is
 * a db.json in the current deployment folder, it is copied over automatically
 * so no data from previous deploys is lost.
 */
function resolveDbPath(): string {
  const cwd = process.cwd();
  const cwdDbPath = path.resolve(cwd, "db.json");

  // 1. Explicit env override
  if (env.dbJsonPath) {
    const p = path.resolve(env.dbJsonPath);
    ensureDir(path.dirname(p));
    return p;
  }

  // 2. Auto-detect Hostinger: deployment path contains ".builds"
  const cwdPosix = cwd.replace(/\\/g, "/");
  if (cwdPosix.includes("/.builds/") || cwdPosix.includes(".builds/source/repository")) {
    const parts = cwdPosix.split("/");
    const homeIdx = parts.indexOf("home");
    if (homeIdx !== -1 && parts[homeIdx + 1]) {
      // Build /home/<username>/salesvora-data/db.json
      const homeDir  = "/" + parts.slice(1, homeIdx + 2).join("/");
      const dataDir  = homeDir + "/salesvora-data";
      ensureDir(dataDir);
      const persistent = dataDir + "/db.json";

      // One-time migration: copy existing data from deployment folder → persistent path
      if (!fs.existsSync(persistent) && fs.existsSync(cwdDbPath)) {
        try {
          fs.copyFileSync(cwdDbPath, persistent);
          console.log(`[db] Migrated db.json → ${persistent}`);
        } catch { /* ignore — will start fresh if copy fails */ }
      }

      return persistent;
    }
  }

  // 3. Production fallback: never keep data inside a folder that a deploy can
  //    replace. The home directory is outside every checkout/build dir, so
  //    ~/salesvora-data/db.json survives git pushes no matter how the server
  //    process was started or where its cwd points. Besides NODE_ENV, treat
  //    any hosting-style path (public_html / domains) as deployed — a process
  //    started without NODE_ENV=production must still never store data in a
  //    folder that the next git push deletes.
  const looksDeployed =
    env.isProduction || cwdPosix.includes("/public_html") || cwdPosix.includes("/domains/");
  if (looksDeployed) {
    const home = os.homedir();
    if (home && home !== "/") {
      const dataDir = path.join(home, "salesvora-data");
      ensureDir(dataDir);
      const persistent = path.join(dataDir, "db.json");
      // One-time migration: adopt data from the deployment folder if the
      // persistent file doesn't exist yet.
      if (!fs.existsSync(persistent) && fs.existsSync(cwdDbPath)) {
        try {
          fs.copyFileSync(cwdDbPath, persistent);
          console.log(`[db] Migrated db.json → ${persistent}`);
        } catch { /* ignore — will start fresh if copy fails */ }
      }
      return persistent;
    }
  }

  // 4. Local development default
  return cwdDbPath;
}

const DB_PATH_RESOLVED = resolveDbPath();

/**
 * Diagnostics for the /health endpoint so persistence can be verified from a
 * browser without SSH: which storage mode is active, where db.json actually
 * lives, and whether that location is deploy-safe and writable.
 */
export function getStorageInfo() {
  const persistent =
    Boolean(env.dbJsonPath) || DB_PATH_RESOLVED.replace(/\\/g, "/").includes("salesvora-data");
  let writable = false;
  try {
    fs.accessSync(path.dirname(DB_PATH_RESOLVED), fs.constants.W_OK);
    writable = true;
  } catch { /* not writable */ }
  return {
    mode: hasDatabase() ? "mysql" : "json",
    dbPath: DB_PATH_RESOLVED,
    persistent,
    exists: fs.existsSync(DB_PATH_RESOLVED),
    sizeBytes: fs.existsSync(DB_PATH_RESOLVED) ? fs.statSync(DB_PATH_RESOLVED).size : 0,
    writable,
    envOverride: Boolean(env.dbJsonPath),
  };
}

// Log which storage mode is active once on startup
let _modeLogged = false;
export function logStorageMode() {
  if (_modeLogged) return;
  _modeLogged = true;
  if (hasDatabase()) {
    console.log("[db] MySQL mode — data is stored in MySQL and survives all deployments.");
  } else {
    console.log(`[db] JSON file mode — db.json: ${DB_PATH_RESOLVED}`);
    if (DB_PATH_RESOLVED.includes("salesvora-data")) {
      console.log("[db] ✓ Persistent path detected — data will survive redeployments.");
    } else {
      console.warn(
        "[db] WARNING: db.json is inside the deployment folder and may be wiped on deploy.\n" +
        "     To fix: set DB_JSON_PATH=/home/<username>/salesvora-data/db.json in .env",
      );
    }
  }
}

export type JsonDb = {
  users: unknown[];
  companies: unknown[];
  leadLists: unknown[];
  leads: unknown[];
  leadListAssignments: unknown[];
  campaigns: unknown[];
  campaignLeads: unknown[];
  calls: unknown[];
  callDispositions: unknown[];
  callRecordings: unknown[];
  smsCampaigns: unknown[];
  smsLogs: unknown[];
  aiAgents: unknown[];
};

const DB_PATH  = DB_PATH_RESOLVED;
const BAK_PATH = DB_PATH_RESOLVED + ".bak";

const EMPTY = (): JsonDb => ({
  users: [], companies: [], leadLists: [], leads: [],
  leadListAssignments: [], campaigns: [], campaignLeads: [],
  calls: [], callDispositions: [], callRecordings: [],
  smsCampaigns: [], smsLogs: [], aiAgents: [],
});

/**
 * Bootstrap superadmin for a brand-new db.json.
 *
 * Returns an EMPTY list unless BOTH ADMIN_EMAIL and ADMIN_PASSWORD are set.
 * The credentials used to be hardcoded in source, which meant every fresh
 * install came up with a publicly known superadmin login. Seeding nothing is
 * strictly safer: an operator who wants a bootstrap account sets the two env
 * vars (see .env.example). This function only ever runs when db.json does not
 * exist yet, so it can never overwrite an already-seeded account.
 */
function seedAdminUsers(now: string): JsonDb["users"] {
  if (!env.canSeedAdmin) {
    console.warn(
      "[db] ADMIN_EMAIL / ADMIN_PASSWORD are not set — creating db.json with NO admin account. " +
        "Set both in .env and delete db.json to seed a bootstrap superadmin.",
    );
    return [];
  }
  return [
    {
      id: 1,
      unionId: "admin-default",
      name: "Admin",
      email: env.adminEmail,
      // Stored as a bcrypt digest — never plaintext.
      password: hashPasswordSync(env.adminPassword),
      // The seeded owner account is a superadmin (not just admin) so it can
      // create/promote other admins — otherwise nobody could ever become a
      // superadmin (creating one requires already being one).
      role: "superadmin",
      status: "active",
      companyId: 1,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/** Bootstrap data written when db.json is created for the first time. */
function defaultDb(): JsonDb {
  const now = new Date().toISOString();
  return {
    ...EMPTY(),
    companies: [
      { id: 1, name: "Salesvora", status: "active", settings: {}, createdAt: now, updatedAt: now },
    ],
    users: seedAdminUsers(now),
    callDispositions: [
      { id: 1,  name: "connected",      label: "Connected",                category: "connected",     isSystem: true, isActive: true, color: "#10B981", order: 1,  createdAt: now },
      { id: 2,  name: "no_answer",      label: "No Answer",                category: "no_answer",     isSystem: true, isActive: true, color: "#EF4444", order: 2,  createdAt: now },
      { id: 3,  name: "machine",        label: "Answering Machine",        category: "machine",       isSystem: true, isActive: true, color: "#F59E0B", order: 3,  createdAt: now },
      { id: 4,  name: "voicemail",      label: "Voice Mail",               category: "voicemail",     isSystem: true, isActive: true, color: "#8B5CF6", order: 4,  createdAt: now },
      { id: 5,  name: "wrong_number",   label: "Wrong Number",             category: "wrong_number",  isSystem: true, isActive: true, color: "#EC4899", order: 5,  createdAt: now },
      { id: 6,  name: "invalid",        label: "Invalid / Irrelevant",     category: "wrong_number",  isSystem: true, isActive: true, color: "#6B7280", order: 6,  createdAt: now },
      { id: 7,  name: "interested",     label: "Interested",               category: "converted",     isSystem: true, isActive: true, color: "#059669", order: 7,  createdAt: now },
      { id: 8,  name: "not_interested", label: "Not Interested",           category: "not_interested",isSystem: true, isActive: true, color: "#DC2626", order: 8,  createdAt: now },
      { id: 9,  name: "dnc",            label: "Do Not Call Again",        category: "dnc",           isSystem: true, isActive: true, color: "#991B1B", order: 9,  createdAt: now },
      { id: 10, name: "custom",         label: "Custom",                   category: "custom",        isSystem: true, isActive: true, color: "#3B82F6", order: 10, createdAt: now },
    ],
  };
}

const KEYS: Array<keyof JsonDb> = [
  "users","companies","leadLists","leads","leadListAssignments",
  "campaigns","campaignLeads","calls","callDispositions","callRecordings",
  "smsCampaigns","smsLogs","aiAgents",
];

function tryParse(content: string): JsonDb | null {
  try {
    const data = JSON.parse(content) as Partial<JsonDb>;
    const result = EMPTY();
    for (const k of KEYS) {
      if (Array.isArray(data[k])) (result as Record<string, unknown>)[k] = data[k];
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * One-time upgrade: the seeded owner account used to be created as "admin".
 * It must be "superadmin" so it can create/promote other admins — creating a
 * superadmin otherwise requires already being one, which would leave nobody
 * able to ever become one. Only touches the specific bootstrap account, not
 * every admin. Returns true if it changed anything (caller should persist).
 */
function migrateOwnerToSuperadmin(data: JsonDb): boolean {
  const owner = (data.users as Array<{ unionId?: string; email?: string; role?: string }>).find(
    // env.adminEmail is "" when ADMIN_EMAIL is unset — never match on that, or
    // any user with a blank email would be promoted to superadmin.
    (u) => u.unionId === "admin-default" || (env.adminEmail !== "" && u.email === env.adminEmail),
  );
  if (owner && owner.role === "admin") {
    owner.role = "superadmin";
    console.log(`[db] Upgraded owner account (${owner.email}) from admin to superadmin.`);
    return true;
  }
  return false;
}

export function readJsonDb(): JsonDb {
  logStorageMode();
  // File doesn't exist — first run. Seeds a superadmin only if ADMIN_EMAIL and
  // ADMIN_PASSWORD are set; an existing db.json is never re-seeded or altered.
  if (!fs.existsSync(DB_PATH)) {
    const fresh = defaultDb();
    writeJsonDb(fresh);
    console.log(
      env.canSeedAdmin
        ? `[db] Created db.json and seeded superadmin: ${env.adminEmail}`
        : "[db] Created db.json with no seeded admin (ADMIN_EMAIL / ADMIN_PASSWORD unset).",
    );
    return fresh;
  }

  // Try the main file
  try {
    const content = fs.readFileSync(DB_PATH, "utf-8");
    const data = tryParse(content);
    if (data) {
      if (migrateOwnerToSuperadmin(data)) writeJsonDb(data);
      return data;
    }
  } catch { /* fall through to backup */ }

  // Main file corrupt — try backup
  if (fs.existsSync(BAK_PATH)) {
    try {
      const content = fs.readFileSync(BAK_PATH, "utf-8");
      const data = tryParse(content);
      if (data) {
        // Restore from backup
        fs.copyFileSync(BAK_PATH, DB_PATH);
        console.warn("[jsonDb] Restored db.json from backup.");
        if (migrateOwnerToSuperadmin(data)) writeJsonDb(data);
        return data;
      }
    } catch { /* fall through */ }
  }

  // Both corrupt — set the unreadable file aside (never overwrite it: the
  // data may still be recoverable by hand) and start fresh.
  console.error("[jsonDb] db.json and backup are both corrupt. Starting with empty data.");
  try {
    if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, `${DB_PATH}.corrupt-${Date.now()}`);
  } catch { /* non-fatal */ }
  const fresh = EMPTY();
  writeJsonDb(fresh);
  return fresh;
}

export function writeJsonDb(data: JsonDb): void {
  try {
    const json = JSON.stringify(data, null, 2);
    // Keep a rolling backup before every write so we can recover if the
    // main write is interrupted (e.g. process killed mid-write).
    if (fs.existsSync(DB_PATH)) {
      try { fs.copyFileSync(DB_PATH, BAK_PATH); } catch { /* non-fatal */ }
    }
    // Direct write — fs.renameSync over an existing file throws EPERM on
    // Windows when the file is open, so we write directly instead.
    fs.writeFileSync(DB_PATH, json, "utf-8");
  } catch (err) {
    console.error("[jsonDb] Failed to write db.json:", err);
  }
}
