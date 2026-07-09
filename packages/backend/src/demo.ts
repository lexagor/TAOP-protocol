import { ethers } from "ethers";
import type { BackendState } from "./contracts.js";
import { LORA_CAPABILITY_TYPE } from "@taop/sdk";
import { pinJSON, buildEvidence } from "./ipfs.js";
import { recordCompletion } from "./db.js";
import { summarize, DEMO_CORPORA } from "./lora.js";

export interface DemoResult {
  agentAddress: string;
  capabilityId: string;
  capability: {
    creator: string;
    bond: string;
    capabilityType: string;
    metadataCID: string;
    certified: boolean;
    slashed: boolean;
  };
  completionId: string;
  taskType: string;
  resultCID: string;
  summary: string;
  inputCorpus: string;
  modelUsed: string;
  latencyMs: number;
  before: { completions: string; disputes: string; score: string };
  after: { completions: string; disputes: string; score: string };
  attestTx: string | null;
}

/** Run the full MVP demo loop: Agent A runs a real LoRA summarization,
 *  pins the evidence to IPFS, and self-attests the completion on-chain. */
export async function runDemo(state: BackendState): Promise<DemoResult> {
  const agentAddress = state.agentAAddress;
  const before = await state.ron.getSelfAttestScore(agentAddress);
  state.taskCounter += 1;
  const taskType = LORA_CAPABILITY_TYPE;

  // Pick a corpus from the rotation.
  const corpus = DEMO_CORPORA[(state.taskCounter - 1) % DEMO_CORPORA.length];

  // Run real LoRA summarization via Replicate.
  const result = await summarize(corpus);

  // Pin real evidence to IPFS (the actual input + output).
  const evidence = buildEvidence({
    completionId: "pending",
    agent: agentAddress,
    taskType,
    input: corpus,
    output: result.summary,
    modelUsed: result.modelUsed,
  });
  const resultCID = await pinJSON(evidence, `taop-evidence-task${state.taskCounter}`);

  // Agent A self-attests the completion (must be called by Agent A's signer).
  const { completionId, receipt } = await state.ronAgentA.attestCompletion(taskType, resultCID);

  // Read-after-write can lag on L2; retry until the count increments.
  const beforeCount = before.completions;
  let after = await state.ron.getSelfAttestScore(agentAddress);
  for (let i = 0; i < 8 && after.completions === beforeCount; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    after = await state.ron.getSelfAttestScore(agentAddress);
  }
  const cap = await state.registryOracle.getCapability(state.capabilityId);

  // Record in DB.
  recordCompletion({
    completionId,
    agent: agentAddress,
    taskType,
    resultCID,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    txHash: receipt?.hash ?? null,
  });

  return {
    agentAddress,
    capabilityId: state.capabilityId.toString(),
    capability: {
      creator: cap.creator,
      bond: ethers.formatEther(cap.bond),
      capabilityType: LORA_CAPABILITY_TYPE,
      metadataCID: cap.metadataCID,
      certified: cap.certified,
      slashed: cap.slashed,
    },
    completionId: completionId.toString(),
    taskType,
    resultCID,
    summary: result.summary,
    inputCorpus: corpus,
    modelUsed: result.modelUsed,
    latencyMs: result.latencyMs,
    before: {
      completions: before.completions.toString(),
      disputes: before.disputes.toString(),
      score: before.score.toString(),
    },
    after: {
      completions: after.completions.toString(),
      disputes: after.disputes.toString(),
      score: after.score.toString(),
    },
    attestTx: receipt?.hash ?? null,
  };
}
