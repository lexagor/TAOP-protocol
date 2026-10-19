import { expect } from "chai";

import { assertHardenedMainnet } from "../scripts/lib/security";

describe("mainnet deploy guard", () => {
  const safe = "0x1111111111111111111111111111111111111111";
  const deployer = "0x2222222222222222222222222222222222222222";
  const base = {
    chainId: 8453,
    isFork: false,
    minDelay: 86_400n,
    multisig: safe,
    proposers: [safe],
    executors: [safe],
    deployer,
  };

  it("refuses a 0-delay mainnet Timelock", () => {
    expect(() => assertHardenedMainnet({ ...base, minDelay: 0n })).to.throw(/TIMELOCK_DELAY/);
  });

  it("refuses a hot deployer EOA in the Timelock roles", () => {
    expect(() =>
      assertHardenedMainnet({
        ...base,
        multisig: undefined,
        proposers: [deployer],
        executors: [deployer],
      }),
    ).to.throw(/MULTISIG_ADDRESS/);
  });

  it("accepts a Safe + non-zero delay", () => {
    expect(() => assertHardenedMainnet(base)).to.not.throw();
  });

  it("accepts a non-deployer proposer/executor without MULTISIG_ADDRESS", () => {
    expect(() =>
      assertHardenedMainnet({ ...base, multisig: undefined, proposers: [safe], executors: [safe] }),
    ).to.not.throw();
  });

  it("exempts fork rehearsals and testnets", () => {
    expect(() =>
      assertHardenedMainnet({ ...base, isFork: true, minDelay: 0n, proposers: [deployer], executors: [deployer] }),
    ).to.not.throw();
    expect(() =>
      assertHardenedMainnet({ ...base, chainId: 84532, minDelay: 0n, proposers: [deployer], executors: [deployer] }),
    ).to.not.throw();
  });
});
