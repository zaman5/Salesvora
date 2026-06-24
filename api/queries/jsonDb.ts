import * as fs from "fs";
import * as path from "path";
import { hasDatabase } from "./connection";
import { env } from "../lib/env";

// Resolve db.json location.
// Priority: DB_JSON_PATH env var → process.cwd()/db.json
// On Hostinger (or any platform that replaces the app folder on each deploy),
// set DB_JSON_PATH to a directory OUTSIDE the deployment folder so data
// survives redeployments. Example:
//   DB_JSON_PATH=/home/username/salesvora-data/db.json
function resolveDbPath(): string {
  if (env.dbJsonPath) {
    const p = path.resolve(env.dbJsonPath);
    // Make sure parent directory exists
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    }
    return p;
  }
  return path.resolve(process.cwd(), "db.json");
}

const DB_PATH_RESOLVED = resolveDbPath();

// Log which storage mode is active once on startup
let _modeLogged = false;
export function logStorageMode() {
  if (_modeLogged) return;
  _modeLogged = true;
  if (hasDatabase()) {
    console.log("[db] MySQL mode — DATABASE_URL is set. Data stored in MySQL.");
  } else {
    console.warn(
      `[db] JSON file mode — DATABASE_URL is not set.\n` +
      `     db.json location: ${DB_PATH_RESOLVED}\n` +
      `     On Hostinger: set DB_JSON_PATH=/home/username/salesvora-data/db.json\n` +
      `     in your .env so data is not wiped on every deployment.`,
    );
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

/** Bootstrap data written when db.json is created for the first time. */
function defaultDb(): JsonDb {
  const now = new Date().toISOString();
  return {
    ...EMPTY(),
    companies: [
      { id: 1, name: "Salesvora", status: "active", settings: {}, createdAt: now, updatedAt: now },
    ],
    users: [
      {
        id: 1,
        unionId: "admin-default",
        name: "Admin",
        email: env.adminEmail,
        password: env.adminPassword,
        role: "admin",
        status: "active",
        companyId: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
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

export function readJsonDb(): JsonDb {
  logStorageMode();
  // File doesn't exist — first run. Write default data including the admin user.
  if (!fs.existsSync(DB_PATH)) {
    const fresh = defaultDb();
    writeJsonDb(fresh);
    console.log(`[db] Created db.json with default admin: ${env.adminEmail}`);
    return fresh;
  }

  // Try the main file
  try {
    const content = fs.readFileSync(DB_PATH, "utf-8");
    const data = tryParse(content);
    if (data) return data;
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
        return data;
      }
    } catch { /* fall through */ }
  }

  // Both corrupt — start fresh (preserves whatever was there, just unreadable)
  console.error("[jsonDb] db.json and backup are both corrupt. Starting with empty data.");
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
