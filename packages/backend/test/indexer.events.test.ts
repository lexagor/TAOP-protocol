import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";

// Isolated temp DB before importing the modules that read DB_PATH.
const DB = `/tmp/taop-indexer-events-${process.pid}.db`;
process.env.DB_PATH = DB;
for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });

const { ethers } = await import("ethers");
const idb = await import("../src/index_db.js");
const ix = await import("../src/indexer.js");

const RON = "0x0000000000000000000000000000000000000002";
const deployment = {
  chainId: 84532,
  ron: RON,
  registry: "0x0000000000000000000000000000000000000001",
};

describe("indexer — v0.4 events reach the alert stream", () => {
  beforeAll(() => idb.initIndexSchema());
  afterAll(() => {
    for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });
  });

  it("records an alert for ChallengeCancelled without recording a dispute", async () => {
    const iface = new ethers.Interface([
      "event ChallengeCancelled(uint256 completionId, address indexed challenger)",
    ]);
    const fragment = iface.getEvent("ChallengeCancelled")!;
    const challenger = ethers.getAddress("0xabc0000000000000000000000000000000000001");
    const { topics, data } = iface.encodeEventLog(fragment, [7n, challenger]);
    const log = {
      address: RON,
      topics,
      data,
      blockNumber: 10,
      transactionHash: `0x${"11".repeat(32)}`,
      index: 0,
    };
    const provider = {
      getLogs: async () => [log],
      getBlock: async (n: number) => ({ number: n, timestamp: 1_000 }),
    };

    await ix.indexRange({ deployment, provider } as never, 10, 10);

    const alert = idb.listAlerts(5).find((a) => a.kind === "ChallengeCancelled");
    expect(alert?.payload).toEqual({
      completionId: "7",
      challenger: "0xabc0000000000000000000000000000000000001",
    });
    // Cancellation is not a ruling: no dispute is recorded for the agent.
    expect(ix.indexedCount("LoRA")).toBe(0);
  });
});
