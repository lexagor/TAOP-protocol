import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { CapabilityRegistryClient, ReputationOracleNetworkClient } from "@taopp/sdk";

/**
 * Regression tests for the v0.1.2 fixes (NEXT_BEST_STEPS_2026-09.md §4):
 *  - F4: withdrawBond left stale ids in capabilitiesByType (broke discovery)
 *  - F5: capability/completion ids derived from supply counters (wrong ids)
 *  - F6: integer-halving decay zeroed small scores far too quickly
 */
describe("v0.1.2 fixes — stale index, id derivation, decay", () => {
  const LORA = ethers.id("LoRA");
  const BOND = ethers.parseEther("0.01");

  describe("CapabilityRegistry — index consistency across withdrawals (F4)", () => {
    it("withdrawBond removes the id from getCapabilitiesByType", async () => {
      const [creator] = await ethers.getSigners();
      const Registry = await ethers.getContractFactory("CapabilityRegistry");
      const registry = await Registry.deploy(creator.address);
      await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m1", { value: BOND });
      await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m2", { value: BOND });

      await registry.connect(creator).withdrawBond(1);
      expect((await registry.getCapabilitiesByType(LORA)).map(String)).to.deep.eq(["2"]);

      // A discovery loop must be able to read every id the index returns.
      const cap = await registry.getCapability(2);
      expect(cap.creator).to.eq(creator.address);
    });

    it("keeps the index correct when the burned id is not the last one", async () => {
      const [creator] = await ethers.getSigners();
      const Registry = await ethers.getContractFactory("CapabilityRegistry");
      const registry = await Registry.deploy(creator.address);
      for (const m of ["1", "2", "3"]) {
        await registry.connect(creator).registerCapabilityEth(LORA, `ipfs://m${m}`, { value: BOND });
      }

      await registry.connect(creator).withdrawBond(2); // middle element -> swap-and-pop
      const ids = (await registry.getCapabilitiesByType(LORA)).map(String).sort();
      expect(ids).to.deep.eq(["1", "3"]);
      for (const id of ids) {
        await expect(registry.getCapability(id)).to.not.be.reverted;
      }
    });

    it("assigns strictly increasing ids even after burns (F5, contract side)", async () => {
      const [creator] = await ethers.getSigners();
      const Registry = await ethers.getContractFactory("CapabilityRegistry");
      const registry = await Registry.deploy(creator.address);
      await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://a", { value: BOND });
      await registry.connect(creator).withdrawBond(1);
      await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://b", { value: BOND });
      // id must be 2 even though totalSupply() is 1 — consumers must never infer
      // ids from totalSupply().
      expect((await registry.getCapabilitiesByType(LORA)).map(String)).to.deep.eq(["2"]);
      expect(await registry.totalSupply()).to.eq(1n);
    });
  });

  describe("SDK — ids come from events, not supply counters (F5)", () => {
    it("registerCapabilityEth returns the emitted capabilityId after a burn", async () => {
      const [signer] = await ethers.getSigners();
      const Registry = await ethers.getContractFactory("CapabilityRegistry");
      const registry = await Registry.deploy(signer.address);
      const client = new CapabilityRegistryClient(await registry.getAddress(), signer);

      const first = await client.registerCapabilityEth("LoRA", "ipfs://m1", BOND);
      expect(first.capabilityId).to.eq(1n);

      await client.withdrawBond(1n);
      const second = await client.registerCapabilityEth("LoRA", "ipfs://m2", BOND);
      expect(second.capabilityId).to.eq(2n); // was 1 (= totalSupply) before v0.1.2
      expect((await registry.getCapability(2)).creator).to.eq(signer.address);
    });

    it("attestCompletion returns the emitted completionId", async () => {
      const [signer] = await ethers.getSigners();
      const RON = await ethers.getContractFactory("ReputationOracleNetwork");
      const ron = await RON.deploy();
      const client = new ReputationOracleNetworkClient(await ron.getAddress(), signer);

      const a = await client.attestCompletion("summarization", "ipfs://r1");
      expect(a.completionId).to.eq(1n);
      const b = await client.attestCompletion("summarization", "ipfs://r2");
      expect(b.completionId).to.eq(2n);
    });
  });

  describe("ReputationOracleNetwork — decay v0.1.2 (30d grace, 150d linear) (F6)", () => {
    async function deployRonWithAttests() {
      const [, agent] = await ethers.getSigners();
      const RON = await ethers.getContractFactory("ReputationOracleNetwork");
      const ron = await RON.deploy();
      await ron.connect(agent).attestCompletion(ethers.id("summarization"), "ipfs://r1");
      await ron.connect(agent).attestCompletion(ethers.id("summarization"), "ipfs://r2");
      return { ron, agent };
    }

    it("is undecayed within the grace period", async () => {
      const { ron, agent } = await deployRonWithAttests();
      const [completions, disputes, score, lastActivity, decayBps] = await ron.getScoreDetails(agent.address);
      expect(completions).to.eq(2n);
      expect(disputes).to.eq(0n);
      expect(score).to.eq(2n);
      expect(decayBps).to.eq(10000n);
      expect(lastActivity).to.be.gt(0n);
    });

    it("decays linearly (not by halving) after the grace period", async () => {
      const { ron, agent } = await deployRonWithAttests();
      await time.increase(31 * 24 * 60 * 60); // 1 day past the 30-day grace
      const [, , score, , decayBps] = await ron.getScoreDetails(agent.address);
      expect(decayBps).to.be.lt(10000n);
      expect(decayBps).to.be.gt(9000n); // only ~1/150 of the weight lost
      expect(score).to.be.lt(2n);
      expect(score).to.be.gt(0n); // the old halving model returned 0 here for net=2
    });

    it("reaches zero after grace + horizon", async () => {
      const { ron, agent } = await deployRonWithAttests();
      await time.increase((30 + 151) * 24 * 60 * 60);
      const [, , score, , decayBps] = await ron.getScoreDetails(agent.address);
      expect(decayBps).to.eq(0n);
      expect(score).to.eq(0n);
    });

    it("keeps getSelfAttestScore backwards compatible", async () => {
      const { ron, agent } = await deployRonWithAttests();
      const [completions, disputes, score] = await ron.getSelfAttestScore(agent.address);
      expect(completions).to.eq(2n);
      expect(disputes).to.eq(0n);
      expect(score).to.eq(2n);
    });
  });
});