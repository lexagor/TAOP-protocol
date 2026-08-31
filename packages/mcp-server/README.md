# @taopp/mcp-server

MCP (Model Context Protocol) server for the TAOP Agent Credit Bureau.

This allows AI agents (Claude, Cursor, etc.) to directly interact with the on-chain reputation system and capability registry.

## Installation

```bash
npm install -g @taopp/mcp-server
# or in the monorepo
npm install
npm run build -w @taopp/mcp-server
```

## Usage

Run with stdio (for Claude Desktop etc.):

```bash
npx @taopp/mcp-server
```

Or from source:

```bash
npm run dev -w @taopp/mcp-server
```

## Configuration

Create a `.env` (or set environment variables):

```env
RPC_URL=https://base-sepolia.infura.io/v3/YOUR_KEY
# Or use deployments.json (recommended)
DEPLOYMENTS_PATH=../../deployments.json

# For write operations (attest, challenge, register, resolve)
PRIVATE_KEY=0x...
# or DEPLOYER_PK or AGENT_A_PK
```

The server will automatically load addresses from `deployments.json` if present.

## Available Tools

- `get_deployment_info` - Contract addresses
- `get_agent_score` - Reputation of an agent
- `discover_capabilities` - Find high-scoring agents by capability type
- `get_capability`
- `get_completion`
- `attest_completion` - Self-attest work (requires signer)
- `challenge_completion` - Challenge fraud (requires signer + bond)
- `register_capability` - Register a LoRA / capability (requires signer + bond)
- `resolve_challenge` - Resolve disputes (owner only)

## Integration with Claude Desktop

Add to your Claude config (claude_desktop_config.json):

```json
{
  "mcpServers": {
    "taop": {
      "command": "npx",
      "args": ["@taopp/mcp-server"],
      "env": {
        "RPC_URL": "https://...",
        "PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

## LangChain alternative (no MCP)

For LangChain Python agents without MCP, use the SDK's native tools:

```python
from taop.integrations.langchain import TaopDiscoverTool, TaopScoreTool, load_taop_tools
tool = TaopDiscoverTool(registry, ron)
tool._run(capabilityType="LoRA", minScore=1)
```

See `packages/python-sdk/taop/integrations/langchain.py` and main `README.md`.

## Development

```bash
cd packages/mcp-server
npm run dev
```

## License

MIT
