import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Phase 3 / F11 — two-sided attestations + optimistic challenge resolution.
 *
 *  - an independent counterparty countersigns a completion (`attestReceipt`)
 *  - the requester can withdraw the endorsement (`revokeReceipt`)
 *  - a challenge opens a CHALLENGE_WINDOW; if the agent does not contest it,
 *    anyone can finalize it optimistically (`finalizeChallenge`); contested
 *    challenges fall back to the owner (`resolveChallenge`)
 *  - `getTwoSidedScore` ranks on receipt-confirmed work, invalidated on a
 *    upheld dispute
 */
describe("ReputationOracleNetwork v0.2 — two-sided attestation (F11)", () => {
  const SUMMARY = ethers.id("summarization");
  const BOND = ethers.parseEther("0.01");
  const WINDOW = 3 * 24 * 60 * 60;

  async function deploy() {
    const [owner, agent, requester, challenger, other] = await ethers.getSigners();
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    await ron.waitForDeployment();
    // owner stays the deployer signer: resolveChallenge is directly callable.
    return { ron, owner, agent, requester, challenger, other };
  }

  it("exposes the challenge window constant", async () => {
    const { ron } = await deploy();
    expect(await ron.CHALLENGE_WINDOW()).to.eq(BigInt(WINDOW));
  });

  describe("receipts", () => {
    it("a counterparty countersigns a completion and it counts as confirmed", async () => {
      const { ron, agent, requester } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://result");

      await expect(ron.connect(requester).attestReceipt(1, "ipfs://receipt"))
        .to.emit(ron, "ReceiptAttested")
        .withArgs(1n, agent.address, requester.address);

      const c = await ron.getCompletion(1);
      expect(c.counterparty).to.eq(requester.address);
      expect(c.receiptTimestamp).to.be.gt(0n);
      expect(await ron.receiptCID(1)).to.eq("ipfs://receipt");
      expect(await ron.confirmedCount(agent.address)).to.eq(1n);

      const [confirmed, disputes, score] = await ron.getTwoSidedScore(agent.address);
      expect(confirmed).to.eq(1n);
      expect(disputes).to.eq(0n);
      expect(score).to.eq(1n);
    });

    it("refreshes lastActivity for the agent", async () => {
      const { ron, agent, requester } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await time.increase(10 * 24 * 60 * 60);
      const before = await ron.lastActivity(agent.address);
      await ron.connect(requester).attestReceipt(1, "ipfs://receipt");
      const after = await ron.lastActivity(agent.address);
      expect(after).to.be.gt(before);
    });

    it("rejects a self-receipt from the agent", async () => {
      const { ron, agent } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await expect(ron.connect(agent).attestReceipt(1, "ipfs://x")).to.be.revertedWithCustomError(
        ron,
        "ReceiptNotAllowed",
      );
    });

    it("rejects a second receipt", async () => {
      const { ron, agent, requester, other } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(requester).attestReceipt(1, "ipfs://receipt");
      await expect(ron.connect(other).attestReceipt(1, "ipfs://receipt2")).to.be.revertedWithCustomError(
        ron,
        "AlreadyReceipted",
      );
    });

    it("rejects a receipt for a nonexistent completion", async () => {
      const { ron, requester } = await deploy();
      await expect(ron.connect(requester).attestReceipt(999, "ipfs://x")).to.be.revertedWithCustomError(
        ron,
        "NoSuchCompletion",
      );
    });

    it("rejects a receipt while a challenge is pending", async () => {
      const { ron, agent, requester, challenger } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
      await expect(ron.connect(requester).attestReceipt(1, "ipfs://x")).to.be.revertedWithCustomError(
        ron,
        "ReceiptNotAllowed",
      );
    });

    it("lets the requester revoke an endorsement", async () => {
      const { ron, agent, requester } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(requester).attestReceipt(1, "ipfs://receipt");

      await expect(ron.connect(requester).revokeReceipt(1))
        .to.emit(ron, "ReceiptRevoked")
        .withArgs(1n, requester.address);

      const c = await ron.getCompletion(1);
      expect(c.counterparty).to.eq(ethers.ZeroAddress);
      expect(await ron.confirmedCount(agent.address)).to.eq(0n);
      expect(await ron.receiptCID(1)).to.eq("");
    });

    it("reverts revoke from a non-counterparty", async () => {
      const { ron, agent, requester, other } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(requester).attestReceipt(1, "ipfs://receipt");
      await expect(ron.connect(other).revokeReceipt(1)).to.be.revertedWithCustomError(ron, "NotCounterparty");
    });
  });

  describe("optimistic challenge resolution", () => {
    it("sets a deadline when challenged", async () => {
      const { ron, agent, challenger } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
      const ch = await ron.challenges(1);
      expect(ch.contested).to.eq(false);
      expect(ch.deadline).to.be.gt(BigInt(await time.latest()));
    });

    it("cannot finalize before the window closes", async () => {
      const { ron, agent, challenger } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
      await expect(ron.connect(challenger).finalizeChallenge(1)).to.be.revertedWithCustomError(
        ron,
        "ChallengeWindowOpen",
      );
    });

    it("upholds an uncontested challenge after the window (challenger refunded)", async () => {
      const { ron, agent, challenger } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
      await time.increase(WINDOW + 1);

      const before = await ethers.provider.getBalance(challenger.address);
      await expect(ron.connect(challenger).finalizeChallenge(1))
        .to.emit(ron, "ChallengeResolved")
        .withArgs(1n, true);

      expect(await ron.disputeCount(agent.address)).to.eq(1n);
      expect((await ron.getCompletion(1)).disputed).to.eq(true);
      expect(await ethers.provider.getBalance(challenger.address)).to.be.gt(before);
    });

    it("invalidates a receipt when a challenge is upheld", async () => {
      const { ron, agent, requester, challenger } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(requester).attestReceipt(1, "ipfs://receipt");
      expect(await ron.confirmedCount(agent.address)).to.eq(1n);

      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
      await time.increase(WINDOW + 1);
      await ron.connect(challenger).finalizeChallenge(1);

      expect(await ron.confirmedCount(agent.address)).to.eq(0n);
      const c = await ron.getCompletion(1);
      expect(c.counterparty).to.eq(ethers.ZeroAddress);
      const [confirmed, , score] = await ron.getTwoSidedScore(agent.address);
      expect(confirmed).to.eq(0n);
      expect(score).to.eq(0n);
    });

    it("lets the agent contest within the window, blocking optimistic finalize", async () => {
      const { ron, agent, challenger, other } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });

      await expect(ron.connect(agent).contestChallenge(1, "ipfs://rebuttal"))
        .to.emit(ron, "ChallengeContested")
        .withArgs(1n, agent.address, "ipfs://rebuttal");

      const ch = await ron.challenges(1);
      expect(ch.contested).to.eq(true);
      expect(ch.rebuttalCID).to.eq("ipfs://rebuttal");

      await time.increase(WINDOW + 1);
      await expect(ron.connect(other).finalizeChallenge(1)).to.be.revertedWithCustomError(
        ron,
        "ChallengeAlreadyContested",
      );
    });

    it("only the agent can contest", async () => {
      const { ron, agent, challenger, other } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
      await expect(ron.connect(other).contestChallenge(1, "ipfs://rebuttal")).to.be.revertedWithCustomError(
        ron,
        "NotAgent",
      );
    });

    it("cannot contest after the window closes", async () => {
      const { ron, agent, challenger } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
      await time.increase(WINDOW + 1);
      await expect(ron.connect(agent).contestChallenge(1, "ipfs://rebuttal")).to.be.revertedWithCustomError(
        ron,
        "ChallengeWindowClosed",
      );
    });

    it("owner resolves a contested challenge (upheld)", async () => {
      const { ron, owner, agent, challenger } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
      await ron.connect(agent).contestChallenge(1, "ipfs://rebuttal");

      await expect(ron.connect(owner).resolveChallenge(1, true))
        .to.emit(ron, "ChallengeResolved")
        .withArgs(1n, true);
      expect(await ron.disputeCount(agent.address)).to.eq(1n);
    });

    it("owner resolves a contested challenge (rejected -> challenger forfeits)", async () => {
      const { ron, owner, agent, challenger } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
      await ron.connect(agent).contestChallenge(1, "ipfs://rebuttal");
      await ron.connect(owner).resolveChallenge(1, false);
      expect(await ron.disputeCount(agent.address)).to.eq(0n);
      expect(await ron.slashedEthPool()).to.eq(BOND);
    });
  });

  describe("two-sided score", () => {
    it("counts only confirmed completions", async () => {
      const { ron, agent, requester } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r1");
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r2");
      await ron.connect(requester).attestReceipt(1, "ipfs://receipt");

      const [confirmed, , twoSided] = await ron.getTwoSidedScore(agent.address);
      expect(confirmed).to.eq(1n);
      expect(twoSided).to.eq(1n);

      // legacy self-attest score still counts both self-reports
      const [completions, , selfAttest] = await ron.getSelfAttestScore(agent.address);
      expect(completions).to.eq(2n);
      expect(selfAttest).to.eq(2n);
    });

    it("applies the same decay as the self-attest score", async () => {
      const { ron, agent, requester } = await deploy();
      await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
      await ron.connect(requester).attestReceipt(1, "ipfs://receipt");
      await time.increase(31 * 24 * 60 * 60); // 1 day past grace
      const [, , score, , decayBps] = await ron.getTwoSidedScore(agent.address);
      expect(decayBps).to.be.lt(10000n);
      expect(decayBps).to.be.gt(9000n);
      expect(score).to.eq(0n); // 1 * ~0.993 floors to 0
    });
  });
});
