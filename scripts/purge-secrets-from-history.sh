#!/usr/bin/env bash
#
# Phase 0 / finding F1 — purge secret-bearing paths from git history.
#
# The public repo has `deployments.json` committed in 8 commits containing a
# live Agent A private key (see SECURITY.md §3), plus committed SQLite state.
# This script rewrites history so those paths never existed.
#
# Removed from every commit: deployments.json, taop.db, taop.db-shm, taop.db-wal
# (the files stay on disk — they are gitignored and still used at runtime).
#
# Requires: git-filter-repo  (brew install git-filter-repo)
#
# Usage:
#   scripts/purge-secrets-from-history.sh      # rewrite locally, with backups
#   scripts/purge-secrets-from-history.sh --secrets-file /tmp/leaked-keys.txt
#       also scrubs literal secret strings from blob *contents* (see below)
#   git push --force --tags origin main        # publish (NOTE: --tags is required!)
#
# --secrets-file format (one per line, git-filter-repo "replace-text" syntax):
#   literal:<secret>==>***REMOVED***
# Keep that file OUTSIDE the repo (e.g. /tmp) — committing it would defeat the
# purpose. Generate it from the pre-purge bundle, never from a tracked file.
#
# NOTE: rewriting `main` is not enough if remote tags still point at old commits
# (a tag can keep the leaked blob reachable on GitHub), hence the `--tags` push.
#
# Backups: a full `--all` bundle is written OUTSIDE the repo before rewriting:
#   ../taop-pre-purge-<timestamp>.bundle
#   restore with: git clone ../taop-pre-purge-<stamp>.bundle taop-restored
#
# History rewriting is irreversible for anyone who has cloned the old history.
# Review `git log --oneline` after the rewrite and re-run the repo's test suite.
set -euo pipefail

SECRETS_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --secrets-file) SECRETS_FILE="${2:-}"; shift 2 ;;
    *) echo "ERROR: unknown argument '$1' (supported: --secrets-file <path>)" >&2; exit 2 ;;
  esac
done
if [ -n "$SECRETS_FILE" ] && [ ! -f "$SECRETS_FILE" ]; then
  echo "ERROR: --secrets-file '$SECRETS_FILE' not found" >&2
  exit 2
fi

PATHS=(deployments.json taop.db taop.db-shm taop.db-wal)

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "ERROR: git-filter-repo not found. Install it with: brew install git-filter-repo" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: worktree is not clean — commit or stash your changes first:" >&2
  git status --short >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BUNDLE="$REPO_ROOT/../taop-pre-purge-$STAMP.bundle"
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
ORIGINAL_HEAD="$(git rev-parse HEAD)"

echo "==> Backing up all refs to $BUNDLE"
git bundle create "$BUNDLE" --all >/dev/null
echo "    original HEAD: $ORIGINAL_HEAD"

# Local runtime files must survive the rewrite: filter-repo checks out the
# rewritten history, which deletes these paths from the working tree.
STASH="$REPO_ROOT/../taop-pre-purge-$STAMP.files"
mkdir -p "$STASH"
for p in "${PATHS[@]}"; do
  [ -f "$p" ] && cp -p "$p" "$STASH/$(basename "$p")" || true
done
echo "    stashed local copies in $STASH"

ARGS=()
for p in "${PATHS[@]}"; do ARGS+=(--path "$p"); done
if [ -n "$SECRETS_FILE" ]; then
  echo "==> Also scrubbing literal secrets from blob contents ($(wc -l < "$SECRETS_FILE" | tr -d ' ') expressions)"
  ARGS+=(--replace-text "$SECRETS_FILE")
fi

echo "==> Rewriting history (removing: ${PATHS[*]})"
git filter-repo --force --invert-paths "${ARGS[@]}"

# filter-repo intentionally drops the origin remote; restore it.
if [ -n "$ORIGIN_URL" ] && ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "$ORIGIN_URL"
  echo "==> Restored origin remote: $ORIGIN_URL"
fi

# Drop any pre-rewrite backup refs and expire reflogs *before* verifying, so the
# verification actually reflects what a fresh clone would receive. Without this,
# stale refs can keep the leaked blobs reachable and even pushable.
git for-each-ref --format='%(refname)' refs/original 2>/dev/null | while read -r r; do
  git update-ref -d "$r" && echo "==> Removed stale backup ref $r"
