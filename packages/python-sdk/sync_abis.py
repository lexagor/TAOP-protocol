#!/usr/bin/env python3
"""Regenerate the Python SDK's bundled ABIs from the current Hardhat artifacts.

The SDK is intentionally self-contained (no hardhat coupling at runtime), so the
JSON blobs must be refreshed whenever the contracts change:

    cd packages/python-sdk
    python3 sync_abis.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "artifacts" / "contracts"
OUT = Path(__file__).resolve().parent / "taop"

CONTRACTS = {
    "ReputationOracleNetwork": OUT / "ron_abi.json",
    "CapabilityRegistry": OUT / "reg_abi.json",
}


def artifact_abi(name: str):
    path = ARTIFACTS / f"{name}.sol" / f"{name}.json"
    data = json.loads(path.read_text())
    abi = data["abi"]
    assert any(e.get("name") == "getSelfAttestScore" for e in abi) or name == "CapabilityRegistry", path
    return abi


def main() -> None:
    for name, out_path in CONTRACTS.items():
        abi = artifact_abi(name)
        out_path.write_text(json.dumps(abi, indent=2) + "\n")
        fns = sorted(e.get("name", "?") for e in abi if e.get("type") == "function")
        print(f"wrote {out_path.relative_to(ROOT)} ({len(abi)} entries): {', '.join(fns[:8])}…")


if __name__ == "__main__":
    main()
