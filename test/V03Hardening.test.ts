import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * v0.3 hardening: pause/circuit-breaker, attestation cooldown, and the
 * diversity-adjusted credit score.
 */
describe("v0.3 hardening — pause, cooldown, diversity score", () => {
  const SUMMARY = ethers.id("summarization");
  const LORA = ethers.id("LoRA");
  const BOND = ethers.parseEther("0.01");
  const WINDOW = 3 * 24 * 60 * 60;

  async function deployRon() {
    const [owner, agent, cp1, cp2, challenger] = await ethers.getSigners();
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    await ron.waitForDeployment();
    return { ron, owner, agent, cp1, cp2, challenger };
  }

  describe("pause (circuit breaker)", () => {
    it("only owner can pause/unpause and it blocks protocol actions", async () => {
      const { ron, owner, agent, cp1, challenger } = await deployRon();
      await expect(ron.connect(agent).pause()).to.be.revertedWithCustomError(ron, "OwnableUnauthorizedAccount");

      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(owner).pause();

      await expect(ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r2")).to.be.revertedWithCustomError(
        ron,
        "EnforcedPause",
      );
      await expect(ron.connect(cp1).attestReceipt(1, "ipfs://rec")).to.be.revertedWithCustomError(ron, "EnforcedPause");
      await expect(
        ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND }),
      ).to.be.revertedWithCustomError(ron, "EnforcedPause");

      await ron.connect(owner).unpause();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r2");
      expect(await ron.completionCount(agent.address)).to.eq(2n);
    });

    it("exits are never paused: the counterparty can still revoke a receipt", async () => {
      const { ron, owner, agent, cp1 } = await deployRon();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(cp1).attestReceipt(1, "ipfs://rec");
      await ron.connect(owner).pause();
      await expect(ron.connect(cp1).revokeReceipt(1)).to.emit(ron, "ReceiptRevoked");
      expect(await ron.confirmedCount(agent.address)).to.eq(0n);
    });

    it("the owner can still resolve a pending challenge while paused", async () => {
      const { ron, owner, agent, challenger } = await deployRon();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
      await ron.connect(owner).pause();
      await ron.connect(owner).resolveChallenge(1, true);
      expect(await ron.disputeCount(agent.address)).to.eq(1n);
    });
  });

  describe("attestation cooldown", () => {
    it("is off by default and settable only by the owner", async () => {
      const { ron, agent } = await deployRon();
      expect(await ron.attestCooldown()).to.eq(0n);
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r1");
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r2"); // no cooldown

      await expect(ron.connect(agent).setAttestCooldown(60n)).to.be.revertedWithCustomError(
        ron,
        "OwnableUnauthorizedAccount",
      );
      await expect(ron.setAttestCooldown(60n)).to.emit(ron, "AttestCooldownChanged").withArgs(60n);
    });

    it("enforces the cooldown per address and clears after the window", async () => {
      const { ron, agent, cp1 } = await deployRon();
      await ron.setAttestCooldown(3600n);
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r1");
      await expect(ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r2")).to.be.revertedWithCustomError(
        ron,
        "CooldownActive",
      );
      // A different address is unaffected.
      await ron.connect(cp1).attestCompletion(SUMMARY, "ipfs://r3");
      await time.increase(3601);
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r2");
      expect(await ron.completionCount(agent.address)).to.eq(2n);
    });
  });

  describe("diversity-adjusted credit score", () => {
    it("counts distinct counterparties, not raw confirmations", async () => {
      const { ron, agent, cp1, cp2 } = await deployRon();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r1");
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r2");
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r3");
      await ron.connect(cp1).attestReceipt(1, "ipfs://rec1");
      await ron.connect(cp1).attestReceipt(2, "ipfs://rec2"); // same counterparty
      await ron.connect(cp2).attestReceipt(3, "ipfs://rec3"); // second counterparty

      const [twoSided] = await ron.getTwoSidedScore(agent.address);
      expect(twoSided).to.eq(3n); // raw confirmations

      const [distinct, disputes, credit] = await ron.getCreditScore(agent.address);
      expect(distinct).to.eq(2n); // diversity signal
      expect(disputes).to.eq(0n);
      expect(credit).to.eq(2n); // distinct - disputes
    });

    it("decrements diversity on revoke and on an upheld dispute", async () => {
      const { ron, agent, cp1, cp2, challenger } = await deployRon();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r1");
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r2");
      await ron.connect(cp1).attestReceipt(1, "ipfs://rec1");
      await ron.connect(cp2).attestReceipt(2, "ipfs://rec2");
      expect((await ron.getCreditScore(agent.address))[0]).to.eq(2n);

      await ron.connect(cp2).revokeReceipt(2);
      expect((await ron.getCreditScore(agent.address))[0]).to.eq(1n);

      // Challenge completion 1 (receipted by cp1) and finalize optimistically.
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
      await time.increase(WINDOW + 1);
      await ron.connect(challenger).finalizeChallenge(1);
      const [distinct, disputes] = await ron.getCreditScore(agent.address);
      expect(distinct).to.eq(0n);
      expect(disputes).to.eq(1n);
    });
  });

  describe("CapabilityRegistry pause", () => {
    it("blocks register/certify/slash but never blocks creator exits", async () => {
      const [owner, creator] = await ethers.getSigners();
      const Registry = await ethers.getContractFactory("CapabilityRegistry");
      const registry = await Registry.deploy(owner.address);
      await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m", { value: BOND });

      await registry.connect(owner).pause();
      await expect(
        registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m2", { value: BOND }),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
      await expect(registry.connect(owner).certifyCapability(1)).to.be.revertedWithCustomError(
        registry,
        "EnforcedPause",
      );
      await expect(registry.connect(owner).slashCapability(1, 1n)).to.be.revertedWithCustomError(
        registry,
        "EnforcedPause",
      );

      // Creator can still exit with funds while paused.
      await expect(registry.connect(creator).withdrawBond(1)).to.emit(registry, "BondWithdrawn");
      await registry.connect(owner).unpause();
    });
  });
});
