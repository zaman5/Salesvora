import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { webhooksApp } from "./webhooks";
import { getStorageInfo } from "./queries/jsonDb";
import { startSMSCampaignWorker } from "./lib/smsCampaignWorker";

const app = new Hono<{ Bindings: HttpBindings }>();

// Enable CORS so requests from other origins/ports (or OPTIONS preflights) succeed
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization", "x-trpc-source"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// Background sender for SMS campaigns (send window / daily limit / random
// delay all live in campaign.settings) — this process is long-lived in both
// dev (Vite dev-server) and prod (node dist/boot.js), so an in-process
// interval is a valid fit; skip it under vitest so tests stay hermetic.
if (!process.env.VITEST) startSMSCampaignWorker();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
// storage info lets us verify from a browser that db.json lives at a
// deploy-safe path (persistent: true) — see api/queries/jsonDb.ts.
app.get("/health", (c) => c.json({ status: "ok", time: new Date().toISOString(), storage: getStorageInfo() }));
// Reachable through the PHP proxy (which forwards only /api/*). startedAt shows
// whether the Node process actually restarted onto a new deploy.
const STARTED_AT = new Date().toISOString();
app.get("/api/health", (c) => c.json({ status: "ok", startedAt: STARTED_AT }));

// Inbound Telnyx webhooks (SMS, etc.) — see api/webhooks.ts.
app.route("/api/webhooks", webhooksApp);

const trpcHandler = async (c: any) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
};

app.all("/api/trpc/*", trpcHandler);
app.all("/api/trpc", trpcHandler);

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;
