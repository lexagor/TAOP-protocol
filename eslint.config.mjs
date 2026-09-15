import tseslint from "typescript-eslint";

/**
 * ESLint (flat config). Lints the TypeScript across the workspace: contracts
 * scripts, hardhat tests, backend, SDKs, MCP server, and both demo apps.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/coverage/**",
      "**/typechain-types/**",
      "**/artifacts/**",
      "**/cache/**",
      "**/cache_forge/**",
      "lib/**",
      "packages/python-sdk/**",
      "docs/api/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // The codebase deliberately uses `any` at a few RPC/SDK boundaries.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/ban-ts-comment": "off",
      // Empty catch blocks are used intentionally for best-effort fallbacks.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
