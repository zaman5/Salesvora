import { describe, it, expect } from "vitest";
import app from "./boot";

describe("Hono Server Smoke Test", () => {
  it("should respond to a non-existent route with 404", async () => {
    const res = await app.request("/api/non-existent-route");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not Found" });
  });

  it("should export app Hono instance", () => {
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe("function");
  });
});
