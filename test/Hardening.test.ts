import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Regression tests for the Slither triage (Phase 3 security pass):
 *  - zero-address guards on certifier + pool withdrawals
 *  - address event parameters are `indexed`, so indexers can filter by topic
 *    (used by the off-chain indexer / observability)
 */
describe("security hardening — Slither triage", () => {
  const SUMMARY = ethers.id("summarization");
  const LORA = ethers.id("LoRA");
  const BOND = ethers.parseEther("0.01");

  it("CapabilityRegistry rejects a zero certifier at construction", async () => {
    const Registry = await ethers.getContractFactory("CapabilityRegistry");
    await expect(Registry.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(Registry, "ZeroAddress");
  });

  it("setCertifier rejects the zero address", async () => {
    const [owner] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CapabilityRegistry");
    const registry = await Registry.deploy(owner.address);
    await expect(registry.connect(owner).setCertifier(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      registry,
      "ZeroAddress",
    );
  });

  it("withdrawEthPool rejects a zero recipient on both contracts", async () => {
    const [owner, creator] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CapabilityRegistry");
    const registry = await Registry.deploy(owner.address);
    await registry.connect(creator).registerCapabilityEth(LORA, "ipfs://m", { value: BOND });
    await expect(registry.connect(owner).withdrawEthPool(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(
      registry,
      "ZeroAddress",
    );

    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    await expect(ron.connect(owner).withdrawEthPool(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(
      ron,
      "ZeroAddress",
    );
  });

  it("address event params are indexed so logs can be filtered by topic", async () => {
    const [, agent] = await ethers.getSigners();
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    await ron.connect(agent).attestCompletion(SUMMARY, "ipfs://r");

    const topic0 = ron.interface.getEvent("SelfAttested")!.topicHash;
    const topic1 = ethers.zeroPadValue(agent.address, 32);
    const logs = await ethers.provider.getLogs({
      address: await ron.getAddress(),
      topics: [topic0, topic1],
    });
    expect(logs.length).to.eq(1);
    expect(ron.interface.parseLog(logs[0])!.args.agent).to.eq(agent.address);
  });
});
