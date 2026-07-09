"""Contract ABIs for the TAOP MVP (JSON format, generated from Hardhat artifacts)."""

import json
from pathlib import Path

_ABI_DIR = Path(__file__).parent

RON_ABI = json.loads((_ABI_DIR / "ron_abi.json").read_text())
CAPABILITY_REGISTRY_ABI = json.loads((_ABI_DIR / "reg_abi.json").read_text())
