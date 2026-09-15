# Phase 0 — Owner Actions (what you must do, and what you must give me)

Companion to `NEXT_BEST_STEPS_2026-09.md` §7 Phase 0 and `SECURITY.md`.
Everything in **Part 1** is already done (verified). **Part 2** needs you, because
it involves credentials, funds, or publishing history. **Part 3** is the exact list
of things to tell me.

> **STATUS — Phase 0 closed 2026-09-15.** The Phase 0 changes are committed; the
> history rewrite and force-push have been run and verified; the Pinata/Replicate
> tokens were rotated by the maintainer; no sweep was performed (the compromised
> testnet agent is retired). The only remaining item is outside our control:
> GitHub still serves the pre-purge blob by SHA and needs a Support GC request
> (`SECURITY.md` §3.7). The steps below are retained as a record.

---

## Part 1 — Done in this session (no action needed)

| # | Change | Evidence |
|---|---|---|
| 1 | `deployments.json`, `taop.db*`, `typechain-types/**`, `*.egg-info/**`, `**/__pycache__/**` untracked from git (79 files) and gitignored | `git diff --cached --stat`, `git ls-files` no longer matches |
| 2 | `deployments.json` scrubbed of `agentAPk`; the live agent key moved to `.env` only (`chmod 600`) | `cat deployments.json` (addresses only) |
| 3 | `.gitignore` hardened (`.env`, `*.db*`, `.venv`, `*.egg-info`, `build/`, `*.whl`; keeps `deployments.json.example` + `.env.example`) | `.gitignore` |
| 4 | `deployments.json.example` added (addresses only, publishable) | file exists |
| 5 | Deploy script no longer writes or prints private keys — it upserts `AGENT_A_PK` into `.env` (chmod 600) and writes addresses only to JSON | `scripts/deploy-base-sepolia.ts` |
| 6 | SDK `Deployment.agentAPk` marked `@deprecated` (read-only legacy support) | `packages/sdk/src/types.ts` |
| 7 | Backend reads keys from env first, warns on legacy `deployments.json` keys, fails clearly if no key is found | `packages/backend/src/contracts.ts` |
| 8 | Backend write routes gated: constant-time `X-TAOP-Key` check, 240 req/min + 20 writes/5 min rate limits, `DEMO_READ_ONLY` kill-switch, **refuses to bind a non-loopback HOST without a key**, startup security banner | `packages/backend/src/server.ts` |
| 9 | Demo UI can send the key (`VITE_TAOP_API_KEY`) | `apps/demo/src/api.ts` |
| 10 | `.env.example` documents `HOST`, `TAOP_API_KEY`, `VITE_TAOP_API_KEY`, `DEMO_READ_ONLY`, `TRUST_PROXY`, `CORS_ORIGIN`, `RPC_URL` | `.env.example` |
| 11 | README: tunnel section warns "read-only only"; Security + Operations sections rewritten (stale "rate limiting enabled" claim fixed) | `README.md` |
| 12 | `SECURITY.md` written (disclosure policy, secrets policy, incident history, ops rules, trust assumptions) | file exists |
| 13 | History-purge tooling added and **tested end-to-end on a scratch clone** (3 verification checks pass, bundle backup, local-file restore) | `scripts/purge-secrets-from-history.sh` |
| 14 | Re-verified after the changes: 23/23 contract tests, demo build, backend bundle build; type errors still only the 4 pre-existing ones | Part 4 |

Nothing in this set touches Solidity, so contract behaviour is unchanged.

Everything in this set was committed as `aee46e9` (and follow-ups). It does not
touch Solidity, so contract behaviour is unchanged. The history-purge script
requires a clean worktree — that is satisfied, and the purge has since been run
(Part 2.2).

---
## Part 2 — Your actions (exact steps)

### 2.1 Rotate the credentials that were in `.env` (`PINATA_JWT`, `REPLICATE_API_TOKEN`)

> ✅ **Done 2026-09-15** (maintainer). Steps retained for reference.

Never committed, but rotate them as hygiene. ~5 minutes each.

**Pinata**
1. https://app.pinata.cloud/developers/api-keys
2. Revoke the old key (`0b00a8f3…` scoped key — the one the current JWT uses).
3. Create a new key with only `pinFileToIPFS` + `pinJSONToIPFS`.
4. Update `.env`:
   ```bash
   cd /Users/a/Documents/cline-desktop/credit-bureau/new-credit-bureau
   $EDITOR .env        # new JWT into PINATA_JWT=, new key into PINATA_API_KEY=
   chmod 600 .env
   ```
