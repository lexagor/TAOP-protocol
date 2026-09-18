#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ethers } from "ethers";
import dotenv from "dotenv";
import path from "node:path";
import {
  ReputationOracleNetworkClient,
  CapabilityRegistryClient,
  loadDeployment,
  type Deployment,
} from "@taopp/sdk";

dotenv.config();

const DEFAULT_RPC = process.env.RPC_URL || "https://sepolia.base.org";
const DEFAULT_DEPLOYMENTS = process.env.DEPLOYMENTS_PATH || path.resolve(process.cwd(), "../../deployments.json");

interface ToolArgs {
  [key: string]: unknown;
}

async function loadClients() {
  let deployment: Deployment;
  try {
    deployment = await loadDeployment(DEFAULT_DEPLOYMENTS);
  } catch {
    // Fallback to env vars
    deployment = {
      chainId: 84532,
      ron: process.env.RON_ADDRESS || "",
      registry: process.env.REGISTRY_ADDRESS || "",
      timelock: process.env.TIMELOCK_ADDRESS,
      validator: "",
      agentA: "",
    };
  }

  if (!deployment.ron || !deployment.registry) {
    throw new Error("Missing RON or REGISTRY address. Set DEPLOYMENTS_PATH or RON_ADDRESS/REGISTRY_ADDRESS env vars.");
  }

  const provider = new ethers.JsonRpcProvider(DEFAULT_RPC, deployment.chainId);

  // Read-only clients (no signer needed)
  const ronRead = new ReputationOracleNetworkClient(deployment.ron, provider);
  const registryRead = new CapabilityRegistryClient(deployment.registry, provider);

  // Optional signer for write operations
  let signer: ethers.Wallet | undefined;
  const pk = process.env.PRIVATE_KEY || process.env.DEPLOYER_PK || process.env.AGENT_A_PK;
  if (pk) {
    signer = new ethers.Wallet(pk, provider);
  }

  return { deployment, ronRead, registryRead, signer, provider };
}

