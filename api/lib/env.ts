import "dotenv/config";

export const env = {
  appId:        process.env.APP_ID        || "salesvora",
  appSecret:    process.env.APP_SECRET    || "salesvora-default-secret-change-me",
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl:  process.env.DATABASE_URL  || "",
  kimiAuthUrl:  process.env.KIMI_AUTH_URL || "",
  kimiOpenUrl:  process.env.KIMI_OPEN_URL || "",
  ownerUnionId: process.env.OWNER_UNION_ID || "",
};
