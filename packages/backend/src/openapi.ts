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
        summary: "Health check",
        responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } } },
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
    "/agents/{address}/score": {
      get: {
        summary: "Get an agent's self-attest score",
        parameters: [{ name: "address", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Score", content: { "application/json": { schema: { $ref: "#/components/schemas/Score" } } } },
        },
      },
    },
    "/discover": {
      get: {
        summary: "Discover agents by capability proof + score",
        parameters: [
          { name: "capabilityType", in: "query", schema: { type: "string", default: "LoRA" } },
          { name: "minScore", in: "query", schema: { type: "integer", default: 0 } },
        ],
        responses: {
          "200": { description: "Ranked list of agents", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/DiscoveryItem" } } } } },
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
          txHash: { type: "string", nullable: true },
        },
      },
      Score: {
        type: "object",
        properties: {
          completions: { type: "string" },
          disputes: { type: "string" },
          score: { type: "string" },
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
