"""Tests for the TAOP Python SDK — run against Base Sepolia using .env credentials."""
import json
import os
from pathlib import Path

import pytest

from taop import (
    ReputationOracleNetworkClient,
    CapabilityRegistryClient,
    connect,
    load_account,
    discover,
    LORA_CAPABILITY_TYPE,
)


# Load deployment + credentials from .env / deployments.json
ROOT = Path(__file__).resolve().parents[3]
DEPLOYMENT_PATH = ROOT / "deployments.json"
ENV_PATH = ROOT / ".env"


def load_env():
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


@pytest.fixture(scope="module")
def env():
    return load_env()


@pytest.fixture(scope="module")
def deployment():
    data = json.loads(DEPLOYMENT_PATH.read_text())
    return data


@pytest.fixture(scope="module")
def w3(env, deployment):
    chain_id = deployment["chainId"]
    rpc = env.get("BASE_SEPOLIA_RPC_URL", env.get("RPC_URL", "http://127.0.0.1:8545"))
    w = connect(rpc, chain_id)
    assert w.is_connected(), f"Could not connect to {rpc}"
    return w


@pytest.fixture(scope="module")
def agent_a_account(env, deployment):
    pk = env.get("AGENT_A_PK", deployment.get("agentAPk", ""))
    assert pk, "No AGENT_A_PK in .env or deployments.json"
    return load_account(pk)


@pytest.fixture(scope="module")
def ron(w3, deployment, agent_a_account):
    return ReputationOracleNetworkClient(deployment["ron"], w3, agent_a_account)


@pytest.fixture(scope="module")
def registry(w3, deployment, agent_a_account):
    return CapabilityRegistryClient(deployment["registry"], w3, agent_a_account)


def test_ron_connected(ron):
    """RON contract is live on-chain."""
    assert ron.address.startswith("0x")


def test_capability_exists(registry):
    """At least one capability is registered (from the demo)."""
    total = registry.total_supply()
    assert total >= 1, "No capabilities registered"


def test_get_capability(registry):
    """getCapability returns a valid Capability struct."""
    cap = registry.get_capability(1)
    assert cap.creator.startswith("0x")
    assert cap.bond > 0
    assert cap.bond > 0
    assert cap.certified is True


def test_self_attest_score(ron, deployment):
    """getSelfAttestScore returns a valid score for Agent A."""
    score = ron.get_self_attest_score(deployment["agentA"])
    assert score.completions >= 0
    assert score.disputes >= 0
    assert score.score == max(0, score.completions - score.disputes)


def test_discover(registry, ron):
    """discover() returns at least one agent with a LoRA capability."""
    results = discover(registry, ron, capability_type=LORA_CAPABILITY_TYPE, min_score=0)
    assert len(results) >= 1
    top = results[0]
    assert top["certified"] is True
    assert top["slashed"] is False
    assert top["capabilityType"] == LORA_CAPABILITY_TYPE
    assert top["score"] >= 0


def test_discover_min_score_filter(registry, ron):
    """discover() with min_score filters correctly."""
    all_results = discover(registry, ron, min_score=0)
    if not all_results:
        pytest.skip("No capabilities to filter")
    max_score = max(r["score"] for r in all_results)
    filtered = discover(registry, ron, min_score=max_score + 1)
    assert all(r["score"] >= max_score + 1 for r in filtered)
