import { defineConfig } from "vitest/config";

/**
 * Backend API tests (vitest + supertest). Kept separate from the Hardhat/Mocha
 * suite under ./test so the two runners never pick each other's files.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/backend/test/**/*.test.ts", "packages/mcp-server/test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
