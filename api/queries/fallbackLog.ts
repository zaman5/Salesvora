import { hasDatabase } from "./connection";

/**
 * Report that a query fell back to the JSON store.
 *
 * Every one of the ~88 query functions used to console.warn on each fallback.
 * With no DATABASE_URL set — which is the normal, intended configuration for
 * this deployment — that is not an error condition at all, yet it emitted a
 * line on literally every read. The live log became a solid wall of
 * "DB offline, falling back to local JSON store", and a genuine production
 * failure (Mail Sender answering 403 to every write) sat in the middle of it
 * unnoticed. A log nobody can read is a log that hides outages.
 *
 * So: silent when the JSON store IS the configured backend, because nothing has
 * gone wrong. When a database is configured, a fallback means a real outage and
 * is worth seeing — but still only once per function per process, so a failing
 * database degrades the log gracefully instead of drowning it.
 */
const reported = new Set<string>();

export function warnJsonFallback(label: string): void {
  if (!hasDatabase()) return;
  if (reported.has(label)) return;
  reported.add(label);
  console.warn(
    `[${label}] Database query failed — falling back to the local JSON store. ` +
      `Further fallbacks from this function will not be logged.`,
  );
}
