/**
 * Shared JSON database fallback.
 * Used by all query modules when the MySQL connection is unavailable.
 *
 * Key design decisions:
 * - Single module — eliminates the duplicate read/write functions that existed
 *   in every query file and caused last-write-wins data loss.
 * - NO seeding — mock seed data was overwriting real user data whenever the DB
 *   fell back to JSON. Empty arrays are now the correct "no data" state.
 * - Safe write — writes to a temp file first, then renames atomically so a
 *   crashed mid-write never corrupts the existing file.
 * - Parse recovery — if the JSON is corrupt, restores from the .bak copy
 *   rather than silently returning empty data that then gets re-seeded.
 */
import * as fs from "fs";
import * as path from "path";

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
  // File doesn't exist yet — start fresh, no seeding
  if (!fs.existsSync(DB_PATH)) {
    const fresh = EMPTY();
    writeJsonDb(fresh);
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
