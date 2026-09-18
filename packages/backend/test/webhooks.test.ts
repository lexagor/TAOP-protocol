import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { rmSync } from "node:fs";

// Isolated temp DB before importing the modules that read DB_PATH.
const DB = `/tmp/taop-webhooks-${process.pid}.db`;
process.env.DB_PATH = DB;
for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });

const idb = await import("../src/index_db.js");
const wh = await import("../src/webhooks.js");

interface Captured {
  headers: http.IncomingHttpHeaders;
  body: string;
}

const servers: http.Server[] = [];

async function startHook(failures = 0): Promise<{ url: string; received: Captured[] }> {
  const received: Captured[] = [];
  let remainingFailures = failures;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        res.statusCode = 500;
        res.end("fail");
        return;
      }
      res.statusCode = 200;
      res.end("ok");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/hook`, received };
}

const cfg = (
  url: string,
  secret: string | null,
): { url: string; secret: string | null; pollMs: number; timeoutMs: number; maxPerPoll: number } => ({
  url,
  secret,
  pollMs: 1_000,
  timeoutMs: 2_000,
  maxPerPoll: 10,
});

describe("outbound webhooks (v0.4)", () => {
  beforeAll(() => idb.initIndexSchema());
  afterAll(async () => {
    for (const server of servers) await new Promise((r) => server.close(r));
    for (const s of ["", "-wal", "-shm"]) rmSync(`${DB}${s}`, { force: true });
  });

  it("delivers alerts in order with an HMAC signature and does not repeat them", async () => {
    wh.resetWebhookState(idb.listAlerts(1)[0]?.id ?? 0);
    const { url, received } = await startHook();
    idb.recordAlert("ChallengeSubmitted", 10, `0x${"aa".repeat(32)}`, { completionId: "1" });
    idb.recordAlert("ChallengeResolved", 11, `0x${"bb".repeat(32)}`, { completionId: "1", upheld: true });

    const result = await wh.pollWebhooksOnce({ config: cfg(url, "s3cret"), fetchImpl: fetch });
    expect(result.delivered).toBe(2);
    expect(result.failed).toBe(0);
    expect(received).toHaveLength(2);

    expect(received[0].headers["x-taop-delivery"]).toBe("1");
    expect(received[0].headers["x-taop-kind"]).toBe("ChallengeSubmitted");
    expect(received[1].headers["x-taop-delivery"]).toBe("2");
    expect(wh.verifySignature("s3cret", received[0].body, String(received[0].headers["x-taop-signature"]))).toBe(true);
    expect(wh.verifySignature("wrong", received[0].body, String(received[0].headers["x-taop-signature"]))).toBe(false);

    const body = JSON.parse(received[1].body) as {
      kind: string;
      txHash: string;
      payload: { upheld: boolean };
    };
    expect(body.kind).toBe("ChallengeResolved");
    expect(body.txHash).toBe(`0x${"bb".repeat(32)}`);
    expect(body.payload.upheld).toBe(true);

    const second = await wh.pollWebhooksOnce({ config: cfg(url, "s3cret"), fetchImpl: fetch });
    expect(second.delivered).toBe(0);
    expect(received).toHaveLength(2);
    const status = wh.webhookStatus({ TAOP_WEBHOOK_URL: url, TAOP_WEBHOOK_ALLOW_PRIVATE: "true" });
    expect(status.enabled).toBe(true);
    expect(status.pending).toBe(0);
  });

  it("retries the same alert after a failure, with backoff, without losing order", async () => {
    wh.resetWebhookState(idb.listAlerts(1)[0]?.id ?? 0);
    const { url, received } = await startHook(1);
    idb.recordAlert("ChallengeCancelled", 12, `0x${"cc".repeat(32)}`, { completionId: "2" });

    const first = await wh.pollWebhooksOnce({ config: cfg(url, null), fetchImpl: fetch });
    expect(first.failed).toBe(1);
    expect(first.delivered).toBe(0);
    expect(received).toHaveLength(1);

    // Backoff: an immediate retry is skipped.
    const skipped = await wh.pollWebhooksOnce({ config: cfg(url, null), fetchImpl: fetch });
    expect(skipped.delivered).toBe(0);
    expect(received).toHaveLength(1);
    expect(wh.webhookStatus().lastError).toContain("500");

    // After the backoff window the same alert is delivered.
    const later = await wh.pollWebhooksOnce({
      config: cfg(url, null),
      fetchImpl: fetch,
      now: Date.now() + 10 * 60_000,
    });
    expect(later.delivered).toBe(1);
    expect(received).toHaveLength(2);
    expect(received[0].headers["x-taop-delivery"]).toBe(received[1].headers["x-taop-delivery"]);
    expect(wh.webhookStatus().pending).toBe(0);
    expect(wh.webhookStatus().lastDeliveredId).toBeGreaterThan(0);
  });

  it("omits the signature header when no secret is configured", async () => {
    wh.resetWebhookState(idb.listAlerts(1)[0]?.id ?? 0);
    const { url, received } = await startHook();
    idb.recordAlert("EthPoolWithdrawn", 13, `0x${"dd".repeat(32)}`, { amount: "1" });

    await wh.pollWebhooksOnce({ config: cfg(url, null), fetchImpl: fetch });
    expect(received).toHaveLength(1);
    expect(received[0].headers["x-taop-signature"]).toBeUndefined();
    expect(received[0].headers["content-type"]).toBe("application/json");
  });
});

describe("webhook URL validation (SSRF hygiene)", () => {
  it("accepts a public https URL and normalizes it", () => {
    const url = wh.validateWebhookUrl("https://hooks.example.com/taop");
    expect(url).toBe("https://hooks.example.com/taop");
  });

  it("rejects non-http(s) schemes and embedded credentials", () => {
    expect(() => wh.validateWebhookUrl("ftp://example.com/hook")).toThrow(/http\(s\)/);
    expect(() => wh.validateWebhookUrl("file:///etc/passwd")).toThrow(/http\(s\)/);
    expect(() => wh.validateWebhookUrl("https://user:pass@example.com/hook")).toThrow(/credentials/);
    expect(() => wh.validateWebhookUrl("not a url")).toThrow(/valid URL/);
  });

  it("refuses plaintext http to public hosts unless explicitly allowed", () => {
    expect(() => wh.validateWebhookUrl("http://hooks.example.com/taop")).toThrow(/plaintext/);
    expect(wh.validateWebhookUrl("http://hooks.example.com/taop", { TAOP_WEBHOOK_ALLOW_HTTP: "true" })).toBe(
      "http://hooks.example.com/taop",
    );
  });

  it("refuses loopback/private/link-local targets unless explicitly allowed", () => {
    const targets = [
      "http://127.0.0.1:4199/hook",
      "http://localhost/hook",
      "http://10.0.0.5/hook",
      "http://172.16.0.9/hook",
      "http://192.168.1.1/hook",
      "http://169.254.1.1/hook",
      "http://0.0.0.0/hook",
      "http://[::1]/hook",
      "http://printer.local/hook",
    ];
    for (const target of targets) {
      expect(() => wh.validateWebhookUrl(target), target).toThrow(/private\/loopback/);
    }
    expect(
      wh.validateWebhookUrl("http://127.0.0.1:4199/hook", { TAOP_WEBHOOK_ALLOW_PRIVATE: "true" }),
    ).toBe("http://127.0.0.1:4199/hook");
  });

  it("reports a rejected configuration through webhookStatus instead of throwing", () => {
    const status = wh.webhookStatus({ TAOP_WEBHOOK_URL: "http://169.254.169.254/latest/meta-data" });
    expect(status.enabled).toBe(false);
    expect(status.configError).toMatch(/private\/loopback/);
  });
});
