import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";

// A read-only instance must boot with NO private keys at all and never send a
// transaction. The RPC points at an unreachable address: if initState tried a
// write (the Agent A capability bootstrap) it would fail/hang, so resolving here
// proves the keyless path is truly read-only.
const DEP = `/tmp/taop-readonly-bootstrap-${process.pid}.json`;
const AGENT_A = "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const VALIDATOR = "0x0000000000000000000000000000000000000004";
writeFileSync(
  DEP,
  JSON.stringify({
    chainId: 84532,
    network: "base-sepolia",
    ron: "0x0000000000000000000000000000000000000001",
    registry: "0x0000000000000000000000000000000000000002",
    timelock: null,
    validator: VALIDATOR,
    agentA: AGENT_A,
  }),
);

process.env.DEMO_READ_ONLY = "true";
process.env.RPC_URL = "http://127.0.0.1:1";
process.env.DEPLOYMENTS_PATH = DEP;
// Never load the repo .env here: this test asserts a truly keyless boot.
const EMPTY_ENV = `/tmp/taop-readonly-${process.pid}.env`;
writeFileSync(EMPTY_ENV, "\n");
process.env.DOTENV_CONFIG_PATH = EMPTY_ENV;
delete process.env.AGENT_A_PK;
delete process.env.ORACLE_PK;
delete process.env.DEPLOYER_PK;

const { initState } = await import("../src/contracts.js");

describe("read-only bootstrap", () => {
  it("boots with no keys, no writes, and descriptor addresses", async () => {
    const state = await initState();
    expect(state.capabilityId).toBe(0n);
    expect(state.agentARunner).toBeNull();
    expect(state.oracleRunner).toBeNull();
    expect(state.executeViaTimelock).toBeNull();
    expect(state.agentAAddress).toBe(AGENT_A);
    expect(state.oracleAddress).toBe(VALIDATOR);
  });
});
