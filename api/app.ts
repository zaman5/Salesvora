import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { webhooksApp } from "./webhooks";
import { getStorageInfo } from "./queries/jsonDb";
import { startSMSCampaignWorker } from "./lib/smsCampaignWorker";

const app = new Hono<{ Bindings: HttpBindings }>();

// Background sender for SMS campaigns (send window / daily limit / random
// delay all live in campaign.settings) — this process is long-lived in both
// dev (Vite dev-server) and prod (node dist/boot.js), so an in-process
// interval is a valid fit; skip it under vitest so tests stay hermetic.
if (!process.env.VITEST) startSMSCampaignWorker();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
// storage info lets us verify from a browser that db.json lives at a
// deploy-safe path (persistent: true) — see api/queries/jsonDb.ts.
app.get("/health", (c) => c.json({ status: "ok", time: new Date().toISOString(), storage: getStorageInfo() }));

// Inbound Telnyx webhooks (SMS, etc.) — see api/webhooks.ts.
app.route("/api/webhooks", webhooksApp);

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;