5. Verify: start the backend, `POST /api/demo/run` — no "PINATA_JWT not set"
   warning and a fresh `ipfs://…` CID (spends ~0.01 ETH of testnet gas).

**Replicate**
1. https://replicate.com/account/api-tokens → delete old, create new.
2. Update `REPLICATE_API_TOKEN=` in `.env`.
3. Optional: the backend falls back to a local extractive summarizer if the token is
   missing/invalid, so the demo works either way.

> Never paste these values into this chat, an issue, or a screenshot. Put them in
> `.env` and tell me only "rotated".

### 2.2 Purge the leaked key from git history, then force-push

> ✅ **Done 2026-09-15.** History was rewritten and force-pushed; local and remote
> `main` are clean. Note the pre-purge backup bundles on disk still contain the
> old key material — keep them out of Git and delete once you no longer need them.
> Residual: GitHub still serves old commit `6a60a618` by SHA (see `SECURITY.md`
> §3.7) — request a Support GC.

The script is already tested. It rewrites history so `deployments.json` never
existed, backs everything up to a bundle outside the repo, and keeps your local
(now key-free) `deployments.json` on disk.

```bash
cd /Users/a/Documents/cline-desktop/credit-bureau/new-credit-bureau
# Requires: brew install git-filter-repo   (already installed on this machine)

# 1. Commit the Phase 0 changes first — the script requires a clean worktree
git status --short
git add -A
git commit -m "security(phase0): untrack key material, gate backend writes, harden gitignore"

# 2. Rewrite history (local, reversible, with backups)
scripts/purge-secrets-from-history.sh

# 3. Sanity-check, then publish the rewrite
git log --oneline | head -5
npm run contracts:test                   # expect 23 passing
git push --force-with-lease origin main  # add --force if the lease check complains
```

- **I can run steps 2–3 for you** — say "run the purge". The `git push` needs your
  GitHub credentials, so run it yourself or explicitly ask me to do it here.
- Backup bundle: `../taop-pre-purge-<timestamp>.bundle` →
  restore with `git clone ../taop-pre-purge-<stamp>.bundle taop-restored`.
- Force-push rewrites public history. There are 0 forks and no collaborators, so the
  blast radius is your own clones — elsewhere run
  `git fetch --all && git reset --hard origin/main`.
- GitHub may cache old commits, so treat the key as burned regardless.

### 2.3 Decide about the compromised demo agent (~0.01 testnet ETH)

> ✅ **Decided 2026-09-15: do nothing** (testnet-only; key retired at the v0.1.2
> redeploy). No sweep performed.

`0xD921D63e5d97AEe05Ffc5cccB0162589422DF2bE` holds ~0.00999 ETH and its private key
is public.

- **Do nothing** (recommended): testnet-only; the key is retired at the v0.1.2 redeploy.
- **Sweep now**: I can send the remaining ETH to a wallet you control — only on your
  explicit "yes, sweep it to 0x…", since it moves funds.

### 2.4 Fund the new agent after the v0.1.2 redeploy (Phase 2)

`npm run deploy:sepolia` auto-generates a fresh Agent A, funds it from the deployer and
writes `AGENT_A_PK` to `.env`. Top up the deployer first if needed
(currently ~0.0014 ETH at `0x37374FD4f27c2b46Fd5d1a9BAFdc709315E51120`):

- https://portal.cdp.coinbase.com/products/faucet (0.1 ETH/24h)
- https://www.alchemy.com/faucets/base-sepolia
- https://thirdweb.com/base-sepolia-testnet

### 2.5 GitHub repo hygiene (5 minutes, big discoverability win)

`github.com/lexagor/TAOP-protocol` → Settings:
- **Description:** `On-chain reputation (Credit Bureau) + capability registry (LoRA guilds) for AI agents, with an MCP server and TS/Python SDKs. Base Sepolia pilot.`
- **Topics:** `ai-agents`, `agent-reputation`, `base`, `ethereum`, `mcp`, `lora`, `reputation`, `solidity`, `web3`
- Enable **Private vulnerability reporting** (Security tab) so `SECURITY.md` §1 works.
- Optional: enable Dependabot alerts.

