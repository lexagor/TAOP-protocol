"""Typed contract clients for TAOP MVP — mirrors @taopp/sdk (TypeScript)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional, Union

from eth_account import Account
from eth_utils import to_hex
from web3 import Web3
from web3.contract import AsyncContract, Contract
from web3.middleware import ExtraDataToPOAMiddleware

from .abis import CAPABILITY_REGISTRY_ABI, RON_ABI
from .types import (
    AgentScore,
    Capability,
    Completion,
    Deployment,
    SelfAttestScore,
    LORA_CAPABILITY_TYPE,
)


def _keccak(s: str) -> bytes:
    return Web3.keccak(text=s)


def _load_deployment(path: Union[str, Path]) -> Deployment:
    data = json.loads(Path(path).read_text())
    return Deployment(
        chain_id=data["chainId"],
        token=data["token"],
        ron=data["ron"],
        registry=data["registry"],
        validator=data["validator"],
        agent_a=data["agentA"],
        agent_pk=data.get("agentAPk", ""),
        validator_stake=data.get("validatorStake", "0"),
        network=data.get("network", ""),
        deployed_at=data.get("deployedAt", ""),
    )


class ReputationOracleNetworkClient:
    """Client for the ReputationOracleNetwork (Credit Bureau) contract."""

    def __init__(self, address: str, w3: Web3, account: Optional[Account] = None):
        self.w3 = w3
        self.account = account
        self.contract = w3.eth.contract(address=address, abi=RON_ABI)

    @property
    def address(self) -> str:
        return self.contract.address

    def get_agent_score(self, agent: str) -> AgentScore:
        r = self.contract.functions.getAgentScore(agent).call()
        return AgentScore(total_score=r[0], count=r[1], last_updated=r[2])

    def get_self_attest_score(self, agent: str) -> SelfAttestScore:
        r = self.contract.functions.getSelfAttestScore(agent).call()
        return SelfAttestScore(completions=r[0], disputes=r[1], score=r[2])

    def get_completion(self, completion_id: int) -> Completion:
        r = self.contract.functions.getCompletion(completion_id).call()
        return Completion(
            agent=r[0], task_type=r[1], result_cid=r[2], timestamp=r[3],
            challenged=r[4], disputed=r[5],
        )

    def completion_count(self, agent: str) -> int:
        return self.contract.functions.completionCount(agent).call()

    def challenge_bond(self) -> int:
        return self.contract.functions.CHALLENGE_BOND().call()

    def _send_tx(self, tx):
        if self.account is None:
            raise ValueError("No account set — cannot send transactions")
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        return self.w3.eth.wait_for_transaction_receipt(tx_hash)

    def attest_completion(self, task_type: str, result_cid: str) -> dict:
        """Self-attest a completion. Returns {'completionId': int, 'receipt': dict}."""
        fn = self.contract.functions.attestCompletion(_keccak(task_type), result_cid)
        tx = fn.build_transaction({
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "gas": 200_000,
            "gasPrice": self.w3.eth.gas_price,
            "chainId": self.w3.eth.chain_id,
        })
        receipt = self._send_tx(tx)
        # Read nextCompletionId after confirmation
        completion_id = self.contract.functions.nextCompletionId().call()
        return {"completionId": completion_id, "receipt": receipt}

    def challenge_completion(self, completion_id: int, evidence_cid: str, bond_wei: int) -> dict:
        bond = self.challenge_bond() if bond_wei is None else bond_wei
        fn = self.contract.functions.challengeCompletion(completion_id, evidence_cid)
        tx = fn.build_transaction({
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "value": bond,
            "gas": 200_000,
            "gasPrice": self.w3.eth.gas_price,
            "chainId": self.w3.eth.chain_id,
        })
        return self._send_tx(tx)

    def resolve_challenge(self, completion_id: int, upheld: bool) -> dict:
        fn = self.contract.functions.resolveChallenge(completion_id, upheld)
        tx = fn.build_transaction({
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "gas": 200_000,
            "gasPrice": self.w3.eth.gas_price,
            "chainId": self.w3.eth.chain_id,
        })
        return self._send_tx(tx)


class CapabilityRegistryClient:
    """Client for the CapabilityRegistry (LoRA Guilds) contract."""

    def __init__(self, address: str, w3: Web3, account: Optional[Account] = None):
        self.w3 = w3
        self.account = account
        self.contract = w3.eth.contract(address=address, abi=CAPABILITY_REGISTRY_ABI)

    @property
    def address(self) -> str:
        return self.contract.address

    def total_supply(self) -> int:
        return self.contract.functions.totalSupply().call()

    def token_by_index(self, index: int) -> int:
        return self.contract.functions.tokenByIndex(index).call()

    def get_capability(self, capability_id: int) -> Capability:
        r = self.contract.functions.getCapability(capability_id).call()
        return Capability(
            creator=r[0], bond=r[1], capability_type=r[2], metadata_cid=r[3],
            certified=r[4], slashed=r[5],
        )

    def _send_tx(self, tx):
        if self.account is None:
            raise ValueError("No account set — cannot send transactions")
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        return self.w3.eth.wait_for_transaction_receipt(tx_hash)

    def register_capability_eth(self, capability_type: str, metadata_cid: str, bond_wei: int) -> dict:
        """Register a capability with an ETH bond. Returns {'capabilityId': int, 'receipt': dict}."""
        fn = self.contract.functions.registerCapabilityEth(_keccak(capability_type), metadata_cid)
        tx = fn.build_transaction({
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "value": bond_wei,
            "gas": 300_000,
            "gasPrice": self.w3.eth.gas_price,
            "chainId": self.w3.eth.chain_id,
        })
        receipt = self._send_tx(tx)
        capability_id = self.contract.functions.totalSupply().call()
        return {"capabilityId": capability_id, "receipt": receipt}

    def certify_capability(self, capability_id: int) -> dict:
        fn = self.contract.functions.certifyCapability(capability_id)
        tx = fn.build_transaction({
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "gas": 100_000,
            "gasPrice": self.w3.eth.gas_price,
            "chainId": self.w3.eth.chain_id,
        })
        return self._send_tx(tx)


def connect(rpc_url: str, chain_id: int) -> Web3:
    """Create a Web3 instance with POA middleware (needed for Base)."""
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    if chain_id in (84532, 8453, 31337):
        # Base / Base Sepolia / hardhat may need POA middleware
        try:
            w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        except Exception:
            pass  # Already injected or not needed
    return w3


def load_account(private_key: str) -> Account:
    """Load an eth-account from a private key string."""
    return Account.from_key(private_key)


def discover(
    registry: CapabilityRegistryClient,
    ron: ReputationOracleNetworkClient,
    capability_type: str = LORA_CAPABILITY_TYPE,
    min_score: int = 0,
) -> list[dict]:
    """Discover agents by capability proof + self-attest score. Mirrors /api/discover."""
    type_hash = _keccak(capability_type)
    total = registry.total_supply()
    results = []
    for i in range(total):
        cap_id = registry.token_by_index(i)
        cap = registry.get_capability(cap_id)
        if cap.capability_type != type_hash:
            continue
        if not cap.certified or cap.slashed:
            continue
        score = ron.get_self_attest_score(cap.creator)
        if score.score < min_score:
            continue
        results.append({
            "agentAddress": cap.creator,
            "capabilityId": cap_id,
            "capabilityType": capability_type,
            "certified": cap.certified,
            "slashed": cap.slashed,
            "bond": cap.bond,
            "metadataCID": cap.metadata_cid,
            "completions": score.completions,
            "disputes": score.disputes,
            "score": score.score,
        })
    results.sort(key=lambda x: x["score"], reverse=True)
    return results
