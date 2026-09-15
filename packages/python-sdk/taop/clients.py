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
    TwoSidedScore,
    LORA_CAPABILITY_TYPE,
)


def _keccak(s: str) -> bytes:
    return Web3.keccak(text=s)


def _load_deployment(path: Union[str, Path]) -> Deployment:
    data = json.loads(Path(path).read_text())
    # `token` / `validatorStake` only exist in local-deploy output; the live
    # deployments.json is addresses-only (v0.1.2 removed key material from it).
    return Deployment(
        chain_id=data["chainId"],
        token=data.get("token", "0x0000000000000000000000000000000000000000"),
        ron=data["ron"],
        registry=data["registry"],
        validator=data["validator"],
        agent_a=data["agentA"],
        agent_pk=data.get("agentAPk", ""),
        validator_stake=data.get("validatorStake", "0"),
        network=data.get("network", ""),
        deployed_at=data.get("deployedAt", ""),
    )


def _event_id_from_receipt(contract, receipt, event_name: str, arg_name: str) -> Optional[int]:
    """v0.1.2: derive ids from the emitted event, never from supply counters
    (totalSupply()/nextCompletionId() diverge once capabilities are burned)."""
    if receipt is None:
        return None
    try:
        event = getattr(contract.events, event_name)
    except Exception:
        return None
    for log in receipt.get("logs", []) or []:
        try:
            parsed = event().process_log(log)
            return int(parsed["args"][arg_name])
        except Exception:
            continue
    return None


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
        """Removed in v0.1.2: `getAgentScore` was dormant v2 ABI that reverts
        against the deployed v1 contracts. Use `get_self_attest_score`."""
        raise NotImplementedError(
            "get_agent_score was removed in v0.1.2 (dormant v2 ABI). Use get_self_attest_score()."
        )

    def get_self_attest_score(self, agent: str) -> SelfAttestScore:
        r = self.contract.functions.getSelfAttestScore(agent).call()
        return SelfAttestScore(completions=r[0], disputes=r[1], score=r[2])

    def get_two_sided_score(self, agent: str) -> TwoSidedScore:
        """v0.2: score based on receipt-confirmed completions (prefer for ranking)."""
        r = self.contract.functions.getTwoSidedScore(agent).call()
        return TwoSidedScore(confirmed=r[0], disputes=r[1], score=r[2], last_activity=r[3], decay_bps=r[4])

    def get_ranking_score(self, agent: str) -> tuple[int, int, int, str]:
        """v0.2: two-sided score where the contract supports it, else self-attest.
        Returns (score, count, disputes, score_type)."""
        try:
            s = self.get_two_sided_score(agent)
            return s.score, s.confirmed, s.disputes, "two-sided"
        except Exception:
            s = self.get_self_attest_score(agent)
            return s.score, s.completions, s.disputes, "self-attest"

    def get_completion(self, completion_id: int) -> Completion:
        r = self.contract.functions.getCompletion(completion_id).call()
        return Completion(
            agent=r[0], task_type=r[1], result_cid=r[2], timestamp=r[3],
            challenged=r[4], disputed=r[5],
            counterparty=r[6] if len(r) > 6 else "0x0000000000000000000000000000000000000000",
            receipt_timestamp=r[7] if len(r) > 7 else 0,
        )

    def completion_count(self, agent: str) -> int:
        return self.contract.functions.completionCount(agent).call()

    def confirmed_count(self, agent: str) -> int:
        """v0.2: number of receipt-confirmed completions."""
        return self.contract.functions.confirmedCount(agent).call()

    def receipt_cid(self, completion_id: int) -> str:
        """v0.2: the requester's receipt evidence CID (empty if none)."""
        return self.contract.functions.receiptCID(completion_id).call()

    def challenge_bond(self) -> int:
        return self.contract.functions.CHALLENGE_BOND().call()

    def challenge_window(self) -> int:
        """v0.2: seconds the agent has to contest a challenge."""
        return self.contract.functions.CHALLENGE_WINDOW().call()

    def _send_tx(self, tx):
        if self.account is None:
            raise ValueError("No account set — cannot send transactions")
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        return self.w3.eth.wait_for_transaction_receipt(tx_hash)

    # Basic agent identity (Step 7)
    def last_activity(self, agent: str) -> int:
        return self.contract.functions.lastActivity(agent).call()

    def agent_metadata_cid(self, agent: str) -> str:
        return self.contract.functions.agentMetadataCID(agent).call()

    def register_agent(self, metadata_cid: str) -> dict:
        if self.account is None:
            raise ValueError("No account set")
        fn = self.contract.functions.registerAgent(metadata_cid)
        tx = fn.build_transaction({
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "gas": 100_000,
            "gasPrice": self.w3.eth.gas_price,
            "chainId": self.w3.eth.chain_id,
        })
        receipt = self._send_tx(tx)
        return {"receipt": receipt}

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
        # v0.1.2: read the id from the emitted event (concurrency-safe).
        completion_id = _event_id_from_receipt(self.contract, receipt, "SelfAttested", "completionId")
        if completion_id is None:
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

    # --- v0.2: two-sided attestation + optimistic challenge window ---

    def attest_receipt(self, completion_id: int, receipt_cid: str) -> dict:
        """Counterparty countersigns a completion (turns a self-report two-sided)."""
        fn = self.contract.functions.attestReceipt(completion_id, receipt_cid)
        tx = fn.build_transaction({
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "gas": 200_000,
            "gasPrice": self.w3.eth.gas_price,
            "chainId": self.w3.eth.chain_id,
        })
        return self._send_tx(tx)

    def revoke_receipt(self, completion_id: int) -> dict:
        """Counterparty withdraws a receipt."""
        fn = self.contract.functions.revokeReceipt(completion_id)
        tx = fn.build_transaction({
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "gas": 200_000,
            "gasPrice": self.w3.eth.gas_price,
            "chainId": self.w3.eth.chain_id,
        })
        return self._send_tx(tx)

    def contest_challenge(self, completion_id: int, rebuttal_cid: str) -> dict:
        """The agent rebuts a challenge within the challenge window."""
        fn = self.contract.functions.contestChallenge(completion_id, rebuttal_cid)
        tx = fn.build_transaction({
            "from": self.account.address,
            "nonce": self.w3.eth.get_transaction_count(self.account.address),
            "gas": 200_000,
            "gasPrice": self.w3.eth.gas_price,
            "chainId": self.w3.eth.chain_id,
        })
        return self._send_tx(tx)

    def finalize_challenge(self, completion_id: int) -> dict:
        """Anyone finalizes an uncontested challenge after the window (upheld)."""
        fn = self.contract.functions.finalizeChallenge(completion_id)
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

    def get_capabilities_by_type(self, capability_type: str) -> list[int]:
        """v0.1.2: indexed lookup (O(1) per type) instead of a full scan."""
        return list(self.contract.functions.getCapabilitiesByType(_keccak(capability_type)).call())

    def count_capabilities_by_type(self, capability_type: str) -> int:
        """F10: number of live capabilities of a type."""
        return self.contract.functions.countCapabilitiesByType(_keccak(capability_type)).call()

    def get_capabilities_by_type_paged(self, capability_type: str, offset: int, limit: int) -> list[int]:
        """F10: paginated discovery view (v0.2 contracts)."""
        return list(
            self.contract.functions.getCapabilitiesByTypePaged(_keccak(capability_type), offset, limit).call()
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
        # v0.1.2: derive the id from the emitted event. totalSupply() returns the
        # wrong id once any capability has been withdrawn (burn decrements supply,
        # ids keep incrementing).
        capability_id = _event_id_from_receipt(self.contract, receipt, "CapabilityRegistered", "capabilityId")
        if capability_id is None:
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
    """Discover agents by capability proof + self-attest score. Mirrors /api/discover.

    v0.1.2: uses the indexed getCapabilitiesByType lookup and skips stale ids
    instead of failing the whole call when one id no longer resolves."""
    try:
        ids = registry.get_capabilities_by_type(capability_type)
    except Exception:
        total = registry.total_supply()
        ids = [registry.token_by_index(i) for i in range(total)]

    results = []
    for cap_id in ids:
        try:
            cap = registry.get_capability(cap_id)
        except Exception:
            continue  # stale/unreadable id — skip, never fail the whole discovery
        if not cap.certified or cap.slashed:
            continue
        # v0.2: rank on the receipt-confirmed (two-sided) score where supported.
        score, count, disputes, score_type = ron.get_ranking_score(cap.creator)
        if score < min_score:
            continue
        results.append({
            "agentAddress": cap.creator,
            "capabilityId": cap_id,
            "capabilityType": capability_type,
            "certified": cap.certified,
            "slashed": cap.slashed,
            "bond": cap.bond,
            "metadataCID": cap.metadata_cid,
            "completions": count,
            "disputes": disputes,
            "score": score,
            "scoreType": score_type,
        })
    results.sort(key=lambda x: x["score"], reverse=True)
    return results
