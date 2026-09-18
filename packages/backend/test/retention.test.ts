import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";

// Isolated temp DB before importing the modules that read DB_PATH.
const DB = `/tmp/taop-retention-${process.pid}.db`;
process.env.DB_PATH = DB;
for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });

const idb = await import("../src/index_db.js");

describe("database retention", () => {
  beforeAll(() => idb.initIndexSchema());
  afterAll(() => {
    for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });
  });

  it("keeps the newest N alerts and deletes the rest", () => {
    for (let i = 0; i < 30; i += 1) idb.recordAlert("Test", i, `0xaa${i}`, { i });
    expect(idb.pruneAlerts(10)).toBe(20);
    const remaining = idb.listAlerts(100);
    expect(remaining).toHaveLength(10);
    expect(remaining[0].payload).toEqual({ i: 29 });
    expect(remaining[remaining.length - 1].payload).toEqual({ i: 20 });
  });

  it("never prunes alerts above the webhook delivery cursor", () => {
    for (let i = 0; i < 10; i += 1) idb.recordAlert("Test2", 100 + i, `0xbb${i}`, { i });
    const all = idb.listAlerts(100); // 20 rows, newest first
    expect(all).toHaveLength(20);
    const deliveredUpTo = all[10].id; // pretend the 10 newest are not delivered yet

    // keep=10 would normally delete 10 rows; the cursor clamps it to delivered rows
    expect(idb.pruneAlerts(10, deliveredUpTo)).toBe(10);
    const remaining = idb.listAlerts(100);
    expect(remaining).toHaveLength(10);
    expect(remaining.every((a) => a.id > deliveredUpTo)).toBe(true);
  });

  it("disables pruning when keep <= 0", () => {
    expect(idb.pruneAlerts(0)).toBe(0);
    expect(idb.pruneAlerts(-5)).toBe(0);
    expect(idb.listAlerts(100).length).toBeGreaterThan(0);
  });

  it("prunes idempotency markers older than the retention window", () => {
    for (const block of [10, 20, 30, 40, 50]) {
      idb.markIndexed(`0xtx${block}`, 0, block);
    }
    // keep the last 20 blocks relative to head 50 -> drop blocks < 30
    expect(idb.pruneIndexedLogs(50, 20)).toBe(2);
    expect(idb.alreadyIndexed("0xtx10", 0)).toBe(false);
    expect(idb.alreadyIndexed("0xtx20", 0)).toBe(false);
    expect(idb.alreadyIndexed("0xtx30", 0)).toBe(true);
  });

  it("disables marker pruning when keepBlocks <= 0", () => {
    expect(idb.pruneIndexedLogs(1000, 0)).toBe(0);
  });
});
