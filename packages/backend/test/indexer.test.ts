import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";

// Isolated temp DB before importing the modules that read DB_PATH.
const DB = `/tmp/taop-indexer-test-${process.pid}.db`;
process.env.DB_PATH = DB;
for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });

const { ethers } = await import("ethers");
const idb = await import("../src/index_db.js");
const ix = await import("../src/indexer.js");

const LORA = ethers.id("LoRA").toLowerCase();
const A = "0xAbC0000000000000000000000000000000000001";
const B = "0xAbC0000000000000000000000000000000000002";
const NOW = Math.floor(Date.now() / 1000);
const GRACE = 30 * 24 * 3600;
const HORIZON = 150 * 24 * 3600;

describe("F10 index — persistence + read path", () => {
  beforeAll(() => {
    idb.initIndexSchema();
    idb.upsertIndexedCapability({
      capabilityId: 1n, creator: A, bond: ethers.parseEther("0.01"),
      capabilityType: LORA, metadataCID: "ipfs://a", blockTimestamp: NOW - 100,
    });
    idb.certifyIndexedCapability(1n);
    idb.upsertIndexedCapability({
      capabilityId: 2n, creator: B, bond: ethers.parseEther("0.02"),
      capabilityType: LORA, metadataCID: "ipfs://b", blockTimestamp: NOW - 100,
    });
    idb.certifyIndexedCapability(2n);
    idb.bumpAgent(A, { completions: 3, confirmed: 2, lastActivity: NOW });
    idb.bumpAgent(B, { completions: 1, confirmed: 1, lastActivity: NOW });
    idb.setAgentIdentity(A, "ipfs://profileA");
  });

  afterAll(() => {
    for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });
  });

  it("indexes and counts capabilities", () => {
    expect(idb.countIndexedCapabilities("LoRA")).toBe(2);
    expect(idb.countIndexedCapabilities("Other")).toBe(0);
  });

  it("paginates discovery and carries identity", () => {
    const p0 = ix.queryIndexedDiscovery({ capabilityType: "LoRA", minScore: 0, offset: 0, limit: 1, now: NOW });
    const p1 = ix.queryIndexedDiscovery({ capabilityType: "LoRA", minScore: 0, offset: 1, limit: 1, now: NOW });
    expect(p0.total).toBe(2);
    expect(p0.items).toHaveLength(1);
    expect(p1.items).toHaveLength(1);
    expect(p0.items[0].capabilityId).not.toBe(p1.items[0].capabilityId);
    expect(p0.items[0].score).toBe(3); // self-attest fallback (useTwoSided=false)
    expect(p0.items.find((i) => i.capabilityId === "1")?.identityCID).toBe("ipfs://profileA");
  });

  it("filters by minScore", () => {
    expect(ix.queryIndexedDiscovery({ capabilityType: "LoRA", minScore: 3, offset: 0, limit: 10, now: NOW }).total).toBe(1);
  });

  it("mirrors the on-chain decay curve", () => {
    expect(ix.computeIndexedScore(2, 0, NOW - 10 * 24 * 3600, NOW)).toBe(2); // within grace
    expect(ix.computeIndexedScore(2, 0, NOW - (GRACE + 24 * 3600), NOW)).toBeLessThan(2); // past grace
    expect(ix.computeIndexedScore(2, 0, NOW - (GRACE + HORIZON + 24 * 3600), NOW)).toBe(0); // past horizon
    expect(ix.computeIndexedScore(1, 2, NOW, NOW)).toBe(0); // clamped at zero
  });

  it("records and lists alerts (newest first)", () => {
    idb.recordAlert("ChallengeSubmitted", 10, "0xabc", { completionId: "1" });
    idb.recordAlert("EthPoolWithdrawn", 11, "0xdef", { to: "0x1", amount: "1" });
    const alerts = idb.listAlerts(10);
    expect(alerts).toHaveLength(2);
    expect(alerts[0].kind).toBe("EthPoolWithdrawn");
    expect(alerts[0].payload).toEqual({ to: "0x1", amount: "1" });
  });

  it("de-duplicates logs by (txHash, index)", () => {
    expect(idb.alreadyIndexed("0xtx", 7)).toBe(false);
    idb.markIndexed("0xtx", 7, 100);
    expect(idb.alreadyIndexed("0xtx", 7)).toBe(true);
  });

  it("removes a capability from the index on withdraw", () => {
    idb.deleteIndexedCapability(2n);
    expect(idb.countIndexedCapabilities("LoRA")).toBe(1);
    expect(idb.queryIndexedCapabilities("LoRA").map((r) => r.capability_id)).toEqual([1]);
  });
});
