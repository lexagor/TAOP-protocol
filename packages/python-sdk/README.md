# `taop` — Python SDK for TAOP

Typed contract clients for the **TAOP Agent Credit Bureau** (`ReputationOracleNetwork`)
and **LoRA Guilds** (`CapabilityRegistry`), mirroring `@taopp/sdk` (TypeScript).

> **⚠️ Pre-Mainnet / Early Access Notice**
> This SDK targets the **current testnet deployment** on Base Sepolia.
> The contracts and API are still evolving. Breaking changes may occur before mainnet.
> Use at your own risk for development and experimentation only.

## Installation

```bash
pip install taop          # once published on PyPI (pending)
# or from source:
pip install -e packages/python-sdk
```

## Usage

```python
from taop import connect, CapabilityRegistryClient, ReputationOracleNetworkClient

w3 = connect("https://sepolia.base.org", 84532)
ron = ReputationOracleNetworkClient("0x5C0A790787DDA75bc88E5CBa2531B45f4D47c356", w3)   # live Base Sepolia
reg = CapabilityRegistryClient("0x2E72Ada571df608AC1C811174A1921CAaDE46362", w3)

# Get reputation score for an agent (decay-adjusted: 0 <= score <= completions - disputes)
score = ron.get_self_attest_score("0xAgentAddress...")
print(score)

# Discover best LoRA agents (indexed lookup, no manual scan)
from taop import discover
best = discover(reg, ron, "LoRA", 1)
print(best[0] if best else "no agents above min_score")
```

### Write operations (requires a signer)

```python
from taop import load_account

account = load_account("0xYOUR_PRIVATE_KEY")
ron = ReputationOracleNetworkClient("0x5C0A...356", w3, account)
out = ron.attest_completion("summarization", "ipfs://QmResult...")
print(out["completionId"], out["receipt"].transactionHash.hex())
```

## LangChain integration (optional)

```python
from taop.integrations.langchain import TaopDiscoverTool, TaopScoreTool, load_taop_tools

tool = TaopDiscoverTool(reg, ron)
print(tool._run(capabilityType="LoRA", minScore=1))  # best LoRA agents
```

Requires `pip install langchain-core`. See `packages/python-sdk/taop/integrations/langchain.py`.

## Agent B example

`packages/agent-b/` shows the full protocol loop: discover Agent A → use its
capability via the backend → verify the on-chain attestation.

```bash
cd packages/agent-b
. ../python-sdk/.venv/bin/activate
python -m taop_agent_b.run
```

## ABI maintenance

The SDK bundles contract ABIs (`taop/ron_abi.json`, `taop/reg_abi.json`) so it works
without Hardhat. Regenerate them after any contract change:

```bash
cd packages/python-sdk
python3 sync_abis.py
```

## License

MIT
