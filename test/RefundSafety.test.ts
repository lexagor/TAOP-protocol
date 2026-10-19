import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Refunds are pull payments: a challenger contract whose receive() reverts must
 * not be able to block resolution/finalization (which would freeze the bond and
 * keep the completion permanently challenged).
 */
describe("refund safety — reverting receiver cannot block resolution", () => {
  const SUMMARY = ethers.id("summarization");
  const BOND = ethers.parseEther("0.01");
  const WINDOW = 3 * 24 * 60 * 60;

  async function deploy() {
    const [owner, agent, challenger] = await ethers.getSigners();
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    await ron.waitForDeployment();
    const Rejecting = await ethers.getContractFactory("RejectingChallenger");
    const rejecting = await Rejecting.deploy();
    await rejecting.waitForDeployment();
    return { ron, rejecting, owner, agent, challenger };
  }

  it("owner resolution succeeds and credits the refund pull-style", async () => {
    const { ron, rejecting, owner, agent } = await deploy();
    await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
    await rejecting.challenge(await ron.getAddress(), 1, { value: BOND });

    await expect(ron.connect(owner).resolveChallenge(1, true))
      .to.emit(ron, "ChallengeResolved")
      .withArgs(1n, true)
      .and.to.emit(ron, "RefundCredited")
      .withArgs(await rejecting.getAddress(), BOND);

    expect(await ron.pendingWithdrawals(await rejecting.getAddress())).to.eq(BOND);
    // Only the contract's own claim fails; the protocol is not blocked.
    await expect(rejecting.withdraw(await ron.getAddress())).to.be.revertedWith("withdraw failed");
  });

  it("optimistic finalize also succeeds and credits the refund", async () => {
    const { ron, rejecting, agent } = await deploy();
    await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
    await rejecting.challenge(await ron.getAddress(), 1, { value: BOND });
    await time.increase(WINDOW + 1);

    await expect(ron.connect(agent).finalizeChallenge(1)).to.emit(ron, "RefundCredited");
    expect(await ron.pendingWithdrawals(await rejecting.getAddress())).to.eq(BOND);
  });

  it("withdrawRefund reverts when there is nothing to claim", async () => {
    const { ron, challenger } = await deploy();
    await expect(ron.connect(challenger).withdrawRefund()).to.be.revertedWithCustomError(
      ron,
      "NothingToWithdraw",
    );
  });

  it("a challenger can claim the credit exactly once", async () => {
    const { ron, owner, agent, challenger } = await deploy();
    await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");
    await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
    await ron.connect(owner).resolveChallenge(1, true);

    await ron.connect(challenger).withdrawRefund();
    expect(await ron.pendingWithdrawals(challenger.address)).to.eq(0n);
    await expect(ron.connect(challenger).withdrawRefund()).to.be.revertedWithCustomError(
      ron,
      "NothingToWithdraw",
    );
  });
});
