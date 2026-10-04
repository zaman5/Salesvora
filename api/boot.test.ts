import { describe, it, expect } from "vitest";
import app from "./boot";

describe("Hono Server Smoke Test", () => {
  it("should respond to a non-existent route with 404", async () => {
    const res = await app.request("/api/non-existent-route");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not Found" });
  });

  it("should not serve the PHP proxy's source from dist/public", async () => {
    const res = await app.request("/api-proxy.php");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("<?php");
  });
  it("should handle /api/trpc/auth.me query", async () => {
    const res = await app.request("/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("should handle /api/trpc/auth.login mutation", async () => {
    const res = await app.request("/api/trpc/auth.login?batch=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        0: { json: { email: "nonexistent@example.com", password: "wrong" } },
      }),
    });
    // Should return 401 Unauthorized from tRPC, not 404
    expect(res.status).toBe(401);
  });

  it("should respond to OPTIONS preflight for /api/trpc/auth.login", async () => {
    const res = await app.request("/api/trpc/auth.login", {
      method: "OPTIONS",
      headers: {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.status).toBe(204);
  });
});
