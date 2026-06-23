import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import app from "./app";
import fs from "fs";
import path from "path";

process.on("uncaughtException", (err) => { console.error("[boot] Uncaught exception:", err); });
process.on("unhandledRejection", (reason) => { console.error("[boot] Unhandled rejection:", reason); });

const staticRoot = path.resolve(process.cwd(), "dist/public");
app.use("*", serveStatic({ root: staticRoot }));
app.notFound((c) => {
  const accept = c.req.header("accept") ?? "";
  if (!accept.includes("text/html")) return c.json({ error: "Not Found" }, 404);
  const indexPath = path.join(staticRoot, "index.html");
  if (!fs.existsSync(indexPath)) return c.text("index.html not found", 404);
  return c.html(fs.readFileSync(indexPath, "utf-8"));
});

const port = parseInt(process.env.PORT || "3000");
console.log(`[boot] Starting on port ${port}`);
serve({ fetch: app.fetch, port }, () => {
  console.log(`[boot] Ready on http://localhost:${port}/`);
});
