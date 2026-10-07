import fs from "fs";
import os from "os";
import path from "path";

// Tests that go through the real routers fall back to the JSON store. Point it
// at a throwaway file so `vitest run` never rewrites the developer's db.json.
// Tests that need a specific path still set DB_JSON_PATH themselves.
if (!process.env.DB_JSON_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-test-db-"));
  process.env.DB_JSON_PATH = path.join(dir, "db.json");
}
