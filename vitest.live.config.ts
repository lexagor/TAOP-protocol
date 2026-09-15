import { defineConfig } from "vitest/config";

/**
 * Live, read-only tests against real deployed bytecode (Base Sepolia).
 * Separate from the unit runs because they depend on the public RPC; CI runs
 * them in a non-blocking job so rate-limits don't turn the whole pipeline red.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test-live/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
