import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ReputationOracleNetworkClient, CapabilityRegistryClient, discover } from "@taopp/sdk";

/**
 * Phase 3 — end-to-end v0.2 flow driven entirely through the published SDK
 * clients against the in-process Hardhat network. This is the closest thing to
 * "what an external agent sees" without deploying:
 *
 *   capability lifecycle → attest → two-sided receipt → challenge → contest →
 *   owner resolve (invalidates receipt) → optimistic finalize after the window
 */
describe("v0.2 E2E — SDK clients on the in-process network", () => {
  const LORA = "LoRA";
  const BOND = ethers.parseEther("0.01");

  async function deploy() {
    const [owner, agentA, requester, challenger] = await ethers.getSigners();
    const RON = await ethers.getContractFactory("ReputationOracleNetwork");
    const ron = await RON.deploy();
    await ron.waitForDeployment();
    const Registry = await ethers.getContractFactory("CapabilityRegistry");
    const registry = await Registry.deploy(owner.address);
    await registry.waitForDeployment();
    return { ron, registry, owner, agentA, requester, challenger };
  }

  it("runs the full two-sided flow through the SDK clients", async () => {
    const { ron, registry, owner, agentA, requester, challenger } = await deploy();
    const registryAgentA = new CapabilityRegistryClient(await registry.getAddress(), agentA);
    const registryOwner = new CapabilityRegistryClient(await registry.getAddress(), owner);
    const ronAgentA = new ReputationOracleNetworkClient(await ron.getAddress(), agentA);
    const ronRequester = new ReputationOracleNetworkClient(await ron.getAddress(), requester);
    const ronChallenger = new ReputationOracleNetworkClient(await ron.getAddress(), challenger);
    const ronOwner = new ReputationOracleNetworkClient(await ron.getAddress(), owner);

    // 1. Capability lifecycle (id from the emitted event, per v0.1.2).
    const { capabilityId } = await registryAgentA.registerCapabilityEth(LORA, "ipfs://cap", BOND);
    expect(capabilityId).to.eq(1n);
    await registryOwner.certifyCapability(capabilityId);
    expect((await registryAgentA.getCapability(capabilityId)).certified).to.eq(true);

    // 2. Self-attest + independent receipt → two-sided score.
    const a1 = await ronAgentA.attestCompletion("summarization", "ipfs://r1");
    expect(a1.completionId).to.eq(1n);
    await ronRequester.attestReceipt(a1.completionId, "ipfs://receipt1");

    const c1 = await ronAgentA.getCompletion(a1.completionId);
    expect(c1.counterparty.toLowerCase()).to.eq(requester.address.toLowerCase());
    expect(c1.receiptTimestamp).to.be.gt(0n);

    let two = await ronAgentA.getTwoSidedScore(agentA.address);
    expect(two.confirmed).to.eq(1n);
    expect(two.disputes).to.eq(0n);
    expect(two.score).to.eq(1n);
    expect((await ronAgentA.getRankingScore(agentA.address)).scoreType).to.eq("credit");

    // Discovery ranks on the two-sided score and never throws on a stale id.
    const found = await discover(registryAgentA, ronAgentA, LORA, 1);
    expect(found.length).to.eq(1);
    expect(found[0].scoreType).to.eq("credit");
    expect(found[0].score).to.eq(1n); // credit: 1 distinct counterparty

    // 3. Challenge → agent contests → owner resolves upheld (invalidates receipt).
    await ronChallenger.challengeCompletion(a1.completionId, "ipfs://ev", BOND);
    await ronAgentA.contestChallenge(a1.completionId, "ipfs://rebuttal");
    await ronOwner.resolveChallenge(a1.completionId, true);

    two = await ronAgentA.getTwoSidedScore(agentA.address);
    expect(two.confirmed).to.eq(0n);
    expect(two.disputes).to.eq(1n);
    expect((await ronAgentA.getCompletion(a1.completionId)).counterparty).to.eq(ethers.ZeroAddress);

    // 4. Optimistic path: uncontested challenge finalizes after the window.
    const a2 = await ronAgentA.attestCompletion("summarization", "ipfs://r2");
    await ronRequester.attestReceipt(a2.completionId, "ipfs://receipt2");
    await ronChallenger.challengeCompletion(a2.completionId, "ipfs://ev2", BOND);
    const window = await ronAgentA.challengeWindow();
    await time.increase(Number(window) + 1);
    await ronChallenger.finalizeChallenge(a2.completionId);

    two = await ronAgentA.getTwoSidedScore(agentA.address);
    expect(two.disputes).to.eq(2n);
    expect(two.confirmed).to.eq(0n);
  });

  it("paginates the capability index through the SDK", async () => {
    const { registry, agentA } = await deploy();
    const registryAgentA = new CapabilityRegistryClient(await registry.getAddress(), agentA);
    for (let i = 0; i < 3; i++) {
      await registryAgentA.registerCapabilityEth(LORA, `ipfs://c${i}`, BOND);
    }
    expect(await registryAgentA.countCapabilitiesByType(LORA)).to.eq(3n);
    expect((await registryAgentA.getCapabilitiesByTypePaged(LORA, 0, 2)).map(String)).to.deep.eq(["1", "2"]);
    expect((await registryAgentA.getCapabilitiesByTypePaged(LORA, 2, 2)).map(String)).to.deep.eq(["3"]);
    expect((await registryAgentA.getCapabilitiesByTypePaged(LORA, 10, 2)).length).to.eq(0);
  });
});
