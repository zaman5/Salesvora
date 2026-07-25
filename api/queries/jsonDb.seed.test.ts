import { describe, it, expect, beforeAll } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

// env.ts reads process.env once at module load, so the bootstrap credentials
// have to be in place before jsonDb (and its env import) is ever pulled in.
// That is why this lives in its own file rather than in jsonDb.test.ts.
const dir = path.join(os.tmpdir(), `sv-seed-${Date.now()}`);
const dbPath = path.join(dir, "db.json");

describe("bootstrap admin recovery", () => {
  beforeAll(() => {
    fs.mkdirSync(dir, { recursive: true });
    process.env.DB_JSON_PATH = dbPath;
    process.env.ADMIN_EMAIL = "owner@example.com";
    process.env.ADMIN_PASSWORD = "s3cret-bootstrap";
  });

  it("seeds a superadmin into a db.json that exists but has no accounts", async () => {
    // The dead-end state a fresh install lands in when the data directory is
    // empty and ADMIN_EMAIL / ADMIN_PASSWORD were not set at first boot: the
    // file is present, so the create-time seed never runs again and nobody can
    // ever log in.
    fs.writeFileSync(dbPath, JSON.stringify({ users: [] }));

    const { readJsonDb } = await import("./jsonDb");
    const db = readJsonDb();

    expect(db.users).toHaveLength(1);
    expect(db.users[0].email).toBe("owner@example.com");
    expect(db.users[0].role).toBe("superadmin");

    // Persisted, not just patched in memory — the next process must see it too.
    const raw = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    expect(raw.users).toHaveLength(1);
    // Seeded credentials are hashed, never written in plaintext.
    expect(raw.users[0].password).not.toBe("s3cret-bootstrap");
  });

  it("never re-seeds a database that already has an account", async () => {
    fs.writeFileSync(
      dbPath,
      JSON.stringify({ users: [{ id: 9, unionId: "u9", email: "real@example.com", role: "caller" }] }),
    );

    const { readJsonDb } = await import("./jsonDb");
    const db = readJsonDb();

    expect(db.users).toHaveLength(1);
    expect(db.users[0].email).toBe("real@example.com");
    expect(db.users[0].role).toBe("caller");
  });
});
