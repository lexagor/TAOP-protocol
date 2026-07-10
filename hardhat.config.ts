import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";

/** @type import("hardhat/config").HardhatUserConfig */
const config = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun" as const,
    },
  },
  tsconfig: "./tsconfig.hardhat.json",
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 60000,
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: process.env.RPC_URL || "http://127.0.0.1:8545",
      chainId: 31337,
      accounts: process.env.DEPLOYER_PK && process.env.DEPLOYER_PK.length === 66 ? [process.env.DEPLOYER_PK] : undefined,
    },
    baseSepolia: {
      url:
        process.env.BASE_SEPOLIA_RPC_URL ||
        "https://sepolia.base.org",   // public RPC (no key needed)
      chainId: 84532,
      accounts: process.env.DEPLOYER_PK && process.env.DEPLOYER_PK.length === 66 ? [process.env.DEPLOYER_PK] : undefined,
    },
    base: {
      url: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: process.env.DEPLOYER_PK && process.env.DEPLOYER_PK.length === 66 ? [process.env.DEPLOYER_PK] : undefined,
    },
    // For mainnet: use real delay via TIMELOCK_DELAY + multisig in deploy script
  },
  etherscan: {
    apiKey: { 
      baseSepolia: process.env.BASESCAN_API_KEY || "placeholder",
      base: process.env.BASESCAN_API_KEY || "placeholder"
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org/",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org/",
        },
      },
    ],
  },
};

export default config;
