"""TAOP — Trustless Agent Orchestration Protocol Python SDK.

Typed contract clients for the ReputationOracleNetwork (Credit Bureau) and
CapabilityRegistry (LoRA Guilds) contracts, mirroring @taopp/sdk (TypeScript).
"""

from .clients import (
    ReputationOracleNetworkClient,
    CapabilityRegistryClient,
    connect,
    load_account,
    discover,
)
from .types import (
    Deployment,
    AgentScore,
    Capability,
    Completion,
    SelfAttestScore,
    TwoSidedScore,
    ScoreSubmission,
    LORA_CAPABILITY_TYPE,
    stars_to_rating,
    rating_to_stars,
)

__version__ = "0.1.0"

__all__ = [
    "ReputationOracleNetworkClient",
    "CapabilityRegistryClient",
    "connect",
    "load_account",
    "discover",
    "Deployment",
    "AgentScore",
    "Capability",
    "Completion",
    "SelfAttestScore",
    "TwoSidedScore",
    "ScoreSubmission",
    "LORA_CAPABILITY_TYPE",
    "stars_to_rating",
    "rating_to_stars",
]
