/**
 * Outbound webhooks for the indexer alert stream (v0.4).
 *
 * Disabled by default: setting `TAOP_WEBHOOK_URL` turns it on. Deliveries are
 * ordered and at-least-once — a subscriber must de-duplicate on
 * `x-taop-delivery` (the alert id). When `TAOP_WEBHOOK_SECRET` is set, each
 * request carries `x-taop-signature: sha256=<hex hmac of the raw body>`.
 *
 * Env:
 *   TAOP_WEBHOOK_URL          subscriber endpoint (enables the dispatcher)
 *   TAOP_WEBHOOK_SECRET       HMAC-SHA256 signing secret (optional)
 *   TAOP_WEBHOOK_POLL_MS      poll interval (default 5000)
 *   TAOP_WEBHOOK_TIMEOUT_MS   per-delivery timeout (default 10000)
 *   TAOP_WEBHOOK_MAX_PER_POLL max alerts per poll (default 25)
 *   TAOP_WEBHOOK_ALLOW_PRIVATE allow loopback/private targets (default false)
 *   TAOP_WEBHOOK_ALLOW_HTTP   allow plaintext http to public hosts (default false)
 */

import crypto from "node:crypto";

import { getMeta, setMeta } from "./db.js";
import { countAlertsAfter, listAlertsAfter } from "./index_db.js";

export interface WebhookConfig {
  url: string;
  secret: string | null;
  pollMs: number;
  timeoutMs: number;
  maxPerPoll: number;
}

interface AlertRecord {
  id: number;
  kind: string;
  blockNumber: number;
  txHash: string;
  payload: unknown;
  createdAt: string;
}

export interface WebhookStatus {
  enabled: boolean;
  /** Set when TAOP_WEBHOOK_URL is present but rejected by validation. */
  configError: string | null;
  lastDeliveredId: number;
  pending: number;
  delivered: number;
  failed: number;
  lastError: string | null;
  lastDeliveredAt: string | null;
}

const LAST_ID_KEY = "webhook_last_alert_id";
const DELIVERED_KEY = "webhook_delivered";
const FAILED_KEY = "webhook_failed";
const STREAK_KEY = "webhook_fail_streak";
const ERROR_KEY = "webhook_last_error";
const DELIVERED_AT_KEY = "webhook_last_delivered_at";
const NEXT_ATTEMPT_KEY = "webhook_next_attempt_ms";

const MAX_BACKOFF_MS = 5 * 60 * 1000;

const intEnv = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/**
 * Loopback / private / link-local / mDNS hostnames. Delivery to these is
 * refused unless explicitly allowed — an operator typo (or a compromised env
 * file) should not turn the backend into an SSRF probe of its own network.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "0.0.0.0" || host === "::" || host === "::1") return true;
  if (host.startsWith("::ffff:")) return isPrivateHost(host.slice("::ffff:".length));
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // fe80::/10 link-local
  return false;
}

/** Validate a subscriber URL; throws with an actionable message on refusal. */
export function validateWebhookUrl(raw: string, env: NodeJS.ProcessEnv = process.env): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`TAOP_WEBHOOK_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`TAOP_WEBHOOK_URL must be http(s), got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("TAOP_WEBHOOK_URL must not embed credentials");
  }
  const privateHost = isPrivateHost(url.hostname);
  if (privateHost && env.TAOP_WEBHOOK_ALLOW_PRIVATE !== "true") {
    throw new Error(
      `refusing private/loopback webhook target '${url.hostname}': ` +
        "set TAOP_WEBHOOK_ALLOW_PRIVATE=true if this is intentional",
    );
  }
  if (url.protocol === "http:" && !privateHost && env.TAOP_WEBHOOK_ALLOW_HTTP !== "true") {
    throw new Error(
      "refusing plaintext http:// webhook target: use https, or set TAOP_WEBHOOK_ALLOW_HTTP=true",
    );
  }
  return url.toString();
}

export function loadWebhookConfig(env: NodeJS.ProcessEnv = process.env): WebhookConfig | null {
  const url = (env.TAOP_WEBHOOK_URL ?? "").trim();
  if (!url) return null;
  return {
    url: validateWebhookUrl(url, env),
    secret: (env.TAOP_WEBHOOK_SECRET ?? "").trim() || null,
    pollMs: intEnv(env.TAOP_WEBHOOK_POLL_MS, 5_000),
    timeoutMs: intEnv(env.TAOP_WEBHOOK_TIMEOUT_MS, 10_000),
    maxPerPoll: intEnv(env.TAOP_WEBHOOK_MAX_PER_POLL, 25),
  };
}

