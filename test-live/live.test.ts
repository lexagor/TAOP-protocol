import { describe, it, expect, beforeAll } from "vitest";
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ReputationOracleNetworkClient, CapabilityRegistryClient, discover } from "@taopp/sdk";

/**
 * Read-only integration test against the **live Base Sepolia deployment**
 * (addresses from `deployments.json.example`). This is the one test that talks to
 * real deployed bytecode, so it catches ABI/shape drift that local Hardhat tests
 * (which always use the current build) cannot.
 *
 * Run with: `npm run test:live` (CI: non-blocking `live` job).
 */
const dep = JSON.parse(
  readFileSync(fileURLToPath(new URL("../deployments.json.example", import.meta.url)), "utf8"),
) as { chainId: number; ron: string; registry: string; agentA: string };

const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

describe("live Base Sepolia — SDK reads real deployed bytecode", () => {
  const provider = new ethers.JsonRpcProvider(RPC, dep.chainId);
  const ron = new ReputationOracleNetworkClient(dep.ron, provider);
  const registry = new CapabilityRegistryClient(dep.registry, provider);

  beforeAll(async () => {
    // Fail fast with a clear message if the public RPC is unreachable/limited.
    const block = await provider.getBlockNumber();
    expect(block).toBeGreaterThan(0);
  });

  it("reads the live RON score view", async () => {
    const s = await ron.getSelfAttestScore(dep.agentA);
    expect(s.completions).toBeGreaterThanOrEqual(0n);
    expect(s.score).toBeLessThanOrEqual(s.completions);
  });

  it("reads the live registry index", async () => {
    const ids = await registry.getCapabilitiesByType("LoRA");
    expect(Array.isArray(ids)).toBe(true);
    for (const id of ids) {
      const cap = await registry.getCapability(id);
      expect(cap.creator).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  it("discover() ranks live agents, falling back on pre-v0.2 bytecode", async () => {
    const results = await discover(registry, ron, "LoRA", 0);
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(["two-sided", "self-attest"]).toContain(r.scoreType);
      expect(r.score).toBeGreaterThanOrEqual(0n);
      expect(r.agentAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  it("getRankingScore selects a supported score type on live bytecode", async () => {
    const r = await ron.getRankingScore(dep.agentA);
    expect(["two-sided", "self-attest"]).toContain(r.scoreType);
  });
});
