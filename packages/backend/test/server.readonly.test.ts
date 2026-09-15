import { describe, it, expect } from "vitest";
import request from "supertest";

// Read-only instance: every write must return 503 while reads keep working.
process.env.TAOP_NO_AUTOSTART = "true";
process.env.HOST = "127.0.0.1";
process.env.DEMO_READ_ONLY = "true";
process.env.TAOP_API_KEY = "";

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
  ron: {
    getSelfAttestScore: async () => ({ completions: 0n, disputes: 0n, score: 0n }),
    getScoreDetails: async () => ({ completions: 0n, disputes: 0n, score: 0n, lastActivity: 0n, decayBps: 10000 }),
    getTwoSidedScore: async () => ({ confirmed: 0n, disputes: 0n, score: 0n, lastActivity: 0n, decayBps: 10000 }),
  },
  registryOracle: { getCapabilitiesByType: async () => [] },
  timelockDelay: 0n,
  capabilityId: 1n,
} as never);

describe("backend API — read-only instance (DEMO_READ_ONLY=true)", () => {
  it("healthz reports writes=disabled", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body.writes).toBe("disabled");
  });

  it("reads still work", async () => {
    const res = await request(app).get("/api/discover?capabilityType=LoRA");
    expect(res.status).toBe(200);
  });

  it("every write returns 503", async () => {
    for (const path of ["/api/completions/1/challenge", "/api/completions/1/receipt", "/api/demo/run"]) {
      const res = await request(app).post(path).send({});
      expect(res.status, path).toBe(503);
    }
  });
});
