import "dotenv/config";
import { logger } from "./logger.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { ethers } from "ethers";
import path from "node:path";
import fs from "node:fs";
import { initState, type BackendState } from "./contracts.js";
import { runDemo } from "./demo.js";
import { LORA_CAPABILITY_TYPE } from "@taopp/sdk";
import { listCapabilities, listCompletions, markCompletionChallenged, markCompletionResolved } from "./db.js";
import { startIndexer, queryIndexedDiscovery, isIndexerReady, indexedCount, indexerStatus } from "./indexer.js";
import { listAlerts } from "./index_db.js";
import { openApiSpec } from "./openapi.js";

export const app = express();
app.use(express.json({ limit: "256kb" }));
// Security headers. CSP is enabled (it was previously off) with `unsafe-inline`
// for scripts/styles only because Swagger UI bootstraps with an inline script and
// React/Tailwind may inject styles; external script origins and framing stay blocked.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);

// --- Phase 0 hardening: safe binding + write authorization + rate limits ---
// Threat model: this process holds wallet keys; several routes spend ETH, pin to
// IPFS, and (via /completions/:id/resolve) execute an *owner-only* action through
// the Timelock. It must therefore never be exposed to the public internet
// without an API key.
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4000);
const API_KEY = (process.env.TAOP_API_KEY ?? "").trim() || null;
const WRITES_DISABLED = process.env.DEMO_READ_ONLY === "true";

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "0:0:0:0:0:0:0:1";
}

if (!isLoopbackHost(HOST) && !API_KEY) {
  logger.error(
    `\n❌ REFUSING TO START: HOST=${HOST} exposes the API beyond localhost but TAOP_API_KEY is not set.\n` +
      `   This backend can spend bonds and execute owner-only Timelock actions.\n` +
      `   Fix: export TAOP_API_KEY=$(openssl rand -hex 32)   (or set HOST=127.0.0.1)\n`,
  );
  process.exit(1);
}

if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY));
}

const corsOrigin = (process.env.CORS_ORIGIN ?? "").trim();
app.use(corsOrigin ? cors({ origin: corsOrigin.split(",").map((s) => s.trim()) }) : cors());

const isWriteRequest = (req: { method: string }) => !["GET", "HEAD", "OPTIONS"].includes(req.method);

const readLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — slow down." },
});

const writeLimiter = rateLimit({
  windowMs: 5 * 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => !isWriteRequest(req),
  message: { error: "Too many write requests — this endpoint spends ETH; slow down." },
});

// The SPA fallback serves a file (index.html); rate-limit it too (static assets
// are handled by express.static). Generous so a normal page load is never throttled.
const spaFallbackLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — slow down." },
});

/** Gate for state-changing requests: read-only kill-switch + constant-time API key. */
function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Reads are always allowed (including on a read-only public instance).
  if (!isWriteRequest(req)) return next();
  // Monitoring/docs endpoints stay reachable even for non-GET probes.
  if (req.path === "/healthz" || req.path.startsWith("/docs") || req.path === "/openapi.json") return next();
  if (WRITES_DISABLED) {
    return res.status(503).json({ error: "Writes are disabled on this instance (DEMO_READ_ONLY=true)." });
  }
  if (!API_KEY) return next(); // loopback-only (enforced at startup)

  const provided = String(req.header("x-taop-key") ?? "");
  const a = Buffer.from(provided);
  const b = Buffer.from(API_KEY);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: "Unauthorized: missing or invalid X-TAOP-Key header." });
  return next();
}

const api = express.Router();
api.use(readLimiter);
api.use(writeLimiter);
api.use(requireApiKey);
let state: BackendState;

/** Test-only hook: inject a BackendState without starting the server/DB. */
export function setBackendState(s: BackendState): void {
  state = s;
}

function explorerBase(): string {
  return state.deployment.chainId === 84532
    ? "https://sepolia.basescan.org"
    : "https://basescan.org";
}

/** Read `paused()` defensively (absent/old contracts -> null). */
async function safePaused(client: { paused?: () => Promise<boolean> }): Promise<boolean | null> {
  try {
    return typeof client.paused === "function" ? await client.paused() : null;
  } catch {
    return null;
  }
}

