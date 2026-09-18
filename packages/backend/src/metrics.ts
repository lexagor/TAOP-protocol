/**
 * Prometheus metrics (text exposition format) for the backend.
 *
 * Exposed at `GET /api/metrics` like `/api/healthz`: read-only, no auth, and
 * bounded label cardinality (method + status class, never the path). Values
 * come from the indexer/webhook state — no extra RPC calls per scrape.
 */
import type { NextFunction, Request, Response } from "express";

import { db } from "./db.js";
import { countAlertsAfter } from "./index_db.js";
import { indexerStatus } from "./indexer.js";
import { webhookStatus } from "./webhooks.js";

const httpRequests = new Map<string, { method: string; status: string; count: number }>();

/** Count every HTTP response by method + status class (2xx/4xx/...) . */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    const status = `${Math.floor(res.statusCode / 100)}xx`;
    const key = `${req.method}:${status}`;
    const entry = httpRequests.get(key);
    if (entry) entry.count += 1;
    else httpRequests.set(key, { method: req.method, status, count: 1 });
  });
  next();
}

const escapeLabel = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

const formatValue = (value: number): string => (Number.isFinite(value) ? String(value) : "0");

function metric(
  name: string,
  help: string,
  type: "counter" | "gauge",
  samples: Array<{ labels?: Record<string, string>; value: number }>,
): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
  for (const sample of samples) {
    const labels = sample.labels
      ? `{${Object.entries(sample.labels)
          .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
          .join(",")}}`
      : "";
    lines.push(`${name}${labels} ${formatValue(sample.value)}`);
  }
  return lines.join("\n");
}

export function renderPrometheus(): string {
  const ix = indexerStatus();
  const wh = webhookStatus();

  let alertsStored: number | null = null;
  try {
    alertsStored = countAlertsAfter(0);
  } catch {
    alertsStored = null;
  }

  let capabilitiesIndexed: number | null = null;
  try {
    const row = db().prepare("SELECT COUNT(*) AS n FROM capabilities").get() as { n: number };
    capabilitiesIndexed = row.n;
  } catch {
    capabilitiesIndexed = null;
  }

  const parts: string[] = [
    metric("taop_uptime_seconds", "Backend process uptime in seconds.", "gauge", [
      { value: Math.round(process.uptime()) },
    ]),
    metric(
      "taop_writes_disabled",
      "1 when DEMO_READ_ONLY=true (all write routes return 503).",
      "gauge",
      [{ value: process.env.DEMO_READ_ONLY === "true" ? 1 : 0 }],
    ),
    metric("taop_indexer_enabled", "1 when the off-chain indexer is running.", "gauge", [
      { value: ix.enabled ? 1 : 0 },
    ]),
    metric("taop_indexer_ready", "1 once the index has data and a live cursor.", "gauge", [
      { value: ix.ready ? 1 : 0 },
    ]),
    metric("taop_indexer_last_block", "Last fully indexed block.", "gauge", [
      { value: ix.lastBlock },
    ]),
    metric("taop_indexer_head_block", "Chain head observed by the indexer.", "gauge", [
      { value: ix.headBlock },
    ]),
    metric("taop_indexer_lag_blocks", "head_block - last_block.", "gauge", [
      { value: ix.lag },
    ]),
    metric("taop_indexer_reorgs_total", "Chain reorganizations detected and rebuilt.", "counter", [
      { value: ix.reorgsDetected },
    ]),
    metric("taop_indexer_alerts_pruned_total", "Alert rows removed by retention.", "counter", [
      { value: ix.alertsPruned },
    ]),
    metric(
      "taop_indexer_log_markers_pruned_total",
      "Idempotency log markers removed by retention.",
      "counter",
      [{ value: ix.markersPruned }],
    ),
    metric("taop_webhooks_enabled", "1 when a valid webhook subscriber is configured.", "gauge", [
      { value: wh.enabled ? 1 : 0 },
    ]),
    metric("taop_webhooks_pending", "Alerts not yet delivered to the subscriber.", "gauge", [
      { value: wh.pending },
    ]),
    metric("taop_webhooks_last_delivered_id", "Id of the newest delivered alert.", "gauge", [
      { value: wh.lastDeliveredId },
    ]),
    metric("taop_webhooks_delivered_total", "Successful webhook deliveries.", "counter", [
      { value: wh.delivered },
    ]),
    metric("taop_webhooks_failed_total", "Failed webhook delivery attempts.", "counter", [
      { value: wh.failed },
    ]),
    metric("taop_http_requests_total", "HTTP responses by method and status class.", "counter", [
      ...[...httpRequests.values()].map((entry) => ({
        labels: { method: entry.method, status: entry.status },
        value: entry.count,
      })),
    ]),
  ];

  if (alertsStored !== null) {
    parts.push(
      metric("taop_alerts_stored", "Alert rows currently stored (after retention).", "gauge", [
        { value: alertsStored },
      ]),
    );
  }
  if (capabilitiesIndexed !== null) {
    parts.push(
      metric("taop_capabilities_indexed", "Capabilities known to the index.", "gauge", [
        { value: capabilitiesIndexed },
      ]),
    );
  }

  return `${parts.join("\n")}\n`;
}
