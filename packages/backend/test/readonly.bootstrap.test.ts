import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";

// A read-only instance must boot without sending any transaction. Point the RPC
// at an unreachable address: if initState tried the Agent A capability
// bootstrap (registerCapabilityEth) it would hang/fail, so resolving here proves
// the write is skipped. Hardhat's allowlisted public key keeps the secret
// scanners happy.
const DEP = `/tmp/taop-readonly-bootstrap-${process.pid}.json`;
writeFileSync(
  DEP,
  JSON.stringify({
    chainId: 84532,
    network: "base-sepolia",
    ron: "0x0000000000000000000000000000000000000001",
    registry: "0x0000000000000000000000000000000000000002",
    timelock: null,
    validator: "0x0000000000000000000000000000000000000004",
    agentA: "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  }),
);

process.env.DEMO_READ_ONLY = "true";
process.env.RPC_URL = "http://127.0.0.1:1";
process.env.DEPLOYMENTS_PATH = DEP;
process.env.AGENT_A_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const { initState } = await import("../src/contracts.js");

describe("read-only bootstrap", () => {
  it("skips the on-chain capability bootstrap (no startup writes)", async () => {
    const state = await initState();
    // 0 means no capability was registered/loaded at boot.
    expect(state.capabilityId).toBe(0n);
  });
});
