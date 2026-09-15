import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Phase 3 / F10 — paginated capability discovery so clients and indexers never
 * have to load an unbounded `capabilitiesByType` array in one call.
 */
describe("CapabilityRegistry — paginated discovery (F10)", () => {
  const LORA = ethers.id("LoRA");
  const BOND = ethers.parseEther("0.01");

  async function deployWith(n: number) {
    const [creator] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CapabilityRegistry");
    const registry = await Registry.deploy(creator.address);
    await registry.waitForDeployment();
    for (let i = 1; i <= n; i++) {
      await registry.connect(creator).registerCapabilityEth(LORA, `ipfs://m${i}`, { value: BOND });
    }
    return { registry, creator };
  }

  it("counts live capabilities of a type", async () => {
    const { registry } = await deployWith(3);
    expect(await registry.countCapabilitiesByType(LORA)).to.eq(3n);
    expect(await registry.countCapabilitiesByType(ethers.id("other"))).to.eq(0n);
  });

  it("returns a clamped page", async () => {
    const { registry } = await deployWith(3);
    expect((await registry.getCapabilitiesByTypePaged(LORA, 0, 2)).map(String)).to.deep.eq(["1", "2"]);
    expect((await registry.getCapabilitiesByTypePaged(LORA, 1, 2)).map(String)).to.deep.eq(["2", "3"]);
    // offset+limit past the end clamps to the remaining ids
    expect((await registry.getCapabilitiesByTypePaged(LORA, 2, 10)).map(String)).to.deep.eq(["3"]);
  });

  it("returns an empty page for limit 0 or an offset past the end", async () => {
    const { registry } = await deployWith(2);
    expect((await registry.getCapabilitiesByTypePaged(LORA, 0, 0)).length).to.eq(0);
    expect((await registry.getCapabilitiesByTypePaged(LORA, 5, 10)).length).to.eq(0);
  });

  it("paging over the whole set matches getCapabilitiesByType, and stays correct after a burn", async () => {
    const { registry, creator } = await deployWith(3);
    await registry.connect(creator).withdrawBond(2); // swap-and-pop removes id 2

    const all = (await registry.getCapabilitiesByType(LORA)).map(String);
    expect(all.length).to.eq(2);
    expect(await registry.countCapabilitiesByType(LORA)).to.eq(2n);

    const paged: string[] = [];
    for (let offset = 0; offset < all.length; offset += 1) {
      paged.push(...(await registry.getCapabilitiesByTypePaged(LORA, offset, 1)).map(String));
    }
    expect(paged).to.deep.eq(all);
  });
});