/** v0.2/F10: JSON + ETag helper for cacheable read endpoints. */
function sendJsonWithEtag(
  req: express.Request,
  res: express.Response,
  body: unknown,
  headers: Record<string, string>,
): void {
  const json = JSON.stringify(body);
  const etag = `"${crypto.createHash("sha1").update(json).digest("hex")}"`;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, max-age=5");
  if (req.header("if-none-match") === etag) {
    res.status(304).end();
    return;
  }
  res.type("application/json").send(json);
}

/** Discovery via direct contract reads. Used as a fallback until the index is warm. */
async function onChainDiscover(typeLabel: string, minScore: number) {
  const ids = await state.registryOracle.getCapabilitiesByType(typeLabel);
  const out: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    // v0.1.2: one stale id (pre-fix index pollution, or burned elsewhere) must
    // never break the whole discovery response.
    let cap;
    try {
      cap = await state.registryOracle.getCapability(id);
    } catch {
      continue;
    }
    if (!cap.certified || cap.slashed) continue;
    const score = await state.ron.getRankingScore(cap.creator);
    const scoreNum = Number(score.score);
    if (scoreNum < minScore) continue;
    let identityCID = "";
    try {
      identityCID = await state.ron.getAgentMetadata(cap.creator);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      if (msg.includes("missing revert data") || msg.includes("CALL_EXCEPTION") || msg.includes("revert")) {
        identityCID = ""; // old contract
      } else {
        throw e;
      }
    }
    out.push({
      agentAddress: cap.creator,
      capabilityId: id.toString(),
      capabilityType: typeLabel,
      certified: cap.certified,
      slashed: cap.slashed,
      bond: ethers.formatEther(cap.bond),
      metadataCID: cap.metadataCID,
      identityCID,
      completions: Number(score.completions),
      disputes: Number(score.disputes),
      score: scoreNum,
      scoreType: score.scoreType,
    });
  }
  out.sort((a, b) => Number(b.score) - Number(a.score));
  return out;
}

api.get("/healthz", async (_req, res) => {
  // F12: liveness (`ok`) plus readiness detail operators can alert on.
  const startedAt = Date.now();
  let rpcOk = true;
  let blockNumber: number | null = null;
  let rpcError: string | null = null;
  try {
    blockNumber = await Promise.race([
      state.provider.getBlockNumber(),
      new Promise<number>((_, reject) => setTimeout(() => reject(new Error("rpc timeout")), 2500)),
    ]);
  } catch (e) {
    rpcOk = false;
    rpcError = String((e as Error).message ?? e);
  }
  const ix = indexerStatus();
  res.json({
    ok: true,
    service: "taop-backend",
    chainId: state.deployment.chainId,
    uptimeSec: Math.round(process.uptime()),
    writes: WRITES_DISABLED ? "disabled" : API_KEY ? "keyed" : "open-loopback",
    rpc: { ok: rpcOk, latencyMs: Date.now() - startedAt, blockNumber, error: rpcError },
    contracts: {
      ronPaused: await safePaused(state.ron),
      registryPaused: await safePaused(state.registryOracle),
    },
    indexer: {
      enabled: ix.enabled,
      ready: ix.ready,
      lag: ix.lag,
      lastBlock: ix.lastBlock,
      headBlock: ix.headBlock,
      safeHead: ix.safeHead,
      reorgsDetected: ix.reorgsDetected,
      twoSided: ix.useTwoSided,
      credit: ix.useCredit,
      lastError: ix.lastError,
    },
  });
});

api.get("/contracts", (_req, res) => {
  res.json({
    chainId: state.deployment.chainId,
    network: state.deployment.network ?? "localhost",
    ron: state.deployment.ron,
    registry: state.deployment.registry,
    timelock: state.deployment.timelock ?? null,
    timelockDelay: state.timelockDelay.toString(),
    validator: state.deployment.validator,
    agentA: state.deployment.agentA,
    capabilityId: state.capabilityId.toString(),
    explorerBase: explorerBase(),
  });
});

// --- Capabilities ---

api.get("/capabilities/:id", async (req, res) => {
  try {
    const cap = await state.registryOracle.getCapability(BigInt(req.params.id));
    res.json({
      capabilityId: req.params.id,
      creator: cap.creator,
      bond: ethers.formatEther(cap.bond),
      capabilityType: cap.capabilityType,
      metadataCID: cap.metadataCID,
      certified: cap.certified,
      slashed: cap.slashed,
    });
  } catch (e) {
    res.status(404).json({ error: String((e as Error).message ?? e) });
  }
});