---
## Part 3 — What to give me (and what never to give me)

**Never paste into chat:** private keys (`DEPLOYER_PK`, `AGENT_A_PK`), the
`PINATA_JWT`/API secret, the Replicate token, or your GitHub token. I do not need
any of them.

**What I do need from you:**

| # | Tell me / give me | Why |
|---|---|---|
| 1 | "Run the purge" (or confirm you ran it) | I rewrite local history; you run the `git push` |
| 2 | "Rotated Pinata/Replicate" | Closes Phase 0 item 0.4 |
| 3 | Sweep decision: "do nothing" or "sweep it to 0x…" | §2.3 |
| 4 | Any `0x…` address to fund or fund from | Phase 2 redeploy |
| 5 | Public demo mode: `DEMO_READ_ONLY=true` (safe) or `TAOP_API_KEY` (interactive) | Decides the hosting setup I prepare |
| 6 | Hosting choice (Fly.io / Render / Vercel / none) | Phase 2 item 7 |
| 7 | Answers to the 5 open questions in `NEXT_BEST_STEPS_2026-09.md` §9 (redeploy now vs batch, 0-delay freeze, audit budget, rotate agent address vs key only, demo hosting) | Unblocks Phase 2/3 |
| 8 | Confirmation that rotations are done (values stay in `.env`) | I re-run the smoke test |

If you want me to do something **destructive** (history rewrite, force push, move
funds, revoke keys via API), say so per action — otherwise I only make reversible
local changes.

---

## Part 4 — How to verify (run these yourself)

```bash
cd /Users/a/Documents/cline-desktop/credit-bureau/new-credit-bureau

# 1. No key material is tracked
git ls-files | grep -E 'deployments\.json$|taop\.db|typechain-types|egg-info|__pycache__'  # expect: nothing
cat deployments.json                                     # expect: addresses only, no agentAPk
git check-ignore -v deployments.json .env taop.db         # expect: matched by .gitignore
ls -l .env                                                # expect: -rw------- (600)

# 2. Deploy path is key-free
grep -n 'agentAPk' scripts/deploy-base-sepolia.ts         # expect: no occurrence

# 3. Backend refuses unsafe exposure (public bind, no key)
HOST=0.0.0.0 npm run backend:dev; echo "exit=$?"          # expect: REFUSING TO START, exit=1

# 4. Write gate + read-only mode
DEMO_READ_ONLY=true npm run backend:dev &
curl -s localhost:4000/api/healthz                        # expect: {"ok":true}   (reads still work)
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{}' localhost:4000/api/completions/999999/challenge  # expect: 503
# Ctrl-C, then with a key:
TAOP_API_KEY=test-key-abc123 npm run backend:dev &
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{}' localhost:4000/api/completions/999999/challenge              # expect: 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -H 'X-TAOP-Key: test-key-abc123' -d '{}' \
  localhost:4000/api/completions/999999/challenge                      # expect: 400 (pre-check; no spend)

# 5. Nothing else broke
npm run contracts:test     # 23 passing
npm run demo:build         # builds
npm run backend:build      # builds

# 6. After the history purge
git log --all --oneline -- deployments.json | wc -l        # expect: 0
```

**Rollback:** before the force-push, everything is reversible via
`git reset --hard <old-sha>` (printed by the script) or by cloning the backup
bundle. After a force-push, reset to the backup bundle's commit and force-push again.

---

## Verified evidence from this session (auth matrix, live server)

| Case | `GET /healthz` | `GET /discover` | `POST` no key | `POST` wrong key | `POST` correct key |
|---|---|---|---|---|---|
| loopback, no key (dev default) | 200 | 200 | 400 (pre-check, no spend) | 400 | 400 |
| loopback + `TAOP_API_KEY` | 200 | 200 | **401** | **401** | 400 (reaches handler) |
| loopback + `DEMO_READ_ONLY=true` | 200 | 200 | **503** | 503 | 503 |
| `HOST=0.0.0.0`, no key | server **refuses to start** (`exit 1`) | — | — | — | — |

`POST` to a non-existent completion is used deliberately: it exercises the full
middleware chain (rate limit → auth → handler pre-check) and returns 400 with
`{"error":"No such completion. Run the live demo first."}` without spending ETH.
