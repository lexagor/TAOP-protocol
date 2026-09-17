#!/usr/bin/env python3
"""Verify a built wheel is publishable: it must ship the bundled ABIs (loaded at
import time by `taop/abis.py`) and must not bundle tests.

    python check_wheel.py dist/*.whl
"""
import sys
import zipfile
from pathlib import Path


def main() -> int:
    wheels = [Path(p) for p in sys.argv[1:]] or list(Path("dist").glob("*.whl"))
    if not wheels:
        print("no wheel found", file=sys.stderr)
        return 1
    failures = 0
    for wheel in wheels:
        names = zipfile.ZipFile(wheel).namelist()
        checks = {
            "ships ron_abi.json": any(n.endswith("ron_abi.json") for n in names),
            "ships reg_abi.json": any(n.endswith("reg_abi.json") for n in names),
            "does not bundle tests": not any(n.startswith("tests/") for n in names),
        }
        for label, ok in checks.items():
            print(f"{'PASS' if ok else 'FAIL'} {wheel.name}: {label}")
            if not ok:
                failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
