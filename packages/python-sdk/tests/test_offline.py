"""Offline unit tests for the TAOP Python SDK.

These do not touch the network, so they run in CI (unlike the `network`-marked
suite in test_sdk.py). They cover the pure logic: deployment loading, rating
helpers, event-id parsing, and `discover()`'s ranking + stale-id resilience.
"""
import json
from pathlib import Path

import pytest

from taop import discover, LORA_CAPABILITY_TYPE
from taop.clients import _event_id_from_receipt, _load_deployment
from taop.types import Capability, TwoSidedScore, stars_to_rating, rating_to_stars


def test_stars_rating_round_trip():
    for stars in (1, 2, 3, 4, 5):
        assert rating_to_stars(stars_to_rating(stars)) == pytest.approx(stars, abs=0.02)
    # clamps out-of-range input
    assert stars_to_rating(0) == stars_to_rating(1)
    assert stars_to_rating(9) == stars_to_rating(5)


def test_two_sided_score_dataclass():
    s = TwoSidedScore(confirmed=2, disputes=1, score=1, last_activity=123, decay_bps=10000)
    assert s.confirmed == 2 and s.score == 1 and s.decay_bps == 10000


def test_load_deployment_defaults_token(tmp_path: Path):
    path = tmp_path / "deployments.json"
    path.write_text(json.dumps({
        "chainId": 31337, "ron": "0xRON", "registry": "0xREG",
        "validator": "0xVAL", "agentA": "0xAGENT",
    }))
    dep = _load_deployment(path)
    assert dep.chain_id == 31337
    assert dep.ron == "0xRON" and dep.registry == "0xREG"
    # `token` is optional and defaults to the zero address (live files omit it)
    assert dep.token == "0x0000000000000000000000000000000000000000"


def test_event_id_from_receipt_reads_named_arg():
    class _Ev:
        def __call__(self):
            return self

        def process_log(self, _log):
            return {"args": {"completionId": 5}}

    class _Events:
        def __getattr__(self, _name):
            return _Ev()

    class _Contract:
        events = _Events()

    assert _event_id_from_receipt(_Contract(), {"logs": [{}]}, "SelfAttested", "completionId") == 5
    assert _event_id_from_receipt(_Contract(), None, "SelfAttested", "completionId") is None


class _FakeRegistry:
    """Duck-typed registry: id 2 is stale (raises), the rest are certified."""

    def __init__(self, caps):
        self._caps = caps

    def get_capabilities_by_type(self, _t):
        return list(self._caps.keys())

    def get_capability(self, cid):
        cap = self._caps.get(cid)
        if cap is None:
            raise ValueError("NoSuchCapability")
        return cap

    def total_supply(self):
        return len(self._caps)

    def token_by_index(self, i):
        return list(self._caps.keys())[i]


class _FakeRon:
    def __init__(self, scores):
        self._scores = scores  # agent -> (score, count, disputes, type)

    def get_ranking_score(self, agent):
        return self._scores[agent]


def _cap(creator, certified=True, slashed=False, bond=10**16):
    return Capability(creator=creator, bond=bond, capability_type=b"", metadata_cid="ipfs://m",
                      certified=certified, slashed=slashed)


def test_discover_ranks_and_skips_stale_ids():
    caps = {
        1: _cap("0xA"),
        2: None,  # stale/unreadable -> must be skipped, not crash the call
        3: _cap("0xB", certified=False),  # uncertified -> filtered
        4: _cap("0xC", slashed=True),  # slashed -> filtered
    }
    registry = _FakeRegistry(caps)
    ron = _FakeRon({"0xA": (2, 2, 0, "two-sided")})

    results = discover(registry, ron, LORA_CAPABILITY_TYPE, min_score=0)
    assert len(results) == 1
    top = results[0]
    assert top["agentAddress"] == "0xA"
    assert top["score"] == 2
    assert top["scoreType"] == "two-sided"


def test_discover_min_score_filter():
    registry = _FakeRegistry({1: _cap("0xA")})
    ron = _FakeRon({"0xA": (1, 1, 0, "self-attest")})
    assert discover(registry, ron, LORA_CAPABILITY_TYPE, min_score=0)
    assert discover(registry, ron, LORA_CAPABILITY_TYPE, min_score=5) == []
