import "dotenv/config";

/**
 * The historical fallback signing key. It shipped in source, so anyone who has
 * ever seen this repo can forge a session token (including a superadmin one).
 * It is therefore treated as "no secret at all": allowed in development for
 * convenience, hard-rejected in production.
 */
const INSECURE_DEFAULT_APP_SECRET = "salesvora-default-secret-change-me";

const isProduction = process.env.NODE_ENV === "production";

const rawAppSecret = (process.env.APP_SECRET || "").trim();
const appSecretIsInsecure =
  rawAppSecret.length === 0 || rawAppSecret === INSECURE_DEFAULT_APP_SECRET;

if (isProduction && appSecretIsInsecure) {
  // Fail fast — booting with a publicly known JWT key means every session
  // token on the platform is forgeable. Better to not start at all.
  throw new Error(
    "APP_SECRET is not set (or is still the built-in default) while NODE_ENV=production. " +
      "Set a long, random APP_SECRET in your .env before starting the server — " +
      "without it anyone can forge a superadmin session token. See .env.example.",
  );
}

if (!isProduction && appSecretIsInsecure) {
  // Loud, but only once: this module is evaluated a single time per process.
  console.warn(
    "\n[env] ⚠  APP_SECRET is not set — falling back to the built-in development key.\n" +
      "[env] ⚠  Session tokens signed with it are forgeable by anyone. This is\n" +
      "[env] ⚠  tolerated in development only; the server will REFUSE to start\n" +
      "[env] ⚠  with NODE_ENV=production until APP_SECRET is set. See .env.example.\n",
  );
}

// Admin bootstrap credentials. No longer hardcoded — if these are unset the
// first-run seed is skipped entirely rather than creating a well-known account.
const adminEmail = (process.env.ADMIN_EMAIL || "").trim();
const adminPassword = process.env.ADMIN_PASSWORD || "";

export const env = {
  appId:         process.env.APP_ID         || "salesvora",
  appSecret:     rawAppSecret || INSECURE_DEFAULT_APP_SECRET,
  isProduction,
  databaseUrl:   process.env.DATABASE_URL   || "",
  kimiAuthUrl:   process.env.KIMI_AUTH_URL  || "",
  kimiOpenUrl:   process.env.KIMI_OPEN_URL  || "",
  ownerUnionId:  process.env.OWNER_UNION_ID || "",
  // Admin bootstrap credentials, read from ADMIN_EMAIL / ADMIN_PASSWORD.
  // Empty when unset — callers MUST check `canSeedAdmin` before seeding.
  adminEmail,
  adminPassword,
  // Only seed the bootstrap superadmin when BOTH values were explicitly
  // provided. Seeding a default-credential superadmin is never acceptable.
  canSeedAdmin: adminEmail.length > 0 && adminPassword.length > 0,
  // Credential-free dev logins (devLogin mutation, fabricated mock users when
  // the DB lookup fails) are OFF unless explicitly switched on. Gating them on
  // NODE_ENV alone is unsafe: on shared hosting NODE_ENV is often unset, which
  // would silently open a no-password path to a superadmin session.
  allowDevLogin: process.env.ALLOW_DEV_LOGIN === "true" && !isProduction,
  // Path where db.json is stored. MUST be outside the deployment directory on
  // Hostinger (or any platform that replaces the app folder on each deploy).
  // Example .env entry:  DB_JSON_PATH=/home/username/salesvora-data/db.json
  dbJsonPath:    process.env.DB_JSON_PATH   || "",
};
