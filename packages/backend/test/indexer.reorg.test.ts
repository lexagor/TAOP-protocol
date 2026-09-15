import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";

// Isolated temp DB before importing the modules that read DB_PATH.
const DB = `/tmp/taop-indexer-reorg-${process.pid}.db`;
process.env.DB_PATH = DB;
for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });

const idb = await import("../src/index_db.js");
const { db } = await import("../src/db.js");
const ix = await import("../src/indexer.js");

const deployment = {
  chainId: 84532,
  ron: "0x0000000000000000000000000000000000000002",
  registry: "0x0000000000000000000000000000000000000001",
};

function makeProvider(head: number, hashes: Record<number, string>) {
  return {
    getBlockNumber: async () => head,
    getBlock: async (n: number) => ({ number: n, hash: hashes[n] ?? `0x${BigInt(n).toString(16).padStart(64, "0")}` }),
    getLogs: async () => [],
  };
}

const OPTS = { startBlock: 0, chunkSize: 1000, confirmations: 5, maxChunks: 20 };

const scoreCount = () => (db().prepare("SELECT COUNT(*) AS n FROM agent_scores").get() as { n: number }).n;

describe("F10 indexer — confirmation depth + reorg safety", () => {
  beforeAll(() => idb.initIndexSchema());
  afterAll(() => {
    for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });
  });

  it("only indexes up to head - confirmations", async () => {
    idb.setIndexerLastBlock(0);
    idb.setIndexerLastHash("");
    await ix.pollOnce({ provider: makeProvider(100, {}), deployment } as never, OPTS);
    expect(idb.getIndexerLastBlock()).toBe(95); // 100 - 5
    expect(ix.indexerStatus().safeHead).toBe(95);
    expect(ix.indexerStatus().lag).toBe(5);
  });

  it("does nothing when head is below the confirmation depth", async () => {
    idb.setIndexerLastBlock(0);
    idb.setIndexerLastHash("");
    await ix.pollOnce({ provider: makeProvider(3, {}), deployment } as never, OPTS);
    expect(ix.indexerStatus().safeHead).toBe(0);
    expect(idb.getIndexerLastBlock()).toBe(0);
  });

  it("detects a reorg at the cursor and rebuilds derived state", async () => {
    // Simulate previously-indexed derived state + a stored cursor hash.
    idb.bumpAgent("0xabc", { completions: 5, confirmed: 3, lastActivity: 1 });
    expect(scoreCount()).toBe(1);
    idb.setIndexerLastBlock(10);
    idb.setIndexerLastHash("0xaaaa");

    // The chain now has a different hash at block 10 → reorg.
    const before = ix.indexerStatus().reorgsDetected;
    await ix.pollOnce({ provider: makeProvider(100, { 10: "0xbbbb" }), deployment } as never, OPTS);

    expect(ix.indexerStatus().reorgsDetected).toBe(before + 1);
    // Derived state was cleared; a rebuild from logs (none here) leaves it empty.
    expect(scoreCount()).toBe(0);
    expect(idb.getIndexerLastBlock()).toBe(95);
  });

  it("does not treat a matching cursor hash as a reorg", async () => {
    idb.setIndexerLastBlock(50);
    idb.setIndexerLastHash("0x" + "aa".repeat(32));
    const before = ix.indexerStatus().reorgsDetected;
    await ix.pollOnce({ provider: makeProvider(100, { 50: "0x" + "aa".repeat(32) }), deployment } as never, OPTS);
    expect(ix.indexerStatus().reorgsDetected).toBe(before);
    expect(idb.getIndexerLastBlock()).toBe(95);
  });
});
