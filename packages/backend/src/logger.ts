import pino from "pino";

/**
 * F12 — structured JSON logging for the backend.
 *
 * Set `LOG_LEVEL` (default `info`) to tune verbosity. All runtime logs go through
 * this logger so they can be shipped/parsed by an external collector; secrets are
 * never logged (see SECURITY.md).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "taop-backend" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "*.privateKey",
      "*.private_key",
      "*.agentAPk",
      "*.DEPLOYER_PK",
      "*.AGENT_A_PK",
      "*.PINATA_JWT",
      "*.REPLICATE_API_TOKEN",
    ],
    remove: true,
  },
});

export type Logger = typeof logger;
