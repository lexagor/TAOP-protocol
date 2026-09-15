import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const line = (msg: unknown) => JSON.stringify(msg) + "\n";

/**
 * Integration test for the published MCP server: spawn the built stdio server and
 * speak the MCP JSON-RPC handshake. Catches regressions in the shipped tool set
 * that unit tests of the handlers would miss.
 */
describe("MCP server (stdio JSON-RPC)", () => {
  it("initialize + tools/list exposes the tool set", async () => {
    if (!existsSync(ENTRY)) {
      throw new Error(`MCP server not built at ${ENTRY} — run 'npm run mcp:build' first`);
    }

    const child = spawn(process.execPath, [ENTRY], { stdio: ["pipe", "pipe", "pipe"] });
    const responses = new Map<number, { result?: { tools?: { name: string }[]; serverInfo?: { name?: string } } }>();
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (l) => {
      try {
        const m = JSON.parse(l);
        if (m && m.id != null) responses.set(m.id, m);
      } catch {
        /* non-JSON diagnostics */
      }
    });

    child.stdin.write(
      line({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vitest", version: "1" } },
      }),
    );
    child.stdin.write(line({ jsonrpc: "2.0", method: "notifications/initialized" }));
    child.stdin.write(line({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));

    const deadline = Date.now() + 15000;
    while (!responses.has(2) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    child.kill();

    const list = responses.get(2);
    expect(list, "no tools/list response").toBeTruthy();
    const names = (list!.result?.tools ?? []).map((t) => t.name);
    expect(names.length).toBeGreaterThanOrEqual(12);
    for (const expected of [
      "get_deployment_info",
      "get_agent_score",
      "discover_capabilities",
      "get_completion",
      "attest_completion",
      "attest_receipt",
      "contest_challenge",
      "finalize_challenge",
      "challenge_completion",
      "register_capability",
      "resolve_challenge",
    ]) {
      expect(names, expected).toContain(expected);
    }
    expect(responses.get(1)?.result?.serverInfo?.name).toBeTruthy();
  }, 30000);
});
