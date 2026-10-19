import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * v0.5 anti-sybil economics: stake-capped ranking scores, challenge
 * eligibility, dispute bounties, and the Registry minimum bond.
 */
describe("v0.5 anti-sybil economics", () => {
  const SUMMARY = ethers.id("summarization");
  const LORA = ethers.id("LoRA");
  const CHALLENGE = ethers.parseEther("0.01");
  const ELIGIBILITY = 7 * 24 * 60 * 60;
  const STAKE_PER_POINT = ethers.parseEther("0.01");

  async function deployRon() {
    const [owner, agent, cp, challenger] = await ethers.getSigners();
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    await ron.waitForDeployment();
    return { ron, owner, agent, cp, challenger };
  }

  describe("stake-capped ranking", () => {
    it("caps two-sided ranking at FREE_POINTS and lifts it with stake", async () => {
      const { ron, agent, cp } = await deployRon();
      for (let i = 0; i < 10; i += 1) {
        await ron.connect(agent).attestCompletion(SUMMARY, `ipfs://r${i}`);
        await ron.connect(cp).attestReceipt(i + 1, `ipfs://receipt${i}`);
      }
      expect(await ron.confirmedCount(agent.address)).to.eq(10n);
      // Legacy self-attest remains an uncapped counter.
      expect((await ron.getSelfAttestScore(agent.address))[2]).to.eq(10n);

      // No stake means no ranking points (FREE_POINTS = 0).
      expect((await ron.getTwoSidedScore(agent.address))[2]).to.eq(0n);

      // 10 points of stake lifts the cap to 10.
      await ron.connect(agent).depositStake({ value: 10n * STAKE_PER_POINT });
      expect((await ron.getTwoSidedScore(agent.address))[2]).to.eq(10n);
      expect((await ron.getCreditScore(agent.address))[2]).to.eq(1n); // one distinct counterparty
    });

    it("caps the credit score by stake too", async () => {
      const signers = await ethers.getSigners();
      const agent = signers[1];
      const cps = signers.slice(2, 12); // 10 distinct counterparties
      const RON = await ethers.getContractFactory("ReputationOracleNetwork");
      const ron = await RON.deploy();

      for (let i = 0; i < 10; i += 1) {
        await ron.connect(agent).attestCompletion(SUMMARY, `ipfs://r${i}`);
        await ron.connect(cps[i]).attestReceipt(i + 1, `ipfs://receipt${i}`);
      }
      expect(await ron.distinctCounterparties(agent.address)).to.eq(10n);
      // Uncapped credit would be 10; without stake the ranking score is 0.
      expect((await ron.getCreditScore(agent.address))[2]).to.eq(0n);

      await ron.connect(agent).depositStake({ value: 10n * STAKE_PER_POINT });
      expect((await ron.getCreditScore(agent.address))[2]).to.eq(10n);
    });

    it("blocks stake withdrawal until the challenge window and when challenges are pending", async () => {
      const { ron, agent, challenger } = await deployRon();
      await ron.connect(agent).depositStake({ value: ethers.parseEther("0.02") });
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");

      await expect(ron.connect(agent).withdrawStake(ethers.parseEther("0.01"))).to.be.revertedWithCustomError(
        ron,
        "StakeLocked",
      );

      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE });
      await time.increase(ELIGIBILITY + 1);
      await expect(ron.connect(agent).withdrawStake(ethers.parseEther("0.01"))).to.be.revertedWithCustomError(
        ron,
        "ChallengesPending",
      );

      await ron.resolveChallenge(1, false);
      await ron.connect(agent).withdrawStake(ethers.parseEther("0.01"));
      expect(await ron.stake(agent.address)).to.eq(ethers.parseEther("0.01"));
    });

    it("rejects a zero stake deposit", async () => {
      const { ron, agent } = await deployRon();
      await expect(ron.connect(agent).depositStake({ value: 0 })).to.be.revertedWithCustomError(
        ron,
        "NoStake",
      );
    });

    it("rejects zero/oversized withdrawals", async () => {
      const { ron, agent } = await deployRon();
      await expect(ron.connect(agent).withdrawStake(0)).to.be.revertedWithCustomError(ron, "NoStake");
      await ron.connect(agent).depositStake({ value: ethers.parseEther("0.01") });
      await expect(ron.connect(agent).withdrawStake(ethers.parseEther("0.02"))).to.be.revertedWithCustomError(
        ron,
        "NoStake",
      );
    });
  });

  describe("challenge eligibility", () => {
    it("rejects challenges after the eligibility window", async () => {
      const { ron, agent, challenger } = await deployRon();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      const c = await ron.getCompletion(1);
      const deadline = BigInt(c.timestamp) + BigInt(ELIGIBILITY);
      await time.increaseTo(deadline + 1n);
      await expect(ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE }))
        .to.be.revertedWithCustomError(ron, "ChallengeEligibilityClosed")
        .withArgs(deadline);
    });
  });

  describe("dispute bounty", () => {
    it("slashes stake and credits the challenger (bond refund + bounty)", async () => {
      const { ron, owner, agent, challenger } = await deployRon();
      await ron.connect(agent).depositStake({ value: ethers.parseEther("0.02") });
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE });

      await expect(ron.connect(owner).resolveChallenge(1, true)).to.emit(ron, "StakeSlashed");
      // SLASH_PER_DISPUTE (0.05) is capped by the 0.02 stake.
      expect(await ron.stake(agent.address)).to.eq(0n);
      expect(await ron.pendingWithdrawals(challenger.address)).to.eq(
        CHALLENGE + ethers.parseEther("0.02"),
      );

      await ron.connect(challenger).withdrawRefund();
      expect(await ron.pendingWithdrawals(challenger.address)).to.eq(0n);
    });

    it("pays no bounty when the agent has no stake", async () => {
      const { ron, owner, agent, challenger } = await deployRon();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE });
      await expect(ron.connect(owner).resolveChallenge(1, true)).to.not.emit(ron, "StakeSlashed");
      expect(await ron.pendingWithdrawals(challenger.address)).to.eq(CHALLENGE);
    });

    it("slashes exactly SLASH_PER_DISPUTE when the stake covers it", async () => {
      const { ron, owner, agent, challenger } = await deployRon();
      await ron.connect(agent).depositStake({ value: ethers.parseEther("0.1") });
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE });
      await ron.connect(owner).resolveChallenge(1, true);

      expect(await ron.stake(agent.address)).to.eq(ethers.parseEther("0.05"));
      expect(await ron.pendingWithdrawals(challenger.address)).to.eq(
        CHALLENGE + ethers.parseEther("0.05"),
      );
    });

    it("caps the bounty at the remaining stake", async () => {
      const { ron, owner, agent, challenger } = await deployRon();
      await ron.connect(agent).depositStake({ value: ethers.parseEther("0.004") });
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: CHALLENGE });
      await ron.connect(owner).resolveChallenge(1, true);

      expect(await ron.stake(agent.address)).to.eq(0n);
      expect(await ron.pendingWithdrawals(challenger.address)).to.eq(
        CHALLENGE + ethers.parseEther("0.004"),
      );
    });
  });

  describe("Registry minimum bond", () => {
    it("rejects bonds below MIN_BOND and accepts the minimum", async () => {
      const [owner, creator] = await ethers.getSigners();
      const Registry = await ethers.getContractFactory("CapabilityRegistry");
      const registry = await Registry.deploy(owner.address);
      const min = await registry.MIN_BOND();

      await expect(
        registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m", { value: min - 1n }),
      )
        .to.be.revertedWithCustomError(registry, "BondTooSmall")
        .withArgs(min - 1n, min);

      await expect(
        registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m", { value: min }),
      ).to.emit(registry, "CapabilityRegistered");
    });
  });
});
