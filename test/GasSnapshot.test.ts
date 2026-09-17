import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Gas-snapshot regression guard. Records `gasUsed` for the key operations and
 * fails if any rises more than TOLERANCE. Update deliberately:
 *
 *   npm run gas:snapshot
 *
 * Skipped under coverage (instrumentation changes gas entirely).
 */
const SNAPSHOT = "gas-snapshot.json";
const TOLERANCE = 1.05;
const update = process.env.UPDATE_GAS_SNAPSHOT === "true";

describe("gas snapshot (regression guard)", () => {
  beforeEach(function () {
    if (process.env.SKIP_SENSITIVE_CHECKS === "true") this.skip();
  });

  it("key operations stay within tolerance", async () => {
    const [owner, agent, cp1, challenger] = await ethers.getSigners();
    const SUMMARY = ethers.id("summarization");
    const LORA = ethers.id("LoRA");
    const BOND = ethers.parseEther("0.01");

    const measured: Record<string, number> = {};
    const gas = async (p: Promise<{ wait: () => Promise<{ gasUsed: bigint } | null> }>) => {
      const r = await (await p).wait();
      return Number(r!.gasUsed);
    };

    // Registry operations
    const Registry = await ethers.getContractFactory("CapabilityRegistry");
    const registry = await Registry.deploy(agent.address);
    measured.registerCapabilityEth = await gas(
      registry.connect(agent).registerCapabilityEth(LORA, "ipfs://m", { value: BOND }),
    );
    measured.certifyCapability = await gas(registry.connect(agent).certifyCapability(1));
    await registry.connect(agent).slashCapability(1, 1n);
    measured.withdrawBond = await gas(registry.connect(agent).withdrawBond(1));

    // ReputationOracleNetwork operations
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    measured.attestCompletion = await gas(ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r"));
    measured.attestReceipt = await gas(ron.connect(cp1).attestReceipt(1, "ipfs://receipt"));
    measured.challengeCompletion = await gas(
      ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND }),
    );
    measured.contestChallenge = await gas(ron.connect(agent).contestChallenge(1, "ipfs://rebuttal"));
    measured.resolveChallenge = await gas(ron.connect(owner).resolveChallenge(1, true));

    // Optimistic finalize path on a second completion
    await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r2");
    await ron.connect(cp1).attestReceipt(2, "ipfs://receipt2");
    await ron.connect(challenger).challengeCompletion(2, "ipfs://ev2", { value: BOND });
    await time.increase(3 * 24 * 60 * 60 + 1);
    measured.finalizeChallenge = await gas(ron.connect(challenger).finalizeChallenge(2));

    if (update) {
      writeFileSync(SNAPSHOT, JSON.stringify(measured, null, 2) + "\n");
      console.log("gas snapshot written:", measured);
      return;
    }

    const snap = existsSync(SNAPSHOT) ? (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, number>) : null;
    expect(snap, `${SNAPSHOT} missing — run: npm run gas:snapshot`).to.not.eq(null);

    for (const [op, used] of Object.entries(measured)) {
      const base = snap![op];
      expect(base, `no snapshot entry for ${op}`).to.be.a("number");
      const limit = Math.ceil(base * TOLERANCE);
      expect(used, `${op}: ${used} gas vs snapshot ${base} (+${(((used - base) / base) * 100).toFixed(1)}%)`).to.be.lessThanOrEqual(limit);
    }
  });
});
