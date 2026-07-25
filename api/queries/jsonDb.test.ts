import { describe, it, expect, beforeAll } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

const tmp = path.join(os.tmpdir(), `sv-verify-${Date.now()}`, "db.json");

describe("jsonDb store shape", () => {
  beforeAll(() => {
    process.env.DB_JSON_PATH = tmp;
  });

  it("initialises every collection the query layer touches", async () => {
    const { readJsonDb, writeJsonDb, serializeDates } = await import("./jsonDb");
    const db = readJsonDb();

    for (const key of [
      "users", "companies", "leadLists", "leads", "leadListAssignments",
      "campaigns", "campaignLeads", "calls", "callDispositions",
      "callRecordings", "smsCampaigns", "smsLogs", "aiAgents",
      "aiConversations", "liveMonitorSessions",
    ] as const) {
      expect(Array.isArray(db[key]), `${key} should be an array`).toBe(true);
    }

    // These two used to be undefined — pushing to them threw at runtime.
    db.aiConversations.push({ id: 1, agentId: 2, leadId: 3 });
    db.liveMonitorSessions.push({ id: 1, adminId: 2, callerId: 3, callId: 4 });
    writeJsonDb(db);

    const raw = JSON.parse(fs.readFileSync(tmp, "utf-8"));
    expect(raw.aiConversations).toHaveLength(1);
    expect(raw.liveMonitorSessions).toHaveLength(1);

    // Dates are normalised to ISO strings so in-memory and on-disk rows match.
    const row = serializeDates({ id: 1, sentAt: new Date("2020-01-02T03:04:05.000Z") });
    expect(row.sentAt).toBe("2020-01-02T03:04:05.000Z");
  });
});
