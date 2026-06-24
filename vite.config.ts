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