const server = new Server(
  {
    name: "taop-credit-bureau",
    version: "0.3.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_deployment_info",
        description: "Get the current TAOP contract addresses and network info",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_agent_score",
        description: "Get the reputation score for an agent address (completions - disputes)",
        inputSchema: {
          type: "object",
          properties: {
            agentAddress: {
              type: "string",
              description: "Ethereum address of the agent",
            },
          },
          required: ["agentAddress"],
        },
      },
      {
        name: "discover_capabilities",
        description: "Discover certified capabilities (LoRA etc.) with optional minimum score filter. Returns ranked agents.",
        inputSchema: {
          type: "object",
          properties: {
            capabilityType: {
              type: "string",
              description: "Capability type, e.g. 'LoRA' (default)",
              default: "LoRA",
            },
            minScore: {
              type: "number",
              description: "Minimum reputation score required",
              default: 0,
            },
          },
        },
      },
      {
        name: "get_capability",
        description: "Get details for a specific capability by ID",
        inputSchema: {
          type: "object",
          properties: {
            capabilityId: {
              type: "number",
              description: "The capability NFT ID",
            },
          },
          required: ["capabilityId"],
        },
      },
      {
        name: "get_completion",
        description: "Get details for a specific completion/attestation by ID",
        inputSchema: {
          type: "object",
          properties: {
            completionId: {
              type: "number",
              description: "The completion ID",
            },
          },
          required: ["completionId"],
        },
      },
      {
        name: "attest_receipt",
        description: "Two-sided trust (v0.2): countersign a completion as the independent requester (requires PRIVATE_KEY).",
        inputSchema: {
          type: "object",
          properties: {
            completionId: {
              type: "number",
              description: "ID of the completion to countersign",
            },
            receiptCID: {
              type: "string",
              description: "IPFS CID of the requester's own receipt/evidence",
            },
          },
          required: ["completionId", "receiptCID"],
        },
      },
      {
        name: "contest_challenge",
        description: "Two-sided trust (v0.2): the agent rebuts a challenge within the challenge window (requires the agent's PRIVATE_KEY).",
        inputSchema: {
          type: "object",
          properties: {
            completionId: { type: "number", description: "ID of the challenged completion" },
            rebuttalCID: { type: "string", description: "IPFS CID of the agent's counter-evidence" },
          },
          required: ["completionId", "rebuttalCID"],
        },
      },
      {
        name: "finalize_challenge",
        description: "Two-sided trust (v0.2): finalize an uncontested challenge after the challenge window (upheld optimistically).",
        inputSchema: {
          type: "object",
          properties: {
            completionId: { type: "number", description: "ID of the challenged completion" },
          },
          required: ["completionId"],
        },
      },
      {
        name: "cancel_challenge",
        description: "v0.4 liveness: reclaim the challenge bond after CHALLENGE_TIMEOUT (90 days) when a pending challenge was never resolved (challenger only, requires the challenger's PRIVATE_KEY).",
        inputSchema: {
          type: "object",
          properties: {
            completionId: { type: "number", description: "ID of the challenged completion" },
          },
          required: ["completionId"],
        },
      },
      {
        name: "attest_completion",
        description: "Self-attest a task completion (requires PRIVATE_KEY in env). Returns completionId and tx hash.",
        inputSchema: {
          type: "object",
          properties: {
            taskType: {
              type: "string",
              description: "Task type string, e.g. 'summarization' or 'LoRA'",
            },
            resultCID: {
              type: "string",
              description: "IPFS CID of the result/evidence",
            },
          },
          required: ["taskType", "resultCID"],
        },
      },
      {
        name: "challenge_completion",
        description: "Challenge a completion with evidence (pays 0.01 ETH bond, requires PRIVATE_KEY).",
        inputSchema: {
          type: "object",
          properties: {
            completionId: {
              type: "number",
              description: "ID of the completion to challenge",
            },
            evidenceCID: {
              type: "string",
              description: "IPFS CID of fraud evidence",
            },
          },
          required: ["completionId", "evidenceCID"],
        },
      },
      {
        name: "register_capability",
        description: "Register a new capability (e.g. LoRA model) as NFT with ETH bond (requires PRIVATE_KEY).",
        inputSchema: {
          type: "object",
          properties: {
            capabilityType: {
              type: "string",
              description: "Type, e.g. 'LoRA'",
            },
            metadataCID: {
              type: "string",
              description: "IPFS CID of model metadata / card",
            },
            bondEther: {
              type: "string",
              description: "ETH bond amount as string, e.g. '0.01'",
              default: "0.01",
            },
          },
          required: ["capabilityType", "metadataCID"],
        },
      },
      {
        name: "resolve_challenge",
        description: "Resolve a challenge (owner/timelock only, requires appropriate PRIVATE_KEY).",
        inputSchema: {
          type: "object",
          properties: {
            completionId: {
              type: "number",
              description: "ID of the completion",
            },
            upheld: {
              type: "boolean",
              description: "True if challenge is valid (fraud)",
            },
          },
          required: ["completionId", "upheld"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const toolArgs = (args || {}) as ToolArgs;

  try {
    const { deployment, ronRead, registryRead, signer } = await loadClients();

    switch (name) {
      case "get_deployment_info": {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  chainId: deployment.chainId,
                  network: deployment.network || "unknown",
                  ron: deployment.ron,
                  registry: deployment.registry,
                  timelock: deployment.timelock || null,
                  rpc: DEFAULT_RPC,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_agent_score": {
        const agentAddress = toolArgs.agentAddress as string;
        if (!agentAddress) throw new Error("agentAddress required");

        const score = await ronRead.getSelfAttestScore(agentAddress);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  agent: agentAddress,
                  completions: score.completions.toString(),
                  disputes: score.disputes.toString(),
                  score: score.score.toString(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "discover_capabilities": {
        const capabilityType = (toolArgs.capabilityType as string) || "LoRA";
        const minScore = Number(toolArgs.minScore || 0);

        // Use indexed discovery for efficiency (O(1) per type)
        const ids = await registryRead.getCapabilitiesByType(capabilityType);
        const results: any[] = [];

        for (const id of ids) {
          // v0.1.2: one stale id must never break the whole discovery response.
          let cap;
          try {
            cap = await registryRead.getCapability(id);
          } catch {
            continue;
          }

          if (!cap.certified || cap.slashed) continue;

          // v0.2: rank on receipt-confirmed (two-sided) score where supported.
          const score = await ronRead.getRankingScore(cap.creator);
          const scoreNum = Number(score.score);
          if (scoreNum < minScore) continue;

          results.push({
            capabilityId: id.toString(),
            creator: cap.creator,
            capabilityType,
            certified: cap.certified,
            bond: ethers.formatEther(cap.bond),
            metadataCID: cap.metadataCID,
            completions: score.completions.toString(),
            disputes: score.disputes.toString(),
            score: scoreNum,
            scoreType: score.scoreType,
          });
        }

        // Sort by score desc
        results.sort((a, b) => b.score - a.score);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case "get_capability": {
        const id = BigInt(toolArgs.capabilityId as number);
        const cap = await registryRead.getCapability(id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  capabilityId: id.toString(),
                  creator: cap.creator,
                  bond: ethers.formatEther(cap.bond),
                  capabilityType: cap.capabilityType,
                  metadataCID: cap.metadataCID,
                  certified: cap.certified,
                  slashed: cap.slashed,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_completion": {
        const id = BigInt(toolArgs.completionId as number);
        const comp = await ronRead.getCompletion(id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  completionId: id.toString(),
                  agent: comp.agent,
                  taskType: comp.taskType,
                  resultCID: comp.resultCID,
                  timestamp: comp.timestamp.toString(),
                  challenged: comp.challenged,
                  disputed: comp.disputed,
                  counterparty: comp.counterparty,
                  receiptTimestamp: comp.receiptTimestamp.toString(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "attest_completion": {
        if (!signer) throw new Error("PRIVATE_KEY (or DEPLOYER_PK / AGENT_A_PK) required for write operations");

        const taskType = toolArgs.taskType as string;
        const resultCID = toolArgs.resultCID as string;

        const ronWrite = new ReputationOracleNetworkClient(deployment.ron, signer);
        const { completionId, receipt } = await ronWrite.attestCompletion(taskType, resultCID);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  completionId: completionId.toString(),
                  txHash: receipt?.hash,
                  agent: await signer.getAddress(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "challenge_completion": {
        if (!signer) throw new Error("PRIVATE_KEY required for write operations");

        const completionId = Number(toolArgs.completionId);
        const evidenceCID = toolArgs.evidenceCID as string;

        const ronWrite = new ReputationOracleNetworkClient(deployment.ron, signer);
        const bond = await ronWrite.challengeBond();

        const receipt = await ronWrite.challengeCompletion(completionId, evidenceCID, bond);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  completionId,
                  bondWei: bond.toString(),
                  txHash: receipt?.hash,
                  challenger: await signer.getAddress(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "register_capability": {
        if (!signer) throw new Error("PRIVATE_KEY required for write operations");

        const capabilityType = toolArgs.capabilityType as string;
        const metadataCID = toolArgs.metadataCID as string;
        const bondEther = (toolArgs.bondEther as string) || "0.01";
        const bond = ethers.parseEther(bondEther);

        const registryWrite = new CapabilityRegistryClient(deployment.registry, signer);
        const { capabilityId, receipt } = await registryWrite.registerCapabilityEth(
          capabilityType,
          metadataCID,
          bond
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  capabilityId: capabilityId.toString(),
                  txHash: receipt?.hash,
                  creator: await signer.getAddress(),
                  bond: bondEther,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "resolve_challenge": {
        if (!signer) throw new Error("PRIVATE_KEY with owner/timelock permissions required");

        const completionId = Number(toolArgs.completionId);
        const upheld = Boolean(toolArgs.upheld);

        const ronWrite = new ReputationOracleNetworkClient(deployment.ron, signer);
        const receipt = await ronWrite.resolveChallenge(completionId, upheld);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  completionId,
                  upheld,
                  txHash: receipt?.hash,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "attest_receipt": {
        if (!signer) throw new Error("PRIVATE_KEY required for write operations");

        const completionId = Number(toolArgs.completionId);
        const receiptCID = toolArgs.receiptCID as string;

        const ronWrite = new ReputationOracleNetworkClient(deployment.ron, signer);
        const receipt = await ronWrite.attestReceipt(completionId, receiptCID);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  completionId,
                  txHash: receipt?.hash,
                  counterparty: await signer.getAddress(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "contest_challenge": {
        if (!signer) throw new Error("PRIVATE_KEY required for write operations");

        const completionId = Number(toolArgs.completionId);
        const rebuttalCID = toolArgs.rebuttalCID as string;

        const ronWrite = new ReputationOracleNetworkClient(deployment.ron, signer);
        const receipt = await ronWrite.contestChallenge(completionId, rebuttalCID);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, completionId, txHash: receipt?.hash }, null, 2),
            },
          ],
        };
      }

      case "finalize_challenge": {
        if (!signer) throw new Error("PRIVATE_KEY required to submit the finalize transaction");

        const completionId = Number(toolArgs.completionId);

        const ronWrite = new ReputationOracleNetworkClient(deployment.ron, signer);
        const receipt = await ronWrite.finalizeChallenge(completionId);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, completionId, txHash: receipt?.hash, upheld: true }, null, 2),
            },
          ],
        };
      }

      case "cancel_challenge": {
        if (!signer) throw new Error("PRIVATE_KEY required to submit the cancel transaction");

        const completionId = Number(toolArgs.completionId);

        const ronWrite = new ReputationOracleNetworkClient(deployment.ron, signer);
        const receipt = await ronWrite.cancelChallenge(completionId);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, completionId, txHash: receipt?.hash, cancelled: true }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Optional: log to stderr so it doesn't interfere with stdio protocol
  console.error("TAOP MCP Server running on stdio");
  console.error("Tools: get_agent_score, discover_capabilities, attest_completion, etc.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
