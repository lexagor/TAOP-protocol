#!/usr/bin/env node
/**
 * Minimal webhook receiver for the local end-to-end run: appends every delivery
 * as a JSON line to E2E_WEBHOOK_OUT and verifies the HMAC signature so the E2E
 * can assert end-to-end signing. `GET /healthz` is a readiness probe and is not
 * recorded.
 */
import http from "node:http";
import crypto from "node:crypto";
import { appendFileSync } from "node:fs";

const PORT = Number(process.env.E2E_WEBHOOK_PORT || 4199);
const OUT = process.env.E2E_WEBHOOK_OUT || "/tmp/taop-e2e-webhooks.jsonl";
const SECRET = process.env.E2E_WEBHOOK_SECRET || "";

const server = http.createServer((req, res) => {
  if (req.method === "GET") {
    res.statusCode = 200;
    res.end("ok");
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const header = req.headers["x-taop-signature"] ?? null;
    let signatureValid = null;
    if (SECRET) {
      const expected = `sha256=${crypto.createHmac("sha256", SECRET).update(body).digest("hex")}`;
      signatureValid =
        header !== null &&
        expected.length === header.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
    }
    try {
      appendFileSync(
        OUT,
        `${JSON.stringify({ headers: req.headers, body: JSON.parse(body), signatureValid })}\n`,
      );
    } catch (e) {
      appendFileSync(OUT, `${JSON.stringify({ error: String(e), raw: body })}\n`);
    }
    res.statusCode = 200;
    res.end("ok");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(`webhook receiver listening on 127.0.0.1:${PORT} -> ${OUT}`);
});
