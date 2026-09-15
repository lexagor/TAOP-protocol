import { describe, it, expect } from "vitest";
import { rmSync } from "node:fs";
import request from "supertest";

// Temp DB so the route handlers' cache writes never touch the real taop.db.
const DB = `/tmp/taop-routes-${process.pid}.db`;
process.env.DB_PATH = DB;
for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });

process.env.TAOP_NO_AUTOSTART = "true";
process.env.HOST = "127.0.0.1";
process.env.DEMO_READ_ONLY = "false";
process.env.TAOP_API_KEY = "test-key";

const { app, setBackendState } = await import("../src/server.js");

const KEY = "test-key";
const receipt = { hash: "0x" + "ab".repeat(32) };
const AGENT = "0x00000000000000000000000000000000000000A1";

setBackendState({
  deployment: {
    chainId: 84532,
    network: "base-sepolia",
    ron: "0x0000000000000000000000000000000000000001",
    registry: "0x0000000000000000000000000000000000000002",
    timelock: null,
    validator: "0x0000000000000000000000000000000000000004",
    agentA: AGENT,
  },
  provider: {
    getBlockNumber: async () => 100,
    getBalance: async () => 10n ** 18n,
  },
  ron: {
    challengeBond: async () => 10n ** 16n,
    getCompletion: async () => ({ agent: AGENT, challenged: false, disputed: false, counterparty: "0x0", receiptTimestamp: 0n }),
    getSelfAttestScore: async () => ({ completions: 1n, disputes: 0n, score: 1n }),
    getScoreDetails: async () => ({ completions: 1n, disputes: 0n, score: 1n, lastActivity: 1n, decayBps: 10000 }),
    getTwoSidedScore: async () => ({ confirmed: 1n, disputes: 0n, score: 1n, lastActivity: 1n, decayBps: 10000 }),
    getRankingScore: async () => ({ score: 1n, completions: 1n, disputes: 0n, scoreType: "two-sided" }),
    getAgentMetadata: async () => "ipfs://profile",
    attestReceipt: async () => receipt,
    revokeReceipt: async () => receipt,
    contestChallenge: async () => receipt,
    finalizeChallenge: async () => receipt,
    resolveChallenge: async () => receipt,
    registerAgent: async () => receipt,
  },
  ronAgentA: {
    challengeCompletion: async () => receipt,
    contestChallenge: async () => receipt,
    registerAgent: async () => receipt,
    attestCompletion: async () => ({ completionId: 7n, receipt }),
  },
  registryOracle: {
    getCapability: async () => ({ creator: AGENT, bond: 10n ** 16n, capabilityType: "0x", metadataCID: "ipfs://cap", certified: true, slashed: false }),
    certifyCapability: async () => receipt,
    getCapabilitiesByType: async () => [],
    totalSupply: async () => 1n,
    tokenByIndex: async () => 1n,
  },
  registryAgentA: {
    registerCapabilityEth: async () => ({ capabilityId: 3n, receipt }),
  },
  timelock: null,
  timelockDelay: 0n,
  executeViaTimelock: null,
  capabilityId: 1n,
  capabilityMetadataCID: "ipfs://cap",
  taskCounter: 0,
  agentARunner: { getAddress: async () => AGENT, reset: () => {} },
  oracleRunner: { getAddress: async () => "0x0000000000000000000000000000000000000004", reset: () => {} },
} as never);

const post = (path: string, body: Record<string, unknown> = {}) =>
  request(app).post(path).set("X-TAOP-Key", KEY).send(body);

describe("backend API — v0.2 routes (authorized)", () => {
  it("POST /completions/:id/receipt records a two-sided receipt", async () => {
    const res = await post("/api/completions/1/receipt", { receiptCID: "ipfs://r" });
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe(receipt.hash);
  });

  it("POST /completions/:id/revoke-receipt", async () => {
    const res = await post("/api/completions/1/revoke-receipt");
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe(receipt.hash);
  });

  it("POST /completions/:id/contest", async () => {
    const res = await post("/api/completions/1/contest", { rebuttalCID: "ipfs://b" });
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe(receipt.hash);
  });

  it("POST /completions/:id/finalize", async () => {
    const res = await post("/api/completions/1/finalize");
    expect(res.status).toBe(200);
    expect(res.body.upheld).toBe(true);
  });

  it("POST /completions/:id/resolve (owner path, no timelock)", async () => {
    const res = await post("/api/completions/1/resolve", { upheld: true });
    expect(res.status).toBe(200);
    expect(res.body.upheld).toBe(true);
  });

  it("POST /completions/:id/challenge", async () => {
    const res = await post("/api/completions/1/challenge", { evidenceCID: "ipfs://ev" });
    expect(res.status).toBe(200);
    expect(res.body.bondWei).toBe((10n ** 16n).toString());
  });

  it("GET /agents/:address/identity", async () => {
    const res = await request(app).get(`/api/agents/${AGENT}/identity`);
    expect(res.status).toBe(200);
    expect(res.body.metadataCID).toBe("ipfs://profile");
  });

  it("POST /agents/register", async () => {
    const res = await post("/api/agents/register", { metadataCID: "ipfs://p" });
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe(receipt.hash);
  });

  it("GET /agents/:address/score prefers the two-sided ranking", async () => {
    const res = await request(app).get(`/api/agents/${AGENT}/score`);
    expect(res.status).toBe(200);
    expect(res.body.rankingScoreType).toBe("two-sided");
    expect(res.body.confirmed).toBe("1");
  });

  it("POST /capabilities/register returns the emitted id", async () => {
    const res = await post("/api/capabilities/register", { capabilityType: "LoRA", metadataCID: "ipfs://m", bondEther: "0.01" });
    expect(res.status).toBe(200);
    expect(res.body.capabilityId).toBe("3");
  });

  it("POST /capabilities/:id/certify", async () => {
    const res = await post("/api/capabilities/1/certify");
    expect(res.status).toBe(200);
    expect(res.body.txHash).toBe(receipt.hash);
  });

  it("GET /capabilities/:id", async () => {
    const res = await request(app).get("/api/capabilities/1");
    expect(res.status).toBe(200);
    expect(res.body.certified).toBe(true);
  });
});
