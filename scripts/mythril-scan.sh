#!/usr/bin/env bash
# Mythril symbolic analysis on the deployed runtime bytecode of both contracts.
#
#   bash scripts/mythril-scan.sh [output-dir]
#
# Prefers a local `myth` (Python 3.12 with setuptools<81 so pkg_resources is
# available), otherwise falls back to the digest-pinned Docker image so CI and
# offline machines produce the same result. Report-only by design: Mythril has a
# known compiler-generated false positive on ReputationOracleNetwork (triaged in
# docs/SELF-AUDIT.md), so findings are recorded, not enforced.
set -euo pipefail

OUT="${1:-artifacts/mythril}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f artifacts/contracts/ReputationOracleNetwork.sol/ReputationOracleNetwork.json ]]; then
  echo "artifacts missing — run: npm run contracts:build" >&2
  exit 2
fi

mkdir -p "$OUT" artifacts/mythril/bytecode

# Runtime (deployed) bytecode only: no solc download, and it is exactly what
# executes on-chain.
node -e '
const fs = require("fs");
for (const name of ["ReputationOracleNetwork", "CapabilityRegistry"]) {
  const artifact = JSON.parse(fs.readFileSync(`artifacts/contracts/${name}.sol/${name}.json`, "utf8"));
  fs.writeFileSync(`artifacts/mythril/bytecode/${name}.runtime.hex`, artifact.deployedBytecode.replace(/^0x/, ""));
}
'

# Pinned by digest so a rebuilt :latest tag cannot change the analysis.
DEFAULT_IMAGE="mythril/myth@sha256:49e11758e359d0b410f648df5bbcba28a52e091a78e4772b5c02b9043666b4ff"
IMAGE="${MYTHRIL_IMAGE:-$DEFAULT_IMAGE}"
TIMEOUT="${MYTHRIL_TIMEOUT:-300}"

for name in ReputationOracleNetwork CapabilityRegistry; do
  hex="artifacts/mythril/bytecode/${name}.runtime.hex"
  report="$OUT/${name}.txt"
  echo "=== Mythril: ${name} ==="
  if command -v myth >/dev/null 2>&1; then
    myth analyze -f "$ROOT/$hex" --bin-runtime --execution-timeout "$TIMEOUT" >"$report" 2>&1 || true
  else
    docker run --rm -v "$ROOT:/src" -w /src "$IMAGE" \
      analyze -f "/src/$hex" --bin-runtime --execution-timeout "$TIMEOUT" >"$report" 2>&1 || true
  fi
  if grep -q "No issues were detected" "$report"; then
    echo "  no issues detected"
  elif grep -q "==== " "$report"; then
    grep -E "^(====|SWC ID|Severity|Function name|PC address)" "$report" | sed 's/^/  /'
  else
    echo "  see $report"
  fi
done

echo "reports written to $OUT/"
