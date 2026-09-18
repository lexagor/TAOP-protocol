import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";

// Write-enabled instances must fail fast (with actionable guidance) when keys are
// missing — never silently fall back to a well-known mnemonic. Hardhat's
// allowlisted public key is used to exercise the "oracle present, agent missing"
// branch.
const DEP = `/tmp/taop-keys-required-${process.pid}.json`;
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

process.env.DEPLOYMENTS_PATH = DEP;
process.env.RPC_URL = "http://127.0.0.1:1";
// Never load the repo .env here: the test asserts missing-key behaviour.
const EMPTY_ENV = `/tmp/taop-keys-required-${process.pid}.env`;
writeFileSync(EMPTY_ENV, "\n");
process.env.DOTENV_CONFIG_PATH = EMPTY_ENV;
delete process.env.DEMO_READ_ONLY;
delete process.env.AGENT_A_PK;
delete process.env.ORACLE_PK;
delete process.env.DEPLOYER_PK;

const { initState } = await import("../src/contracts.js");

describe("write-mode key requirements", () => {
  it("refuses to boot without an oracle/deployer key", async () => {
    await expect(initState()).rejects.toThrow(/ORACLE_PK\/DEPLOYER_PK/);
  });

  it("refuses to boot without an Agent A key (and points at DEMO_READ_ONLY)", async () => {
    process.env.ORACLE_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    await expect(initState()).rejects.toThrow(/DEMO_READ_ONLY=true/);
  });
});
