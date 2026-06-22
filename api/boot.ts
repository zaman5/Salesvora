import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { Paths } from "@contracts/constants";
import fs from "fs";
import path from "path";

// Catch any unhandled errors so the process doesn't exit silently
process.on("uncaughtException", (err) => {
  console.error("[boot] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[boot] Unhandled rejection:", reason);
});

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

// Health check — always responds so we can verify the app is running
app.get("/health", (c) => c.json({ status: "ok", time: new Date().toISOString() }));

// OAuth callback (only active when KIMI_AUTH_URL is configured)
if (env.kimiAuthUrl) {
  const { createOAuthCallbackHandler } = await import("./kimi/auth");
  app.get(Paths.oauthCallback, createOAuthCallbackHandler());
}

app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

// Serve built frontend files
const staticRoot = path.resolve(process.cwd(), "dist/public");
console.log("[boot] Static files path:", staticRoot, "exists:", fs.existsSync(staticRoot));

app.use("*", serveStatic({ root: staticRoot }));

app.notFound((c) => {
  const accept = c.req.header("accept") ?? "";
  if (!accept.includes("text/html")) return c.json({ error: "Not Found" }, 404);
  const indexPath = path.join(staticRoot, "index.html");
  if (!fs.existsSync(indexPath)) return c.text("index.html not found", 404);
  return c.html(fs.readFileSync(indexPath, "utf-8"));
});

export default app;

const port = parseInt(process.env.PORT || "3000");
console.log(`[boot] Starting Salesvora on port ${port}...`);

serve({ fetch: app.fetch, port }, () => {
  console.log(`[boot] Server ready on http://localhost:${port}/`);
});
