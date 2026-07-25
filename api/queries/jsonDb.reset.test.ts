import { describe, it, expect, beforeAll } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

// env.ts reads process.env once at module load, so ADMIN_RESET_* must be set
// before jsonDb (and its env import) is pulled in. Same reason jsonDb.seed.test
// is a separate file: each of these needs its own module registry.
const dir = path.join(os.tmpdir(), `sv-reset-${Date.now()}`);
const dbPath = path.join(dir, "db.json");
const resetFile = path.join(dir, "app_admin_reset");

describe("admin password reset", () => {
  beforeAll(() => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resetFile, "owner@example.com:NewGoodPass123");
    process.env.DB_JSON_PATH = dbPath;
    process.env.ADMIN_RESET_EMAIL = "owner@example.com";
    process.env.ADMIN_RESET_PASSWORD = "NewGoodPass123";
    process.env.ADMIN_RESET_FILE = resetFile;
    // Explicitly NOT set: this must work without the seed variables, since the
    // account already exists and seeding would refuse to touch it.
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
  });

  it("rewrites the password of an existing locked-out account", async () => {
    // The state the live site reached: the one superadmin exists, but its
    // stored password is not what the operator believes they set (here, a
    // stray leading space picked up from an "email: password" bootstrap file).
    // Seeding cannot help — it only ever fires on an empty user list — so
    // without a reset path the account is unreachable forever.
    fs.writeFileSync(
      dbPath,
      JSON.stringify({
        users: [
          {
            id: 1,
            unionId: "admin-default",
            email: "owner@example.com",
            role: "superadmin",
            status: "suspended",
            password: "scrypt:AAAA:BBBB",
            sipCredentials: { domain: "local", username: "owner", password: "scrypt:AAAA:BBBB" },
          },
        ],
      }),
    );

    const { readJsonDb } = await import("./jsonDb");
    const { verifyPassword } = await import("../lib/password");
    const db = readJsonDb();

    expect(db.users).toHaveLength(1);
    const user = db.users[0] as any;

    // The new password verifies, and is stored hashed rather than in plaintext.
    expect(await verifyPassword("NewGoodPass123", user.password)).toBe(true);
    expect(user.password).not.toBe("NewGoodPass123");

    // A suspended account is the same lockout as a bad password, so the reset
    // clears it too — otherwise login still fails and the reset looks broken.
    expect(user.status).toBe("active");

    // The legacy plaintext mirror is a fallback credential that login falls
    // back to. Left holding the OLD value it would keep answering for the
    // previous password after the reset.
    expect(await verifyPassword("NewGoodPass123", user.sipCredentials.password)).toBe(true);

    // Persisted, not just patched in memory.
    const raw = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    expect(await verifyPassword("NewGoodPass123", raw.users[0].password)).toBe(true);

    // The source file held a plaintext password and must not survive.
    expect(fs.existsSync(resetFile)).toBe(false);
  });

  it("applies at most once per process, so reads do not rewrite db.json", async () => {
    const { readJsonDb } = await import("./jsonDb");
    // Put a different password back; a second reset would overwrite it again.
    const current = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    current.users[0].password = "scrypt:SENTINEL:SENTINEL";
    fs.writeFileSync(dbPath, JSON.stringify(current));

    readJsonDb();

    const after = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    expect(after.users[0].password).toBe("scrypt:SENTINEL:SENTINEL");
  });
});
