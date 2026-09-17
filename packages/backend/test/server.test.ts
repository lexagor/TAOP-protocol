import { describe, it, expect } from "vitest";
import request from "supertest";

// Configure the backend BEFORE importing it (it reads env at module load).
process.env.TAOP_NO_AUTOSTART = "true";
process.env.HOST = "127.0.0.1";
process.env.DEMO_READ_ONLY = "false";
process.env.TAOP_API_KEY = "test-key";

const { app, setBackendState } = await import("../src/server.js");

// A minimal BackendState: no chain, no keys, no writes that can actually spend.
setBackendState({
  deployment: {
    chainId: 84532,
    network: "base-sepolia",
    ron: "0x0000000000000000000000000000000000000001",
    registry: "0x0000000000000000000000000000000000000002",
    timelock: "0x0000000000000000000000000000000000000003",
    validator: "0x0000000000000000000000000000000000000004",
    agentA: "0x0000000000000000000000000000000000000005",
  },
  provider: { getBlockNumber: async () => 4242 },
  ron: {
    challengeBond: async () => 0n,
    getCompletion: async () => {
      throw new Error("NoSuchCompletion");
    },
    getRankingScore: async () => ({ score: 0n, completions: 0n, disputes: 0n, scoreType: "self-attest" }),
    getSelfAttestScore: async () => ({ completions: 0n, disputes: 0n, score: 0n }),
    getScoreDetails: async () => ({ completions: 0n, disputes: 0n, score: 0n, lastActivity: 0n, decayBps: 10000 }),
    getTwoSidedScore: async () => ({ confirmed: 0n, disputes: 0n, score: 0n, lastActivity: 0n, decayBps: 10000 }),
    getAgentMetadata: async () => "",
    paused: async () => false,
  },
  registryOracle: { getCapabilitiesByType: async () => [], paused: async () => false },
  timelockDelay: 0n,
  capabilityId: 1n,
} as never);

describe("backend API — write gate + health (keyed loopback)", () => {
  it("GET /api/healthz is open and reports rpc + write mode", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.chainId).toBe(84532);
    expect(res.body.rpc.blockNumber).toBe(4242);
    expect(res.body.writes).toBe("keyed");
    expect(res.body.indexer).toBeDefined();
    expect(res.body.contracts).toEqual({ ronPaused: false, registryPaused: false });
  });

  it("sets security headers (CSP, nosniff, HSTS)", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["content-security-policy"]).toContain("object-src 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toBeTruthy();
  });

  it("rejects a write without the API key (401)", async () => {
    const res = await request(app).post("/api/completions/999/challenge").send({});
    expect(res.status).toBe(401);
  });

  it("rejects a write with the wrong key (401)", async () => {
    const res = await request(app).post("/api/completions/999/challenge").set("X-TAOP-Key", "nope").send({});
    expect(res.status).toBe(401);
  });

  it("passes a write through the gate with the correct key (reaches the handler, no spend)", async () => {
    const res = await request(app).post("/api/completions/999/challenge").set("X-TAOP-Key", "test-key").send({});
    expect(res.status).toBe(400); // pre-check: no such completion
  });

  it("serves /api/discover from the on-chain fallback when the index is cold", async () => {
    const res = await request(app).get("/api/discover?capabilityType=LoRA&limit=5");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.headers["x-indexer"]).toBe("off");
    expect(res.headers["x-total-count"]).toBe("0");
  });
});