/** `sha256=<hex>` HMAC of the raw request body. */
export function signPayload(secret: string, body: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Constant-time verification of an `x-taop-signature` header value. */
export function verifySignature(
  secret: string,
  body: string,
  header: string | null | undefined,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(signPayload(secret, body));
  const received = Buffer.from(header);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export function buildDeliveryBody(alert: AlertRecord, now = new Date().toISOString()): string {
  return JSON.stringify({
    id: alert.id,
    source: "taop-indexer",
    kind: alert.kind,
    blockNumber: alert.blockNumber,
    txHash: alert.txHash,
    createdAt: alert.createdAt,
    deliveredAt: now,
    payload: alert.payload,
  });
}

async function deliverAlert(
  config: WebhookConfig,
  alert: AlertRecord,
  fetchImpl: typeof fetch,
): Promise<void> {
  const body = buildDeliveryBody(alert);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "taop-webhooks/1.0",
    "x-taop-delivery": String(alert.id),
    "x-taop-kind": alert.kind,
  };
  if (config.secret) headers["x-taop-signature"] = signPayload(config.secret, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetchImpl(config.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

export function lastDeliveredId(): number {
  return Number(getMeta(LAST_ID_KEY) ?? "0") || 0;
}

/**
 * Delivery cursor for retention: the id of the newest delivered alert when
 * webhooks are enabled, otherwise MAX_SAFE_INTEGER (no protection needed). An
 * invalid configuration also returns MAX (nothing is being delivered).
 */
export function lastDeliveredIdIfEnabled(): number {
  try {
    return loadWebhookConfig() ? lastDeliveredId() : Number.MAX_SAFE_INTEGER;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export function webhookStatus(env: NodeJS.ProcessEnv = process.env): WebhookStatus {
  let config: WebhookConfig | null = null;
  let configError: string | null = null;
  try {
    config = loadWebhookConfig(env);
  } catch (e) {
    configError = String((e as Error).message ?? e);
  }
  const lastId = lastDeliveredId();
  // The index schema may not exist yet (indexer disabled / early boot).
  let pending = 0;
  try {
    pending = countAlertsAfter(lastId);
  } catch {
    pending = 0;
  }
  return {
    enabled: config !== null,
    configError,
    lastDeliveredId: lastId,
    pending,
    delivered: Number(getMeta(DELIVERED_KEY) ?? "0") || 0,
    failed: Number(getMeta(FAILED_KEY) ?? "0") || 0,
    lastError: getMeta(ERROR_KEY) || null,
    lastDeliveredAt: getMeta(DELIVERED_AT_KEY) || null,
  };
}

/**
 * Reset counters (ops replay; used by tests). `fromId` becomes the new cursor:
 * alerts with an id at or below it are considered delivered.
 */
export function resetWebhookState(fromId = 0): void {
  setMeta(LAST_ID_KEY, String(Math.max(0, Math.floor(fromId))));
  setMeta(DELIVERED_KEY, "0");
  setMeta(FAILED_KEY, "0");
  setMeta(STREAK_KEY, "0");
  setMeta(ERROR_KEY, "");
  setMeta(DELIVERED_AT_KEY, "");
  setMeta(NEXT_ATTEMPT_KEY, "0");
}

/**
 * Deliver every alert newer than the cursor, oldest first. A failure stops the
 * batch (ordered at-least-once) and applies exponential backoff before the next
 * attempt. Returns counters for tests/ops.
 */
export async function pollWebhooksOnce(
  opts: { config?: WebhookConfig | null; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<{ delivered: number; failed: number; lastId: number }> {
  const config = opts.config ?? loadWebhookConfig();
  const lastIdStart = lastDeliveredId();
  if (!config) return { delivered: 0, failed: 0, lastId: lastIdStart };

  const now = opts.now ?? Date.now();
  if (now < (Number(getMeta(NEXT_ATTEMPT_KEY) ?? "0") || 0)) {
    return { delivered: 0, failed: 0, lastId: lastIdStart };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  let delivered = 0;
  let failed = 0;
  let lastId = lastIdStart;

  for (const alert of listAlertsAfter(lastId, config.maxPerPoll)) {
    try {
      await deliverAlert(config, alert, fetchImpl);
      lastId = alert.id;
      setMeta(LAST_ID_KEY, String(lastId));
      setMeta(DELIVERED_KEY, String((Number(getMeta(DELIVERED_KEY) ?? "0") || 0) + 1));
      setMeta(STREAK_KEY, "0");
      setMeta(ERROR_KEY, "");
      setMeta(DELIVERED_AT_KEY, new Date().toISOString());
      setMeta(NEXT_ATTEMPT_KEY, "0");
      delivered += 1;
    } catch (e) {
      const message = String((e as Error).message ?? e);
      const streak = (Number(getMeta(STREAK_KEY) ?? "0") || 0) + 1;
      setMeta(STREAK_KEY, String(streak));
      setMeta(FAILED_KEY, String((Number(getMeta(FAILED_KEY) ?? "0") || 0) + 1));
      setMeta(ERROR_KEY, message);
      const backoff = Math.min(config.pollMs * 2 ** streak, MAX_BACKOFF_MS);
      setMeta(NEXT_ATTEMPT_KEY, String(Date.now() + backoff));
      failed += 1;
      break;
    }
  }

  return { delivered, failed, lastId };
}

let timer: NodeJS.Timeout | null = null;

/** Start the background dispatcher; returns false when no URL is configured. */
export function startWebhookDispatcher(config: WebhookConfig | null = loadWebhookConfig()): boolean {
  if (!config || timer) return false;
  timer = setInterval(() => {
    void pollWebhooksOnce({ config }).catch(() => {});
  }, config.pollMs);
  timer.unref?.();
  void pollWebhooksOnce({ config }).catch(() => {});
  return true;
}

export function stopWebhookDispatcher(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