api.get("/capabilities", async (_req, res) => {
  // Serve from DB cache; fall back to on-chain scan if DB empty.
  const cached = listCapabilities();
  if (cached.length > 0) {
    res.json(cached);
    return;
  }
  const total = await state.registryOracle.totalSupply();
  const out: unknown[] = [];
  for (let i = 0n; i < total; i++) {
    const id = await state.registryOracle.tokenByIndex(i);
    const cap = await state.registryOracle.getCapability(id);
    out.push({
      capabilityId: id.toString(),
      creator: cap.creator,
      bond: ethers.formatEther(cap.bond),
      capabilityType: cap.capabilityType,
      metadataCID: cap.metadataCID,
      certified: cap.certified,
      slashed: cap.slashed,
    });
  }
  res.json(out);
});

api.post("/capabilities/register", async (req, res) => {
  const { capabilityType, metadataCID, bondEther } = req.body ?? {};
  const bond = ethers.parseEther(String(bondEther ?? "0.01"));
  const { capabilityId, receipt } = await state.registryAgentA.registerCapabilityEth(
    String(capabilityType ?? LORA_CAPABILITY_TYPE),
    String(metadataCID ?? "ipfs://manual"),
    bond,
  );
  res.json({ capabilityId: capabilityId.toString(), txHash: receipt?.hash ?? null });
});

api.post("/capabilities/:id/certify", async (req, res) => {
  const receipt = await state.registryOracle.certifyCapability(BigInt(req.params.id));
  res.json({ txHash: receipt?.hash ?? null });
});

// --- Completions (MVP self-attest + challenge) ---

