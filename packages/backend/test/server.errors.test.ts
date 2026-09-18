import { describe, it, expect } from "vitest";
import request from "supertest";
import { rmSync } from "node:fs";

const DB = `/tmp/taop-errors-${process.pid}.db`;
process.env.DB_PATH = DB;
for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });

process.env.TAOP_NO_AUTOSTART = "true";
process.env.HOST = "127.0.0.1";
delete process.env.DEMO_READ_ONLY;

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
  registryOracle: {},
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

  it("returns a JSON 413 for oversized bodies", async () => {
    const res = await request(app)
      .post("/api/completions/attest")
      .set("content-type", "application/json")
      .send(`"${"x".repeat(300 * 1024)}"`);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "Payload too large" });
  });
});
