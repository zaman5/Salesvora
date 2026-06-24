import * as fs from "fs";
import * as path from "path";
import { hasDatabase } from "./connection";
import { env } from "../lib/env";

// Log which storage mode is active once on startup
let _modeLogged = false;
export function logStorageMode() {
  if (_modeLogged) return;
  _modeLogged = true;
  if (hasDatabase()) {
    console.log("[db] MySQL (PlanetScale) mode — DATABASE_URL is set.");
  } else {
    console.warn(
      "[db] JSON file mode — DATABASE_URL is not set.\n" +
      "     Data is stored in db.json (local file, persists across restarts).\n" +
      "     Set DATABASE_URL in your .env file to use MySQL instead.",
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
  smsCampaigns: unknown[];
  smsLogs: unknown[];
  aiAgents: unknown[];
};

const DB_PATH  = path.resolve(process.cwd(), "db.json");
const BAK_PATH = path.resolve(process.cwd(), "db.json.bak");
const TMP_PATH = path.resolve(process.cwd(), "db.json.tmp");

const EMPTY = (): JsonDb => ({
  users: [], companies: [], leadLists: [], leads: [],
  leadListAssignments: [], campaigns: [], campaignLeads: [],
  calls: [], smsCampaigns: [], smsLogs: [], aiAgents: [],
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
  };
}

const KEYS: Array<keyof JsonDb> = [
  "users","companies","leadLists","leads","leadListAssignments",
  "campaigns","campaignLeads","calls","smsCampaigns","smsLogs","aiAgents",
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
    // Backup existing file before overwriting
    if (fs.existsSync(DB_PATH)) {
      fs.copyFileSync(DB_PATH, BAK_PATH);
    }
    // Write to temp then rename (atomic on most OS)
    fs.writeFileSync(TMP_PATH, json, "utf-8");
    fs.renameSync(TMP_PATH, DB_PATH);
  } catch (err) {
    console.error("[jsonDb] Failed to write db.json:", err);
  }
}
