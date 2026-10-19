import { describe, it, expect } from "vitest";
import request from "supertest";
import { rmSync } from "node:fs";

const DB = `/tmp/taop-errors-${process.pid}.db`;
process.env.DB_PATH = DB;
for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });

process.env.TAOP_NO_AUTOSTART = "true";
process.env.HOST = "127.0.0.1";
delete process.env.DEMO_READ_ONLY;

const idb = await import("../src/index_db.js");
idb.initIndexSchema();

const { app, setBackendState } = await import("../src/server.js");

setBackendState({
  deployment: {
    chainId: 84532,
    network: "base-sepolia",
    ron: "0x0000000000000000000000000000000000000001",
    registry: "0x0000000000000000000000000000000000000002",
    timelock: null,
    validator: "0x0000000000000000000000000000000000000004",
    agentA: "0x0000000000000000000000000000000000000005",
  },
  provider: { getBlockNumber: async () => 1 },
  ron: {},
  registryOracle: { getCapabilitiesByType: async () => [] },
  timelockDelay: 0n,
  capabilityId: 0n,
} as never);

describe("API error handling", () => {
  it("returns a JSON 404 for unknown API paths (no Express HTML)", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("returns a JSON 400 for malformed JSON bodies", async () => {
    const res = await request(app)
      .post("/api/completions/attest")
      .set("content-type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toEqual({ error: "Invalid JSON body" });
  });

  it("rejects malformed path params with a 400", async () => {
    const badId = await request(app).get("/api/completions/abc");
    expect(badId.status).toBe(400);
    expect(badId.body).toEqual({ error: "Invalid id" });

    const badAddress = await request(app).get("/api/agents/not-an-address/score");
    expect(badAddress.status).toBe(400);
    expect(badAddress.body).toEqual({ error: "Invalid address" });
  });

  it("falls back safely on non-numeric query limits", async () => {
    for (const path of ["/api/alerts?limit=abc", "/api/admin/audit?limit=abc", "/api/discover?limit=abc"]) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
    }
  });

  it("forwards async handler rejections to the JSON error handler (no crash)", async () => {
    const res = await request(app).get("/api/agents/0x0000000000000000000000000000000000000001/score");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    // The process is still alive and serving.
    const health = await request(app).get("/api/healthz");
    expect(health.status).toBe(200);
  });

  it("returns a JSON 413 for oversized bodies", async () => {
    const res = await request(app)
      .post("/api/completions/attest")
      .set("content-type", "application/json")
      .send(`"${"x".repeat(300 * 1024)}"`);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "Payload too large" });
  });
});