api.post("/completions/attest", async (req, res) => {
  try {
    const { taskType, resultCID } = req.body ?? {};
    const { completionId, receipt } = await state.ron.attestCompletion(
      String(taskType ?? LORA_CAPABILITY_TYPE),
      String(resultCID ?? `ipfs://result-${Date.now()}`),
    );
    res.json({ completionId: completionId.toString(), txHash: receipt?.hash ?? null });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

api.post("/completions/:id/challenge", async (req, res) => {
  try {
    // Use agentA runner for challenge in demo (it receives demo funding for the bond)
    // This avoids insufficient balance errors on the validator/deployer key after redeploys.
    state.agentARunner?.reset?.();
    const completionId = BigInt(req.params.id);
    const bond = await state.ron.challengeBond();

    // Pre-checks to avoid ugly "missing revert data" errors from estimateGas on reverts or low balance
    try {
      const c = await state.ron.getCompletion(completionId);
      if (!c.agent || c.agent === ethers.ZeroAddress) {
        return res.status(400).json({ error: "No such completion (id may be from a previous deployment). Run the live demo first to create a fresh one." });
      }
    } catch {
      return res.status(400).json({ error: "No such completion. Run the live demo first." });
    }

    const challengerAddr = await state.agentARunner.getAddress();
    const bal = await state.provider.getBalance(challengerAddr);
    if (bal < bond) {
      return res.status(400).json({ error: `Insufficient balance on challenger ${challengerAddr} (${ethers.formatEther(bal)} ETH) to post ${ethers.formatEther(bond)} ETH bond. Faucet more test ETH to the agentA address.` });
    }

    const receipt = await state.ronAgentA.challengeCompletion(
      completionId,
      String(req.body?.evidenceCID ?? "ipfs://challenge-evidence"),
      bond,
    );
    markCompletionChallenged(completionId);
    res.json({ txHash: receipt?.hash ?? null, bondWei: bond.toString() });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    // If contract revert (e.g. already challenged, no such, wrong bond), return as error but not crash
    if (msg.includes("missing revert data") || msg.includes("CALL_EXCEPTION") || msg.includes("revert") || msg.includes("nonce")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

api.post("/completions/:id/resolve", async (req, res) => {
  try {
    const upheld = Boolean(req.body?.upheld ?? false);
    const completionId = BigInt(req.params.id);

    state.oracleRunner?.reset?.();

    let receipt: any = null;
    if (state.executeViaTimelock) {
      // Call through Timelock (P0 hardened ownership). For non-zero delay, only schedules.
      const ronInterface = new ethers.Interface([
        "function resolveChallenge(uint256 completionId, bool upheld)"
      ]);
      const data = ronInterface.encodeFunctionData("resolveChallenge", [completionId, upheld]);
      const target = state.deployment.ron;
      const result = await state.executeViaTimelock(target, data);
      receipt = result.receipt;

      if (result.executed) {
        markCompletionResolved(completionId, upheld);
      }
      res.json({
        txHash: receipt?.hash ?? null,
        upheld,
        scheduled: result.scheduled,
        executed: result.executed,
        delay: result.delay.toString(),
        message: result.scheduled
          ? `Action scheduled on Timelock with ${result.delay}s delay. It will not take effect until executed after the delay.`
          : undefined,
      });
      return;
    } else {
      receipt = await state.ron.resolveChallenge(completionId, upheld);
      markCompletionResolved(completionId, upheld);
    }

    res.json({ txHash: receipt?.hash ?? null, upheld });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (msg.includes("missing revert data") || msg.includes("CALL_EXCEPTION") || msg.includes("revert") || msg.includes("nonce")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

// --- v0.3 admin controls (owner-only; routed through the Timelock when present) ---

async function ownerTx(fnName: string, args: unknown[], direct: () => Promise<{ hash?: string } | null>) {
  state.oracleRunner?.reset?.();
  if (state.executeViaTimelock) {
    const iface = new ethers.Interface([`function ${fnName}`]);
    const data = iface.encodeFunctionData(fnName, args);
    const r = await state.executeViaTimelock(state.deployment.ron, data);
    return { txHash: r.receipt?.hash ?? null, scheduled: r.scheduled, executed: r.executed };
  }
  const receipt = await direct();
  return { txHash: receipt?.hash ?? null, scheduled: false, executed: true };
}

api.post("/admin/pause", async (_req, res) => {
  try {
    res.json(await ownerTx("pause()", [], () => state.ron.pause()));
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    res.status(msg.includes("revert") || msg.includes("CALL_EXCEPTION") ? 400 : 500).json({ error: msg });
  }
});

api.post("/admin/unpause", async (_req, res) => {
  try {
    res.json(await ownerTx("unpause()", [], () => state.ron.unpause()));
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    res.status(msg.includes("revert") || msg.includes("CALL_EXCEPTION") ? 400 : 500).json({ error: msg });
  }
});

api.post("/admin/attest-cooldown", async (req, res) => {
  try {
    const cooldown = Number(req.body?.cooldown ?? 0);
    if (!Number.isInteger(cooldown) || cooldown < 0) return res.status(400).json({ error: "cooldown must be a non-negative integer (seconds)" });
    res.json(await ownerTx("setAttestCooldown(uint64)", [cooldown], () => state.ron.setAttestCooldown(cooldown)));
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    res.status(msg.includes("revert") || msg.includes("CALL_EXCEPTION") ? 400 : 500).json({ error: msg });
  }
});

api.get("/completions", (_req, res) => {
  res.json(listCompletions());
});

api.get("/completions/:id", async (req, res) => {
  try {
    const c = await state.ron.getCompletion(BigInt(req.params.id));
    let receiptCID = "";
    try {
      receiptCID = await state.ron.receiptCID(BigInt(req.params.id));
    } catch {
      receiptCID = ""; // pre-v0.2 contract without receipts
    }
    res.json({
      completionId: req.params.id,
      agent: c.agent,
      taskType: c.taskType,
      resultCID: c.resultCID,
      timestamp: c.timestamp.toString(),
      challenged: c.challenged,
      disputed: c.disputed,
      counterparty: c.counterparty ?? null,
      receiptTimestamp: c.receiptTimestamp?.toString() ?? "0",
      receiptCID,
    });
  } catch (e) {
    res.status(404).json({ error: String((e as Error).message ?? e) });
  }
});

// --- v0.2 two-sided attestation + optimistic challenge window ---

/** Counterparty countersigns a completion (demo: the independent oracle key). */
api.post("/completions/:id/receipt", async (req, res) => {
  try {
    const completionId = BigInt(req.params.id);
    state.oracleRunner?.reset?.();
    const receipt = await state.ron.attestReceipt(
      completionId,
      String(req.body?.receiptCID ?? "ipfs://requester-receipt"),
    );
    res.json({ txHash: receipt?.hash ?? null, completionId: completionId.toString() });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (msg.includes("missing revert data") || msg.includes("CALL_EXCEPTION") || msg.includes("revert") || msg.includes("nonce")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

/** Counterparty withdraws a receipt. */
api.post("/completions/:id/revoke-receipt", async (req, res) => {
  try {
    const completionId = BigInt(req.params.id);
    state.oracleRunner?.reset?.();
    const receipt = await state.ron.revokeReceipt(completionId);
    res.json({ txHash: receipt?.hash ?? null, completionId: completionId.toString() });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (msg.includes("missing revert data") || msg.includes("CALL_EXCEPTION") || msg.includes("revert") || msg.includes("nonce")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

/** Agent rebuts a challenge within the challenge window. */
api.post("/completions/:id/contest", async (req, res) => {
  try {
    const completionId = BigInt(req.params.id);
    state.agentARunner?.reset?.();
    const receipt = await state.ronAgentA.contestChallenge(
      completionId,
      String(req.body?.rebuttalCID ?? "ipfs://agent-rebuttal"),
    );
    res.json({ txHash: receipt?.hash ?? null, completionId: completionId.toString() });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (msg.includes("missing revert data") || msg.includes("CALL_EXCEPTION") || msg.includes("revert") || msg.includes("nonce")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

/** Anyone finalizes an uncontested challenge after the window (optimistic uphold). */
api.post("/completions/:id/finalize", async (req, res) => {
  try {
    const completionId = BigInt(req.params.id);
    state.oracleRunner?.reset?.();
    const receipt = await state.ron.finalizeChallenge(completionId);
    markCompletionResolved(completionId, true);
    res.json({ txHash: receipt?.hash ?? null, completionId: completionId.toString(), upheld: true });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (msg.includes("missing revert data") || msg.includes("CALL_EXCEPTION") || msg.includes("revert") || msg.includes("nonce")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

// --- Agent scores (MVP: self-attest score) ---

api.get("/agents/:address/score", async (req, res) => {
  try {
    // v0.1.2 contracts expose decay inputs; older deployments fall back to the
    // plain score view.
    const d = await state.ron.getScoreDetails(req.params.address);
    const payload: Record<string, unknown> = {
      completions: d.completions.toString(),
      disputes: d.disputes.toString(),
      score: d.score.toString(),
      lastActivity: d.lastActivity.toString(),
      decayBps: d.decayBps,
      // Ranking signal: credit (v0.3) > two-sided (v0.2) > self-attest.
      rankingScoreType: "self-attest",
    };
    try {
      const credit = await state.ron.getCreditScore(req.params.address);
      payload.distinctCounterparties = credit.distinctCounterparties.toString();
      payload.creditScore = credit.score.toString();
      payload.rankingScoreType = "credit";
    } catch {
      try {
        const two = await state.ron.getTwoSidedScore(req.params.address);
        payload.confirmed = two.confirmed.toString();
        payload.twoSidedScore = two.score.toString();
        payload.rankingScoreType = "two-sided";
      } catch {
        // pre-v0.2 contract — leave defaults
      }
    }
    res.json(payload);
  } catch {
    const s = await state.ron.getSelfAttestScore(req.params.address);
    res.json({
      completions: s.completions.toString(),
      disputes: s.disputes.toString(),
      score: s.score.toString(),
      rankingScoreType: "self-attest",
    });
  }
});

// --- Basic agent identity (Step 7) ---
api.get("/agents/:address/identity", async (req, res) => {
  let cid = "";
  try {
    cid = await state.ron.getAgentMetadata(req.params.address);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (msg.includes("missing revert data") || msg.includes("CALL_EXCEPTION") || msg.includes("revert")) {
      cid = ""; // old contract without identity support
    } else {
      throw e;
    }
  }
  res.json({ metadataCID: cid });
});

api.post("/agents/register", async (req, res) => {
  try {
    const { metadataCID } = req.body ?? {};
    if (!metadataCID) {
      return res.status(400).json({ error: "metadataCID required" });
    }
    // Use Agent A's runner so the identity is attached to the demo agent (what the UI queries + discover shows).
    const receipt = await state.ronAgentA.registerAgent(metadataCID);
    res.json({ txHash: receipt?.hash ?? null });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    // For demo purposes: if the deployed contract predates the identity feature (registerAgent not present),
    // still succeed locally so the UI can show the identity CID. Real on-chain registration will work
    // after a redeploy with latest contracts.
    if (msg.includes("missing revert data") || msg.includes("CALL_EXCEPTION") || msg.includes("revert")) {
      return res.json({
        txHash: null,
        simulated: true,
        note: "Demo (current on-chain RON may predate identity support; redeploy for full on-chain effect)"
      });
    }
    res.status(500).json({ error: msg });
  }
});

// --- Discovery ---

api.get("/discover", async (req, res) => {
  const typeLabel = String(req.query.capabilityType ?? LORA_CAPABILITY_TYPE);
  const minScore = Number(req.query.minScore ?? 0);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);

  // F10: serve from the off-chain index when it already has this capability type.
  if (isIndexerReady() && indexedCount(typeLabel) > 0) {
    const { items, total } = queryIndexedDiscovery({ capabilityType: typeLabel, minScore, offset, limit });
    sendJsonWithEtag(req, res, items, {
      "X-Total-Count": String(total),
      "X-Indexer": "on",
      "X-Page-Offset": String(offset),
      "X-Page-Limit": String(limit),
    });
    return;
  }

  // Fallback: direct on-chain scan (before the index is warm, or none configured).
  const all = await onChainDiscover(typeLabel, minScore);
  sendJsonWithEtag(req, res, all.slice(offset, offset + limit), {
    "X-Total-Count": String(all.length),
    "X-Indexer": "off",
    "X-Page-Offset": String(offset),
    "X-Page-Limit": String(limit),
  });
});

/** F10: indexer health/observability for operators. */
api.get("/indexer", (_req, res) => {
  res.json(indexerStatus());
});

/** F12: recent protocol alerts (challenges, slashing, pool withdrawals). */
api.get("/alerts", (req, res) => {
  res.json(listAlerts(Number(req.query.limit ?? 50)));
});

// --- Demo orchestrator ---

api.post("/demo/run", async (_req, res) => {
  try {
    const result = await runDemo(state);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

app.use("/api", api);

// OpenAPI docs
api.get("/openapi.json", (_req, res) => res.json(openApiSpec));
api.use("/docs", express.static(path.resolve(process.cwd(), "node_modules", "swagger-ui-dist")));
api.get("/docs", (_req, res) => {
  const swaggerHtml = fs.readFileSync(path.resolve(process.cwd(), "node_modules", "swagger-ui-dist", "index.html"), "utf8");
  const html = swaggerHtml
    .replace("https://petstore.swagger.io/v2/swagger.json", "/api/openapi.json")
    .replace("<title>Swagger UI</title>", '<title>TAOP API Docs</title>');
  res.send(html);
});

// Serve the built demo app (apps/demo/dist) as static files.
const demoDist = path.resolve(process.cwd(), "apps", "demo", "dist");
if (fs.existsSync(demoDist)) {
  app.use(express.static(demoDist));
  // SPA fallback: non-/api routes serve index.html (rate-limited; serves a file)
  app.get("*", spaFallbackLimiter, (_req, res) => {
    res.sendFile(path.join(demoDist, "index.html"));
  });
}

async function main() {
  state = await initState();

  // F10: start the off-chain indexer (non-fatal if the RPC can't serve logs).
  try {
    await startIndexer(state);
  } catch (e) {
    logger.warn(`[indexer] failed to start: ${String((e as Error).message ?? e)}`);
  }

  const server = app.listen(PORT, HOST, () => {
    const origin = isLoopbackHost(HOST) ? `http://127.0.0.1:${PORT}` : `http://${HOST}:${PORT}`;
    logger.info(`TAOP backend listening on ${origin}/api`);
    logger.info(
      `Security: bind=${isLoopbackHost(HOST) ? "loopback" : "PUBLIC"} | ` +
        `writes=${WRITES_DISABLED ? "DISABLED (read-only)" : "enabled"} | ` +
        `write auth=${API_KEY ? "X-TAOP-Key required" : "open (loopback only)"}`,
    );
    logger.info(
      `Contracts: ron=${state.deployment.ron} registry=${state.deployment.registry} capabilityId=${state.capabilityId}`,
    );
    const ix = indexerStatus();
    logger.info(
      `Indexer: ${ix.enabled ? `on (last=${ix.lastBlock} head=${ix.headBlock} lag=${ix.lag} twoSided=${ix.useTwoSided})` : "off"}`,
    );
  });
  // Slowloris / resource-exhaustion hardening (Node defaults are 60s / 300s).
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

// Auto-start unless a test harness sets TAOP_NO_AUTOSTART (see test/).
if (process.env.TAOP_NO_AUTOSTART !== "true") {
  main().catch((e) => {
    logger.error({ err: e }, "fatal");
    process.exit(1);
  });
}
