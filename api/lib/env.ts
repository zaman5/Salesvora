import "dotenv/config";

export const env = {
  appId:         process.env.APP_ID         || "salesvora",
  appSecret:     process.env.APP_SECRET     || "salesvora-default-secret-change-me",
  isProduction:  process.env.NODE_ENV === "production",
  databaseUrl:   process.env.DATABASE_URL   || "",
  kimiAuthUrl:   process.env.KIMI_AUTH_URL  || "",
  kimiOpenUrl:   process.env.KIMI_OPEN_URL  || "",
  ownerUnionId:  process.env.OWNER_UNION_ID || "",
  // Default admin credentials used when db.json is created for the first time.
  // Override in .env: ADMIN_EMAIL / ADMIN_PASSWORD
  adminEmail:    process.env.ADMIN_EMAIL    || "zamantech5@gmail.com",
  adminPassword: process.env.ADMIN_PASSWORD || "Gateway@12345",
  // Path where db.json is stored. MUST be outside the deployment directory on
  // Hostinger (or any platform that replaces the app folder on each deploy).
  // Example .env entry:  DB_JSON_PATH=/home/username/salesvora-data/db.json
  dbJsonPath:    process.env.DB_JSON_PATH   || "",
};
