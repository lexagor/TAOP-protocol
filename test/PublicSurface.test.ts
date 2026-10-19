import { expect } from "chai";
import { ethers } from "hardhat";

/** Covers small public-surface paths the main suites don't exercise. */
describe("public surface coverage", () => {
  const SUMMARY = ethers.id("summarization");
  const LORA = ethers.id("LoRA");
  const BOND = ethers.parseEther("0.01"); // RON challenge bond
  const REG_BOND = ethers.parseEther("0.05"); // Registry MIN_BOND

  it("Registry exposes the capability type of a token", async () => {
    const [owner, creator] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CapabilityRegistry");
    const registry = await Registry.deploy(owner.address);
    await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://meta", { value: REG_BOND });
    expect(await registry.capabilityTypeOf(1)).to.eq(LORA);
  });

  it("RON stores, returns and updates agent identity metadata", async () => {
    const [, agent] = await ethers.getSigners();
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();

    expect(await ron.getAgentMetadata(agent.address)).to.eq("");
    await expect(ron.connect(agent).registerAgent("ipfs://profile-v1"))
      .to.emit(ron, "AgentRegistered")
      .withArgs(agent.address, "ipfs://profile-v1");
    expect(await ron.getAgentMetadata(agent.address)).to.eq("ipfs://profile-v1");

    await ron.connect(agent).registerAgent("ipfs://profile-v2");
    expect(await ron.getAgentMetadata(agent.address)).to.eq("ipfs://profile-v2");
  });

  it("keeps a counterparty's distinct count when only one of two receipts is invalidated", async () => {
    const [owner, agent, cp, challenger] = await ethers.getSigners();
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();

    await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r1");
    await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r2");
    await ron.connect(cp).attestReceipt(1, "ipfs://receipt1");
    await ron.connect(cp).attestReceipt(2, "ipfs://receipt2");
    expect(await ron.distinctCounterparties(agent.address)).to.eq(1n);
    expect(await ron.counterpartyConfirmations(agent.address, cp.address)).to.eq(2n);

    // Invalidate one receipt via an upheld challenge: the pair keeps one confirmation.
    await ron.connect(challenger).challengeCompletion(1, "ipfs://ev", { value: BOND });
    await ron.connect(owner).resolveChallenge(1, true);
    expect(await ron.counterpartyConfirmations(agent.address, cp.address)).to.eq(1n);
    expect(await ron.distinctCounterparties(agent.address)).to.eq(1n);
    expect(await ron.confirmedCount(agent.address)).to.eq(1n);
  });
});
