import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import app from "./app";
import fs from "fs";
import path from "path";

process.on("uncaughtException", (err) => {
  console.error("[boot] Uncaught exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[boot] Unhandled rejection:", reason);
  process.exit(1);
});

// Resolve relative to dist/boot.js itself, not process.cwd().
// esbuild transforms import.meta.dirname → __dirname in the CJS bundle,
// so this always points to the dist/ folder no matter where Node is launched from.
const staticRoot = path.resolve(import.meta.dirname, "public");
console.log(`[boot] static root: ${staticRoot} (exists: ${fs.existsSync(staticRoot)})`);

app.use("*", serveStatic({ root: staticRoot }));

app.notFound((c) => {
  const accept = c.req.header("accept") ?? "";
  if (!accept.includes("text/html")) return c.json({ error: "Not Found" }, 404);
  const indexPath = path.join(staticRoot, "index.html");
  if (!fs.existsSync(indexPath)) return c.text("index.html not found", 404);
  return c.html(fs.readFileSync(indexPath, "utf-8"));
});

const port = parseInt(process.env.PORT || "3000");
console.log(`[boot] starting on port ${port} (NODE_ENV=${process.env.NODE_ENV ?? "development"})`);

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`[boot] ready — http://localhost:${port}/`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  console.error(`[boot] server error (${err.code}):`, err.message);
  process.exit(1);
});
