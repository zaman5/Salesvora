import { drizzle } from "drizzle-orm/mysql2";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>> | null = null;

/** Returns true when MySQL is configured and should be used. */
export function hasDatabase(): boolean {
  return Boolean(env.databaseUrl);
}

/**
 * Returns the Drizzle database instance.
 * Throws if DATABASE_URL is not set — callers must guard with hasDatabase()
 * so the JSON fallback is used immediately instead of waiting for a timeout.
 */
export function getDb(): ReturnType<typeof drizzle<typeof fullSchema>> {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is not configured — using local JSON store.");
  }
  if (!instance) {
    instance = drizzle(env.databaseUrl, {
      mode: "planetscale",
      schema: fullSchema,
    });
  }
  return instance;
}
