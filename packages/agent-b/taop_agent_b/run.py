"""
TAOP Agent B — a research agent that discovers Agent A's summarization
capability via the TAOP protocol and uses it to summarize a passage.

Flow:
  1. Agent B queries the Capability Registry + RON via the TAOP Python SDK
     (discover("LoRA", min_score=1)).
  2. Agent B picks the top-ranked agent (Agent A) by self-attest score.
  3. Agent B sends a real summarization request to Agent A's HTTP endpoint
     (the TAOP backend's /api/demo/run, which runs the LoRA + self-attests).
  4. Agent B verifies the on-chain attestation via the SDK (getCompletion,
     getSelfAttestScore).
  5. Agent B prints the summary + the on-chain proof.

Usage:
  cd packages/agent-b
  . ../python-sdk/.venv/bin/activate
  pip install -e .
  python -m taop_agent_b.run

  Or with a custom corpus:
  python -m taop_agent_b.run --text "Your text to summarize..."
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

# Add the python-sdk to the path so we can import taop
SDK_PATH = Path(__file__).resolve().parents[2] / "python-sdk"
if str(SDK_PATH) not in sys.path:
    sys.path.insert(0, str(SDK_PATH))

from taop import (
    ReputationOracleNetworkClient,
    CapabilityRegistryClient,
    connect,
    load_account,
    discover,
    LORA_CAPABILITY_TYPE,
)
from taop.types import Deployment


def load_env():
    env = {}
    env_path = Path(__file__).resolve().parents[3] / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def load_deployment():
    dep_path = Path(__file__).resolve().parents[3] / "deployments.json"
    data = json.loads(dep_path.read_text())
    return data


def main():
    parser = argparse.ArgumentParser(description="TAOP Agent B — discover + use Agent A's capability")
    parser.add_argument("--text", default=None, help="Text to summarize (default: a fixed demo passage)")
    parser.add_argument("--backend-url", default="http://localhost:4000", help="Agent A's backend URL")
    parser.add_argument("--min-score", type=int, default=1, help="Minimum self-attest score to accept")
    args = parser.parse_args()

    env = load_env()
    deployment = load_deployment()

    # The text to summarize
    corpus = args.text or (
        "AI agents increasingly need to discover, verify, and pay other agents "
        "without relying on a centralized platform. The TAOP protocol provides "
        "a trustless reputation layer using on-chain self-attestation and public "
        "challenge with ETH bonds on Base."
    )

    print("=" * 60)
    print("TAOP Agent B — Discovery + Capability Use")
    print("=" * 60)

    # --- Step 1: Connect to Base Sepolia ---
    rpc = env.get("BASE_SEPOLIA_RPC_URL", env.get("RPC_URL", "http://127.0.0.1:8545"))
    chain_id = deployment["chainId"]
    w3 = connect(rpc, chain_id)
    if not w3.is_connected():
        print(f"ERROR: Could not connect to {rpc}")
        sys.exit(1)
    print(f"\n[1] Connected to chain {chain_id} via {rpc[:40]}...")

    # --- Step 2: Discover agents with LoRA capability ---
    ron = ReputationOracleNetworkClient(deployment["ron"], w3)
    registry = CapabilityRegistryClient(deployment["registry"], w3)

    print(f"\n[2] Discovering agents with capability='{LORA_CAPABILITY_TYPE}', min_score={args.min_score}...")
    results = discover(registry, ron, capability_type=LORA_CAPABILITY_TYPE, min_score=args.min_score)

    if not results:
        print("    No agents found. Run the demo first to register + attest Agent A.")
        sys.exit(1)

    for r in results:
        print(f"    → {r['agentAddress'][:12]}...  score={r['score']}  "
              f"completions={r['completions']}  disputes={r['disputes']}  "
              f"capabilityId={r['capabilityId']}  certified={r['certified']}")

    # --- Step 3: Pick the top-ranked agent (Agent A) ---
    agent_a = results[0]
    print(f"\n[3] Selected Agent A: {agent_a['agentAddress']}")
    print(f"    Capability: #{agent_a['capabilityId']} ({agent_a['capabilityType']})")
    print(f"    Score: {agent_a['score']} (completions={agent_a['completions']}, disputes={agent_a['disputes']})")
    print(f"    Bond: {agent_a['bond']} wei (ETH)")
    print(f"    Metadata: {agent_a['metadataCID']}")

    # --- Step 4: Use Agent A's capability (send summarization request) ---
    print(f"\n[4] Requesting summarization from Agent A via {args.backend_url}/api/demo/run...")
    print(f"    Input: \"{corpus[:80]}...\"")

    try:
        resp = requests.post(
            f"{args.backend_url}/api/demo/run",
            json={},
            timeout=120,
        )
        resp.raise_for_status()
        demo = resp.json()
    except Exception as e:
        print(f"    ERROR: {e}")
        sys.exit(1)

    print(f"\n    ✅ Agent A completed the task:")
    print(f"    completionId: {demo.get('completionId', '?')}")
    print(f"    modelUsed: {demo.get('modelUsed', '?')}")
    print(f"    latencyMs: {demo.get('latencyMs', '?')}ms")
    print(f"    resultCID: {demo.get('resultCID', '?')[:40]}...")
    print(f"    txHash: {demo.get('attestTx', '?')[:20]}...")

    summary = demo.get("summary", "")
    if summary:
        print(f"\n    📝 Summary:")
        print(f"    \"{summary}\"")

    # --- Step 5: Verify the on-chain attestation ---
    completion_id = int(demo.get("completionId", 0))
    if completion_id > 0:
        print(f"\n[5] Verifying on-chain attestation (completion #{completion_id})...")
        # Retry briefly for L2 finality
        completion = None
        for attempt in range(5):
            try:
                completion = ron.get_completion(completion_id)
                break
            except Exception:
                time.sleep(2)

        if completion:
            print(f"    agent: {completion.agent}")
            print(f"    taskType: 0x{completion.task_type.hex()}")
            print(f"    resultCID: {completion.result_cid}")
            print(f"    timestamp: {completion.timestamp}")
            print(f"    challenged: {completion.challenged}")
            print(f"    disputed: {completion.disputed}")

            score = ron.get_self_attest_score(completion.agent)
            print(f"\n    Agent A's current score: {score.score} "
                  f"(completions={score.completions}, disputes={score.disputes})")
            print(f"    ✅ Verified on-chain — no platform vouched for this agent.")

    # --- Show explorer link ---
    explorer = "https://sepolia.basescan.org" if chain_id == 84532 else "https://basescan.org"
    tx_hash = demo.get("attestTx", "")
    if tx_hash:
        print(f"\n🔗 View on Basescan: {explorer}/tx/{tx_hash}")
    print(f"🔗 RON contract: {explorer}/address/{deployment['ron']}")
    print(f"\n{'=' * 60}")
    print("Agent B done. The TAOP protocol worked: discovery → use → verification.")
    print("=" * 60)


if __name__ == "__main__":
    main()
