import express from "express";
import cors from "cors";
import helmet from "helmet";
import { ethers } from "ethers";
import path from "node:path";
import fs from "node:fs";
import { initState, type BackendState } from "./contracts.js";
import { runDemo } from "./demo.js";
import { LORA_CAPABILITY_TYPE } from "@taopp/sdk";
import { listCapabilities, listCompletions } from "./db.js";
import { openApiSpec } from "./openapi.js";

const app = express();
app.use(express.json());
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));

const api = express.Router();
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
    const bond = await state.ron.challengeBond();
    const receipt = await state.ron.challengeCompletion(
      BigInt(req.params.id),
      String(req.body?.evidenceCID ?? "ipfs://challenge-evidence"),
      bond,
    );
    res.json({ txHash: receipt?.hash ?? null, bondWei: bond.toString() });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
  }
});

api.post("/completions/:id/resolve", async (req, res) => {
  try {
    const upheld = Boolean(req.body?.upheld ?? false);
    const completionId = BigInt(req.params.id);

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
    }

    res.json({ txHash: receipt?.hash ?? null, upheld });
  } catch (e) {
    res.status(500).json({ error: String((e as Error).message ?? e) });
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
  const s = await state.ron.getSelfAttestScore(req.params.address);
  res.json({
    completions: s.completions.toString(),
    disputes: s.disputes.toString(),
    score: s.score.toString(),
  });
});

// --- Discovery ---

api.get("/discover", async (req, res) => {
  const typeLabel = String(req.query.capabilityType ?? LORA_CAPABILITY_TYPE);
  const minScore = Number(req.query.minScore ?? 0);
  const ids = await state.registryOracle.getCapabilitiesByType(typeLabel);
  const out: unknown[] = [];
  for (const id of ids) {
    const cap = await state.registryOracle.getCapability(id);
    if (!cap.certified || cap.slashed) continue;
    const score = await state.ron.getSelfAttestScore(cap.creator);
    const scoreNum = Number(score.score);
    if (scoreNum < minScore) continue;
    out.push({
      agentAddress: cap.creator,
      capabilityId: id.toString(),
      capabilityType: typeLabel,
      certified: cap.certified,
      slashed: cap.slashed,
      bond: ethers.formatEther(cap.bond),
      metadataCID: cap.metadataCID,
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

const PORT = Number(process.env.PORT ?? 4000);

async function main() {
  state = await initState();
  const server = app.listen(PORT, () => {
    console.log(`TAOP backend on http://127.0.0.1:${PORT}/api`);
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
