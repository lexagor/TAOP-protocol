/**
 * OpenAPI spec for the TAOP backend API. Served at /api/docs via swagger-ui.
 */
export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "TAOP — Trustless Agent Orchestration Protocol API",
    version: "0.1.0",
    description:
      "The TAOP MVP backend. Provides capability registration, self-attestation, challenge, discovery, and a demo orchestrator — all backed by the ReputationOracleNetwork and CapabilityRegistry contracts on Base Sepolia.",
  },
  servers: [
    { url: "/api", description: "TAOP API" },
  ],
  paths: {
    "/healthz": {
      get: {
        summary: "Health/readiness (chain, RPC latency, indexer lag)",
        responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: {
          ok: { type: "boolean" }, service: { type: "string" }, chainId: { type: "integer" },
          uptimeSec: { type: "integer" }, writes: { type: "string", enum: ["disabled", "keyed", "open-loopback"] },
          rpc: { type: "object", properties: { ok: { type: "boolean" }, latencyMs: { type: "integer" }, blockNumber: { type: "integer", nullable: true }, error: { type: "string", nullable: true } } },
          indexer: { type: "object", properties: { enabled: { type: "boolean" }, ready: { type: "boolean" }, lag: { type: "integer" }, lastBlock: { type: "integer" }, headBlock: { type: "integer" }, twoSided: { type: "boolean" }, lastError: { type: "string", nullable: true } } },
        } } } } } },
      },
    },
    "/contracts": {
      get: {
        summary: "Get deployed contract addresses",
        responses: {
          "200": {
            description: "Contract addresses + chain info",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Contracts" } } },
          },
        },
      },
    },
    "/capabilities": {
      get: {
        summary: "List all registered capabilities",
        responses: {
          "200": { description: "List of capabilities", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Capability" } } } } },
        },
      },
    },
    "/capabilities/{id}": {
      get: {
        summary: "Get a capability by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Capability details", content: { "application/json": { schema: { $ref: "#/components/schemas/Capability" } } } },
          "404": { description: "Not found" },
        },
      },
    },
    "/capabilities/register": {
      post: {
        summary: "Register a new capability (Agent A)",
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: {
            capabilityType: { type: "string", example: "LoRA" },
            metadataCID: { type: "string", example: "ipfs://Qm..." },
            bondEther: { type: "string", example: "0.01" },
          } } } },
        },
        responses: {
          "200": { description: "Capability registered", content: { "application/json": { schema: { type: "object", properties: { capabilityId: { type: "string" }, txHash: { type: "string" } } } } } },
        },
      },
    },
    "/capabilities/{id}/certify": {
      post: {
        summary: "Certify a capability (owner only)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Certified", content: { "application/json": { schema: { type: "object", properties: { txHash: { type: "string" } } } } } },
        },
      },
    },
    "/completions": {
      get: {
        summary: "List recent completions",
        responses: {
          "200": { description: "List of completions", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Completion" } } } } },
        },
      },
    },
    "/completions/{id}": {
      get: {
        summary: "Get a completion by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Completion details", content: { "application/json": { schema: { $ref: "#/components/schemas/Completion" } } } },
          "404": { description: "Not found" },
        },
      },
    },
    "/completions/attest": {
      post: {
        summary: "Self-attest a completion (Agent A)",
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: {
            taskType: { type: "string", example: "LoRA" },
            resultCID: { type: "string", example: "ipfs://Qm..." },
          } } } },
        },
        responses: {
          "200": { description: "Completion attested", content: { "application/json": { schema: { type: "object", properties: { completionId: { type: "string" }, txHash: { type: "string" } } } } } },
        },
      },
    },
    "/completions/{id}/challenge": {
      post: {
        summary: "Challenge a completion (public, requires ETH bond)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: {
            evidenceCID: { type: "string", example: "ipfs://Qm..." },
          } } } },
        },
        responses: {
          "200": { description: "Challenge submitted", content: { "application/json": { schema: { type: "object", properties: { txHash: { type: "string" }, bondWei: { type: "string" } } } } } },
        },
      },
    },
    "/completions/{id}/resolve": {
      post: {
        summary: "Resolve a challenge (owner only)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: {
            upheld: { type: "boolean" },
          } } } },
        },
        responses: {
          "200": { description: "Challenge resolved", content: { "application/json": { schema: { type: "object", properties: { txHash: { type: "string" }, upheld: { type: "boolean" } } } } } },
        },
      },
    },
    "/completions/{id}/receipt": {
      post: {
        summary: "Two-sided trust (v0.2): countersign a completion as the independent requester",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: {
            receiptCID: { type: "string", example: "ipfs://requester-receipt" },
          } } } },
        },
        responses: {
          "200": { description: "Receipt recorded", content: { "application/json": { schema: { type: "object", properties: { txHash: { type: "string" }, completionId: { type: "string" } } } } } },
        },
      },
    },
    "/completions/{id}/revoke-receipt": {
      post: {
        summary: "Two-sided trust (v0.2): the counterparty withdraws a receipt",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Receipt revoked", content: { "application/json": { schema: { type: "object", properties: { txHash: { type: "string" }, completionId: { type: "string" } } } } } },
        },
      },
    },
    "/completions/{id}/contest": {
      post: {
        summary: "Two-sided trust (v0.2): the agent rebuts a challenge within the window",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: {
            rebuttalCID: { type: "string", example: "ipfs://agent-rebuttal" },
          } } } },
        },
        responses: {
          "200": { description: "Challenge contested", content: { "application/json": { schema: { type: "object", properties: { txHash: { type: "string" }, completionId: { type: "string" } } } } } },
        },
      },
    },
    "/completions/{id}/finalize": {
      post: {
        summary: "Two-sided trust (v0.2): finalize an uncontested challenge after the window (upheld optimistically)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Challenge finalized", content: { "application/json": { schema: { type: "object", properties: { txHash: { type: "string" }, completionId: { type: "string" }, upheld: { type: "boolean" } } } } } },
        },
      },
    },
    "/agents/{address}/score": {
      get: {
        summary: "Get an agent's self-attest score",
        parameters: [{ name: "address", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Score", content: { "application/json": { schema: { $ref: "#/components/schemas/Score" } } } },
        },
      },
    },
    "/admin/audit": {
      get: {
        summary: "Admin action audit log (pause/unpause/cooldown/resolve)",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 500 } }],
        responses: { "200": { description: "Audit entries, newest first" } },
      },
    },
    "/admin/pause": {
      post: {
        summary: "Pause protocol actions (owner/Timelock)",
        responses: { "200": { description: "Paused" }, "400": { description: "Reverted" } },
      },
    },
    "/admin/unpause": {
      post: {
        summary: "Unpause protocol actions (owner/Timelock)",
        responses: { "200": { description: "Unpaused" }, "400": { description: "Reverted" } },
      },
    },
    "/admin/attest-cooldown": {
      post: {
        summary: "Set the per-address attestation cooldown in seconds (owner/Timelock)",
        responses: { "200": { description: "Set" }, "400": { description: "Invalid/reverted" } },
      },
    },
    "/discover": {
      get: {
        summary: "Discover agents by capability proof + score (paginated; served from the F10 index when warm)",
        parameters: [
          { name: "capabilityType", in: "query", schema: { type: "string", default: "LoRA" } },
          { name: "minScore", in: "query", schema: { type: "integer", default: 0 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
          { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: {
          "200": {
            description: "Ranked page of agents",
            headers: {
              "X-Total-Count": { schema: { type: "integer" }, description: "Total matching agents before paging" },
              "X-Indexer": { schema: { type: "string", enum: ["on", "off"] } },
              ETag: { schema: { type: "string" } },
            },
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/DiscoveryItem" } } } },
          },
          "304": { description: "Not modified (If-None-Match)" },
        },
      },
    },
    "/indexer": {
      get: {
        summary: "Off-chain indexer status (F10)",
        responses: {
          "200": { description: "Indexer status", content: { "application/json": { schema: { type: "object", properties: {
            enabled: { type: "boolean" }, ready: { type: "boolean" }, useTwoSided: { type: "boolean" }, useCredit: { type: "boolean" },
            lastBlock: { type: "integer" }, headBlock: { type: "integer" }, safeHead: { type: "integer" },
            lag: { type: "integer" }, reorgsDetected: { type: "integer" }, lastError: { type: "string", nullable: true },
          } } } } },
        },
      },
    },
    "/alerts": {
      get: {
        summary: "Recent protocol alerts — challenges, slashing, pool withdrawals (F12)",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 500 } }],
        responses: {
          "200": { description: "Alerts, newest first", content: { "application/json": { schema: { type: "array", items: { type: "object", properties: {
            id: { type: "integer" }, kind: { type: "string" }, blockNumber: { type: "integer" }, txHash: { type: "string" }, payload: { type: "object" }, createdAt: { type: "string" },
          } } } } } },
        },
      },
    },
    "/demo/run": {
      post: {
        summary: "Run the full demo loop (Agent A self-attests with real LoRA inference)",
        responses: {
          "200": { description: "Demo result", content: { "application/json": { schema: { $ref: "#/components/schemas/DemoResult" } } } },
          "500": { description: "Error" },
        },
      },
    },
  },
  components: {
    schemas: {
      Contracts: {
        type: "object",
        properties: {
          chainId: { type: "integer", example: 84532 },
          network: { type: "string", example: "base-sepolia" },
          ron: { type: "string" },
          registry: { type: "string" },
          token: { type: "string" },
          validator: { type: "string" },
          agentA: { type: "string" },
          capabilityId: { type: "string" },
          explorerBase: { type: "string", example: "https://sepolia.basescan.org" },
        },
      },
      Capability: {
        type: "object",
        properties: {
          capabilityId: { type: "string" },
          creator: { type: "string" },
          bond: { type: "string" },
          capabilityType: { type: "string" },
          metadataCID: { type: "string" },
          certified: { type: "boolean" },
          slashed: { type: "boolean" },
          isEthBond: { type: "boolean" },
        },
      },
      Completion: {
        type: "object",
        properties: {
          completionId: { type: "string" },
          agent: { type: "string" },
          taskType: { type: "string" },
          resultCID: { type: "string" },
          timestamp: { type: "string" },
          challenged: { type: "boolean" },
          disputed: { type: "boolean" },
          counterparty: { type: "string", nullable: true },
          receiptTimestamp: { type: "string" },
          receiptCID: { type: "string" },
          txHash: { type: "string", nullable: true },
        },
      },
      Score: {
        type: "object",
        properties: {
          completions: { type: "string" },
          disputes: { type: "string" },
          score: { type: "string" },
          lastActivity: { type: "string" },
          decayBps: { type: "integer" },
          confirmed: { type: "string" },
          twoSidedScore: { type: "string" },
          distinctCounterparties: { type: "string" },
          creditScore: { type: "string" },
          rankingScoreType: { type: "string", enum: ["credit", "two-sided", "self-attest"] },
        },
      },
      DiscoveryItem: {
        type: "object",
        properties: {
          agentAddress: { type: "string" },
          capabilityId: { type: "string" },
          capabilityType: { type: "string" },
          certified: { type: "boolean" },
          slashed: { type: "boolean" },
          bond: { type: "string" },
          isEthBond: { type: "boolean" },
          metadataCID: { type: "string" },
          completions: { type: "integer" },
          disputes: { type: "integer" },
          score: { type: "integer" },
          scoreType: { type: "string", enum: ["credit", "two-sided", "self-attest"] },
        },
      },
      DemoResult: {
        type: "object",
        properties: {
          agentAddress: { type: "string" },
          capabilityId: { type: "string" },
          completionId: { type: "string" },
          taskType: { type: "string" },
          resultCID: { type: "string" },
          summary: { type: "string" },
          inputCorpus: { type: "string" },
          modelUsed: { type: "string" },
          latencyMs: { type: "integer" },
          before: { $ref: "#/components/schemas/Score" },
          after: { $ref: "#/components/schemas/Score" },
          attestTx: { type: "string", nullable: true },
        },
      },
    },
  },
};
