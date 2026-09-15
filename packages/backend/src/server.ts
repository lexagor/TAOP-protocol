import "dotenv/config";
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
import { openApiSpec } from "./openapi.js";

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(helmet({ contentSecurityPolicy: false }));

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
  console.error(
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

function explorerBase(): string {
  return state.deployment.chainId === 84532
    ? "https://sepolia.basescan.org"
    : "https://basescan.org";
}

api.get("/healthz", (_req, res) => res.json({ ok: true }));

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

api.get("/completions", (_req, res) => {
  res.json(listCompletions());
});

api.get("/completions/:id", async (req, res) => {
  try {
    const c = await state.ron.getCompletion(BigInt(req.params.id));
    res.json({
      completionId: req.params.id,
      agent: c.agent,
      taskType: c.taskType,
      resultCID: c.resultCID,
      timestamp: c.timestamp.toString(),
      challenged: c.challenged,
      disputed: c.disputed,
    });
  } catch (e) {
    res.status(404).json({ error: String((e as Error).message ?? e) });
  }
});

// --- Agent scores (MVP: self-attest score) ---

api.get("/agents/:address/score", async (req, res) => {
  try {
    // v0.1.2 contracts expose decay inputs; older deployments fall back to the
    // plain score view.
    const d = await state.ron.getScoreDetails(req.params.address);
    res.json({
      completions: d.completions.toString(),
      disputes: d.disputes.toString(),
      score: d.score.toString(),
      lastActivity: d.lastActivity.toString(),
      decayBps: d.decayBps,
    });
  } catch {
    const s = await state.ron.getSelfAttestScore(req.params.address);
    res.json({
      completions: s.completions.toString(),
      disputes: s.disputes.toString(),
      score: s.score.toString(),
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
  const ids = await state.registryOracle.getCapabilitiesByType(typeLabel);
  const out: unknown[] = [];
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
    const score = await state.ron.getSelfAttestScore(cap.creator);
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
    });
  }
  (out as { score: number }[]).sort((a, b) => b.score - a.score);
  res.json(out);
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
  // SPA fallback: non-/api routes serve index.html
  app.get("*", (_req, res) => {
    res.sendFile(path.join(demoDist, "index.html"));
  });
}

async function main() {
  state = await initState();
  const server = app.listen(PORT, HOST, () => {
    const origin = isLoopbackHost(HOST) ? `http://127.0.0.1:${PORT}` : `http://${HOST}:${PORT}`;
    console.log(`TAOP backend listening on ${origin}/api`);
    console.log(
      `Security: bind=${isLoopbackHost(HOST) ? "loopback" : "PUBLIC"} | ` +
        `writes=${WRITES_DISABLED ? "DISABLED (read-only)" : "enabled"} | ` +
        `write auth=${API_KEY ? "X-TAOP-Key required" : "open (loopback only)"}`,
    );
    console.log(
      `Contracts: ron=${state.deployment.ron} registry=${state.deployment.registry} capabilityId=${state.capabilityId}`,
    );
  });
  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
