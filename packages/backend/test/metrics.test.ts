import { describe, it, expect } from "vitest";
import request from "supertest";
import { rmSync } from "node:fs";

// Isolated temp DB (metrics reads alert/webhook counters).
const DB = `/tmp/taop-metrics-${process.pid}.db`;
process.env.DB_PATH = DB;
for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });

process.env.TAOP_NO_AUTOSTART = "true";
process.env.HOST = "127.0.0.1";
process.env.DEMO_READ_ONLY = "true";
delete process.env.TAOP_WEBHOOK_URL;

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
  provider: { getBlockNumber: async () => 7 },
  ron: { paused: async () => false },
  registryOracle: { paused: async () => false },
  timelockDelay: 0n,
  capabilityId: 1n,
} as never);

describe("GET /api/metrics", () => {
  it("exposes Prometheus text metrics", async () => {
    await request(app).get("/api/healthz"); // generate one 2xx API request

    const res = await request(app).get("/api/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("# TYPE taop_uptime_seconds gauge");
    expect(res.text).toContain("taop_writes_disabled 1");
    expect(res.text).toContain("taop_indexer_enabled 0");
    expect(res.text).toContain("taop_webhooks_enabled 0");
    expect(res.text).toMatch(/taop_http_requests_total\{method="GET",status="2xx"\} \d+/);
    expect(res.text).not.toContain("TAOP_WEBHOOK_SECRET");
  });

  it("serves an OpenAPI spec that includes the new endpoints", async () => {
    const res = await request(app).get("/api/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.paths["/metrics"]).toBeTruthy();
    expect(res.body.paths["/agents/register"]).toBeTruthy();
    expect(res.body.paths["/agents/{address}/identity"]).toBeTruthy();
    expect(res.body.paths["/healthz"].get.responses["200"].content["application/json"].schema.properties.webhooks).toBeTruthy();
  });
});
