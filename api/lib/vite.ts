import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  // Use absolute path so the app works regardless of working directory.
  const distPath = path.resolve(
    import.meta.dirname ? path.dirname(import.meta.dirname) : process.cwd(),
    "dist/public",
  );

  app.use("*", serveStatic({ root: distPath }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.join(distPath, "index.html");
    if (!fs.existsSync(indexPath)) {
      return c.text("index.html not found", 404);
    }
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  });
}
