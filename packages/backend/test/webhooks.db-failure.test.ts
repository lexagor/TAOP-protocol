import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync, rmSync } from "node:fs";

// A regular file standing in for a directory makes SQLite open() fail, which
// simulates a read-only rootfs / full disk at the DB path.
const BLOCKER = `/tmp/taop-db-blocker-${process.pid}`;
writeFileSync(BLOCKER, "not a directory\n");
process.env.DB_PATH = `${BLOCKER}/taop.db`;
delete process.env.TAOP_WEBHOOK_URL;

const wh = await import("../src/webhooks.js");

afterAll(() => rmSync(BLOCKER, { force: true }));

describe("webhook status with an unwritable database", () => {
  it("degrades to zeros instead of throwing (healthz/metrics stay up)", () => {
    const status = wh.webhookStatus({ TAOP_WEBHOOK_URL: "https://hooks.example.com/taop" });
    expect(status.enabled).toBe(true);
    expect(status.configError).toBeNull();
    expect(status.pending).toBe(0);
    expect(status.lastDeliveredId).toBe(0);
    expect(status.delivered).toBe(0);
    expect(status.failed).toBe(0);
    expect(status.lastError).toBeNull();
  });
});