done
git reflog expire --expire=now --all >/dev/null 2>&1 || true
git gc --prune=now >/dev/null 2>&1 || true

echo "==> Verifying purge"
FAIL=0

# 1. The removed paths must not exist in any commit.
if [ -n "$(git log --all --oneline -- "${PATHS[@]}")" ]; then
  echo "    ✗ paths still present in history" >&2
  FAIL=1
else
  echo "    ✓ ${PATHS[*]} removed from all commits"
fi

# 1b. No reachable object may carry those exact paths (anchored match — note that
#     `deployments.json.example` is expected to exist and must not trip this).
PATH_RE="(^| )($(printf '%s|' "${PATHS[@]}" | sed 's/|$//'))\$"
if [ -n "$(git rev-list --all --objects | grep -E "$PATH_RE" || true)" ]; then
  echo "    ✗ objects for removed paths still reachable:" >&2
  git rev-list --all --objects | grep -E "$PATH_RE" | head -5 >&2
  FAIL=1
else
  echo "    ✓ no reachable objects for those paths"
fi

# 2. No private-key-shaped value may remain anywhere in reachable history.
#    (Matches `agentAPk": "0x<64 hex>"`, `PRIVATE_KEY=0x<64 hex>`, etc.
#     Plain mentions of the field name in source code are fine and expected.)
PK_RE='(agentAPk|PRIVATE_KEY|DEPLOYER_PK|AGENT_A_PK|privateKey)"?[[:space:]]*[:=][[:space:]]*"?0x[0-9a-fA-F]{64}'
COMMIT_COUNT="$(git rev-list --all --count)"
if [ "$COMMIT_COUNT" -gt 2000 ]; then
  echo "    ! $COMMIT_COUNT commits — deep blob scan skipped (rely on step 1 + rotation)"
  PK_HITS=""
else
  # `|| true` guards matter: `git grep` exits 1 when a commit has no match and
  # `set -e`/`pipefail` would otherwise abort the script here.
  PK_HITS="$(git rev-list --all | while read -r c; do git grep -nE "$PK_RE" "$c" -- . 2>/dev/null || true; done | sort -u || true)"
fi
if [ -n "$PK_HITS" ]; then
  echo "    ✗ key material still present in history:" >&2
  echo "$PK_HITS" | head -20 >&2
  FAIL=1
else
  echo "    ✓ no private-key-shaped values in history"
fi

if [ "$FAIL" -ne 0 ]; then
  echo "!! Verification failed — restore from $BUNDLE before pushing anything." >&2
  exit 1
fi

# Restore the local runtime copies that the rewrite removed from the worktree.
# They are gitignored, so the worktree stays clean.
RESTORED=()
for p in "${PATHS[@]}"; do
  if [ ! -f "$p" ] && [ -f "$STASH/$(basename "$p")" ]; then
    cp -p "$STASH/$(basename "$p")" "$p"
    RESTORED+=("$p")
  fi
done
if [ "${#RESTORED[@]}" -gt 0 ]; then
  echo "==> Restored local (gitignored) files: ${RESTORED[*]}"
fi
if [ -f deployments.json ] && grep -q 'agentAPk' deployments.json; then
  echo "    ! deployments.json still contains 'agentAPk' — remove it (keys belong in .env only)" >&2
fi

cat <<EOF

==> Done. History is rewritten locally.

Next steps (manual, requires write access to the repo):

  # 1. Sanity-check the rewritten history, then re-run the test suite:
  git log --oneline
  npm run contracts:test

  # 2. Publish the rewrite. --tags matters: remote tags can keep the old
  #    (leaking) commits reachable on GitHub even after main is rewritten.
  git push --force --tags origin main
  #    or, if you prefer a lease check first:
  #    git push --force-with-lease origin main && git push --force --tags origin

  # 3. Verify the remote is clean:
  #    git ls-remote --tags origin            # no tag should point at an old sha
  #    curl -sI https://raw.githubusercontent.com/<owner>/<repo>/<any-old-sha>/deployments.json

  # 4. Assume every key that was in that file is public forever:
  #    - rotate PINATA_JWT / REPLICATE_API_TOKEN
  #    - use a fresh AGENT_A_PK (the next deploy does this automatically)

Backup bundle (keep until you are happy): $BUNDLE
EOF
