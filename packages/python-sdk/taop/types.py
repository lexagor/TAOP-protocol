"""Type definitions for the TAOP SDK."""

from dataclasses import dataclass
from typing import NewType

LORA_CAPABILITY_TYPE = "LoRA"

# keccak256("LoRA") — computed at import time by clients via web3.keccak


@dataclass
class Deployment:
    chain_id: int
    token: str
    ron: str
    registry: str
    validator: str
    agent_a: str
    agent_pk: str = ""
    validator_stake: str = "0"
    network: str = ""
    deployed_at: str = ""


@dataclass
class AgentScore:
    total_score: int
    count: int
    last_updated: int


@dataclass
class Capability:
    creator: str
    bond: int
    capability_type: bytes
    metadata_cid: str
    certified: bool
    slashed: bool


@dataclass
class Completion:
    agent: str
    task_type: bytes
    result_cid: str
    timestamp: int
    challenged: bool
    disputed: bool


@dataclass
class SelfAttestScore:
    completions: int
    disputes: int
    score: int


@dataclass
class ScoreSubmission:
    agent: str
    task_id: int
    rating: int
    evidence_cid: str


def stars_to_rating(stars: float) -> int:
    """Map 1-5 stars to 0-255 rating."""
    stars = max(1, min(5, stars))
    return round((stars / 5) * 255)


def rating_to_stars(rating: int) -> float:
    """Map 0-255 rating to 1-5 stars."""
    return (rating / 255) * 5
