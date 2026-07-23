import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig, type PluginOption } from "vite"

export default defineConfig(async ({ command }) => {
  const plugins: PluginOption[] = [react()];

  if (command === "serve") {
    const { default: devServer } = await import("@hono/vite-dev-server");
    plugins.unshift(
      devServer({
        entry: "api/app.ts",
        exclude: [/^(?!\/api\/).*/],
      }),
    );

    // Mail Sender's Express sub-app can't go through the Hono dev-server
    // plugin above (it needs raw Node req/res, not a Fetch Response), so it's
    // mounted directly on Vite's own middleware stack instead — registered
    // first so it claims /api/mail/* before the Hono plugin ever sees it.
    // Loaded through Vite's own SSR module loader (not a static/dynamic TS
    // import) so it gets TS transpilation + extensionless resolution, and so
    // tsconfig.node.json — which only type-checks this config file in
    // isolation — never pulls the whole backend's type graph into its scope.
    plugins.unshift({
      name: "mailsender-express-bridge",
      configureServer(server) {
        let mailAppPromise: Promise<(req: unknown, res: unknown, next: unknown) => void> | undefined;
        const invalidate = (file: string) => {
          if (file.replace(/\\/g, "/").includes("/api/")) mailAppPromise = undefined;
        };
        server.watcher.on("change", invalidate);
        server.watcher.on("add", invalidate);
        server.watcher.on("unlink", invalidate);

        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/api/mail")) return next();
          mailAppPromise ??= server
            .ssrLoadModule("/api/mailsender/app.ts")
            .then((mod) => mod.default as (req: unknown, res: unknown, next: unknown) => void);
          const mailApp = await mailAppPromise;
          mailApp(req, res, next);
        });
      },
    });
  }

  return {
    plugins,
    server: {
      port: 3000,
      watch: {
        // Ignore the JSON database files so Vite does NOT restart the dev
        // server every time data is written — that restart was breaking writes
        // mid-flight and causing the database to appear "reset".
        ignored: ["**/db.json", "**/db.json.bak", "**/db.json.tmp"],
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@contracts": path.resolve(__dirname, "./contracts"),
        "@db": path.resolve(__dirname, "./db"),
        "db": path.resolve(__dirname, "./db"),
      },
    },
    envDir: path.resolve(__dirname),
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
    },
  };
});
