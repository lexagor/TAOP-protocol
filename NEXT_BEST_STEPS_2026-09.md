# TAOP — Deep Research Review & Next Best Steps

**Date:** 2026-09-15
**Scope:** Full review of `new-credit-bureau` (TAOP Agent Credit Bureau + LoRA Guilds) at commit `6a60a61`
**Method:** source read (contracts, backend, SDKs, MCP, demo, scripts, tests, docs), live on-chain probing of Base Sepolia via JSON-RPC, live backend + published-package smoke tests, and two purpose-built diagnostic tests.
**Supersedes:** `NEXT_STEPS.md` (July 2026) where they disagree. `IMPROVEMENTS_PLAN.md` M0–M2 are done and no longer the frontier.

> Everything below is verified, not inferred. Commands to reproduce are in
> §8 "Verification playbook". No product code was changed during this review
> (worktree left clean).

---

## 1. Executive summary

The engineering core is genuinely good: two small, readable contracts, clean
layering (on-chain truth → REST + SQLite cache → typed SDKs → MCP → demo), 23
passing contract tests, a working live pilot, and — unusually — a *published*
MCP server that I verified works end-to-end from npm.

But the project is **not** in the state its own docs describe, and three things
gate everything else:

1. **A private key is published on GitHub.** The public repo has
   `deployments.json` (and `taop.db*`) committed, and that file contains
   `"agentAPk": "0x12a8ae31…"` in plaintext. Combined with an unauthenticated
   backend that (a) spends ETH and (b) executes owner-only actions, and a README
   that tells users to expose it publicly via `cloudflared`, this is an open
   faucet on the pilot's identity and admin rights.
2. **Two proven correctness bugs break the product's core promise.**
   `withdrawBond()` leaves a stale id in the capability-type index, which makes
   *every* discovery implementation throw for the whole capability type; and
   capability ids are derived from `totalSupply()`, so after any burn the SDK
   returns the wrong id — and the backend then *certifies somebody else's*
   capability. Both were reproduced locally in a diagnostic test.
3. **Distribution is at zero**, and the shipped artifacts currently carry the
   bugs above: 0 stars / 0 forks / no description / no topics / no releases, no
   public demo URL, and `@taopp/sdk@0.1.1` on npm ships the wrong-capabilityId
   bug. Re-publishing *after* the fixes is higher leverage than any new feature.

Also verified: score decay has already driven the **only live agent's score from
3 to 0**, so "discover the best LoRA agent" — the flagship demo and the Agent B
example with its documented `min_score=1` — currently returns nothing.

The next best steps are therefore *not* new features. They are, in order:
contain the leak → make the toolchain honest (real typecheck/CI/tests) → fix the
decay and discovery/ID bugs and redeploy → then republish, harden, and only then
grow scope.

---

## 2. Verified health snapshot

| Area | Verified state (2026-09-15) | Evidence |
|---|---|---|
| Repo | own git repo, 17 commits, 154 tracked files, worktree clean, `main` == `origin/main` | `git log`, `git ls-files`, `git status` |
| GitHub | **public**, 0 stars / 0 forks / 0 watchers / 0 issues, no description, no topics, no releases | repo page |
| Contracts (Base Sepolia, 84532) | RON `0x716EB7…CEaA`, Registry `0x613217…2019`, Timelock `0x723184…9539`; owners = Timelock; certifier = deployer | RPC `eth_call` |
| Timelock delay | `getMinDelay() = 0` | RPC |
| Live RON | `nextCompletionId = 3`, `CHALLENGE_BOND = 1e16` (0.01 ETH), `getAgentMetadata()` works ⇒ identity *is* live | RPC |
| Live Registry | `totalSupply = 1`, `getCapabilitiesByType(LoRA) = [1]` | RPC |
| Agent A `0xD921D6…F2bE` | completions 3, disputes 0, **score 0** (decayed) | RPC + `GET /api/discover` |
| Backend (local) | boots, `/api/healthz` ok, `/api/contracts` ok, `/api/discover` returns 1 agent with score 0; warns `Using AGENT_A_PK from deployments.json because it differs from .env` | live run |
| Contract tests | **23 passing** (15 RON + 8 registry) | `npx hardhat test` |
| Python SDK tests | **1 failed, 5 passed** — `test_self_attest_score` asserts `score == completions - disputes`, decay returns 0/3 | `pytest tests/ -q` |
| `npm run typecheck` | **no-op**: root `tsconfig.json` is `files: []` + references, so `tsc --noEmit` compiles 0 files and exits 0 | `tsc --noEmit --listFiles` empty |
| Real type errors | backend 3 (`contracts.ts:260`, `demo.ts:84` ×2), demo 1 (`App.tsx:600`) | per-package `tsc --noEmit` (exit 2) |
| Builds | demo ✓ (310 ms, 225 kB), mcp ✓, sdk ✓, backend (esbuild) ✓ | npm scripts |
| npm | `@taopp/sdk@0.1.1` (2026-07-09), `@taopp/mcp-server@0.1.0` (2026-07-09) | `npm view` |
| MCP via npm | works from a clean cwd with env-only config: `initialize` + 9 tools + `get_deployment_info` all OK | `npx -y @taopp/mcp-server` |
| CI | `typecheck` step is the no-op above; backend typecheck is `\|\| true`; lint step has no linter; no python tests, no coverage, no fork tests | `.github/workflows/ci.yml` |

---

## 3. P0 — Security (contain this before anything else)

### F1. Private key published in the public repo 🔴
`git show HEAD:deployments.json` → the `agentAPk` field held a live Agent A private
key (full value redacted here and scrubbed from history; see `SECURITY.md` §3 for
the affected agent addresses).
`.gitignore` ignores `deployments.json` *now*, but the file is tracked at HEAD and
in history, and the MCP/backend startup path tells users to rely on it.

**Impact:** anyone can drain Agent A's testnet ETH, impersonate the demo agent
(attest, challenge, register identity), and poison the pilot's only reputation record.
**Fix (today):** treat the key as burned. (a) `git rm --cached deployments.json taop.db taop.db-shm taop.db-wal`; (b) purge history with `git filter-repo` (or BFG) and force-push; (c) commit a `deployments.json.example` with **addresses only**; (d) generate a fresh Agent A wallet for the redeploy; (e) rotate `PINATA_JWT` / `REPLICATE_API_TOKEN` if that `.env` was ever shared — both are live credentials.

### F2. Unauthenticated backend that spends money and wields owner rights 🔴
No auth middleware anywhere (`grep -rn auth packages/backend/src` → nothing).
State-changing routes with real consequences:

| Route | Effect |
|---|---|
| `POST /api/demo/run` | runs inference, **pins to IPFS**, sends an on-chain tx |
| `POST /api/completions/:id/challenge` | posts a **0.01 ETH bond** from Agent A's key |
| `POST /api/completions/:id/resolve` | **executes `resolveChallenge` through the Timelock (owner action)** |
| `POST /api/capabilities/register` | spends a bond, mints an NFT |
| `POST /api/agents/register` | writes on-chain identity |

README §Operations says: *"Public shareable demo: use `cloudflared tunnel --url
http://localhost:4000`"*. Anyone who follows that hands a stranger the ability to
adjudicate fraud cases and drain the demo wallet. Also: `express-rate-limit` is
installed but **never used**, while README claims *"Rate limiting enabled in
backend"*.
**Fix:** API-key middleware on all POST routes (`X-TAOP-Key`, constant-time
compare, fail closed), wire `express-rate-limit`, keep the write-enabled server
bound to `127.0.0.1` by default and refuse to start on a public interface without
a key, and split "read-only public demo" from "write-enabled demo" in the docs.

### F3. Leaked local material and tracked generated files 🟠
`.env` (correctly gitignored — verified `git log --all -- .env` is empty) holds
`DEPLOYER_PK`, **two conflicting `AGENT_A_PK` lines** (the second silently wins),
a live `PINATA_JWT`, and `REPLICATE_API_TOKEN`. Tracked junk that churns the tree:
`taop.db`, `taop.db-shm`, `taop.db-wal` (modified by merely running the backend),
`typechain-types/**` (624 kB, modified by any compile), `**/*.egg-info/*`,
`**/__pycache__/*.pyc`.
**Fix:** `git rm -r --cached` those paths + extend `.gitignore`; deduplicate
`AGENT_A_PK`; document that only `deployments.json.example` is public.

---

## 4. P0 — Correctness (proven with a diagnostic test)

### F4. `withdrawBond()` corrupts the discovery index 🔴 (reproduced)
`CapabilityRegistry.withdrawBond` burns the NFT but never removes the id from
`capabilitiesByType[type]`. Diagnostic output:

```
ids before withdraw: 1,2 | totalSupply: 2
ids after withdraw : 1,2 | totalSupply: 1
=> stale id 1 returned by index but getCapability(1) REVERTS
```

**Impact:** *every* discovery implementation calls `getCapability(id)` in an
unguarded loop — backend `/api/discover`, MCP `discover_capabilities`, TS
`discover()`, Python `discover()`. After **one** creator withdraws a bond, all
discovery for that capability type throws, for everyone.
**Fix:** in `withdrawBond`, swap-and-pop the id out of the array; **and**
defensively wrap per-id reads in try/catch on the client side so one bad id can
never nuke a whole result set. Contract change ⇒ redeploy.

### F5. Capability ids are read from `totalSupply()` — wrong after any burn 🔴 (reproduced)
`registerCapabilityEth` returns `_nextTokenId`, but `@taopp/sdk`
(`clients.ts`), the backend (`server.ts` `/capabilities/register`,
`contracts.ts` `ensureCapability`) and the Python SDK all use `totalSupply()` as
the new `capabilityId`. Diagnostic:

```
after new register: ids = 1,2,3 | totalSupply = 2
```

So the caller is told "your capability is #2" when #2 belongs to someone else —
and `ensureCapability` then runs `certifyCapability(2)`, **certifying another
creator's capability**. Same class of bug in `attestCompletion`, which returns
`nextCompletionId()` read *after* the receipt instead of the emitted id.
**Fix:** parse `CapabilityRegistered` / `SelfAttested` from the receipt logs in
all SDKs and in the backend; stop deriving ids from supply counters.

### F6. Decay is too aggressive and already zeroed the pilot 🔴
`getSelfAttestScore` does `net >> (daysSince / 30)` with `lastActivity` updated
only by `attestCompletion`. Integer halving destroys small scores: 3 completions
→ 1 → 0. Live result today: Agent A shows completions 3, disputes 0, **score 0**,
so `/api/discover?minScore=1`, the SDK README example
`discover(registry, ron, "LoRA", 1)` and Agent B's documented `--min-score 1`
all find **nothing**. It also broke the Python test suite (F7).
**Fix (pick one, then implement + redeploy):**
- linear decay over a longer horizon with a floor, e.g. `score × (1 − min(1, days/90))` in fixed-point; or
- keep halving but scale first (`(score * 1e6) >> halvings`) and add a grace period / minimum of 1 for agents with net > 0; or
- expose decay as a *separate* view (`getRecencyAdjustedScore`) and keep `getSelfAttestScore` raw, so consumers choose semantics.

Also: refresh `lastActivity` on *any* protocol interaction with the agent
(attestation, upheld dispute, capability registration), expose `lastActivity` and
the decay factor in `/api/agents/:addr/score` + the UI, and update the Python
test to the intended semantics. Note `WHITEPAPER.md:529,848` still calls decay a
**v2** feature — docs contradict shipped bytecode.

---

## 5. P1 — Toolchain honesty, onboarding, and product gaps

### F7. The test/typecheck story is not what the docs claim 🟠
- `npm run typecheck` compiles nothing (see §2) yet README/TEST_RESULTS cite
  "typecheck clean" as evidence.
- Real type errors exist in backend (3) and demo (1); CI hides the backend ones
  with `|| true` and never typechecks the demo.
- Python tests: 1 failing (decay semantics, F6). README still says "6 passing".
- No backend tests at all, no coverage run, no fork tests, no linter despite a
  `lint` CI step.
**Fix:** `"typecheck": "npm run typecheck -ws --if-present && tsc -p packages/backend --noEmit && tsc -p packages/mcp-server --noEmit"` (or per-package scripts), fix the 4 errors, drop `|| true`, add `pytest` with network tests marked `-m "not network"`, add vitest+supertest for the API, run `solidity-coverage` in CI, add ESLint (or remove the lint step).

### F8. Onboarding is broken for a fresh clone 🟠
- `packages/python-sdk/pyproject.toml` declares `readme = "README.md"` but that
  file **does not exist** → `python -m build` / twine publish fails, blocking the
  stated PyPI plan.
- Python SDK `_load_deployment()` requires a `token` key that the Base Sepolia
  `deployments.json` doesn't have (only `deploy-local` writes it) → KeyError on
  the documented live-deployment path; `get_agent_score()` calls a dormant v2
  `getAgentScore` that reverts against v1 bytecode; `discover()` still does the
  O(n) `tokenByIndex` scan instead of the indexed path.
- Documented local quickstart is broken: the backend picks
  `RPC_URL || BASE_SEPOLIA_RPC_URL || localhost`, so after `npm run deploy:local`
  (chainId 31337) the provider is built as (Sepolia URL, chainId 31337) → mismatch.
- `deployments.json` is gitignored with no `.example` (the `.gitignore` even
  references a `!deployments.json.example` that doesn't exist), so a fresh clone
  has no addresses at all.
- MCP: default RPC is `https://base-sepolia.infura.io/v3/` **without a key**;
  default deployments path is cwd-relative `../../deployments.json` (wrong under
  `npx`/global install); `get_deployment_info` reports `network: "unknown"` and
  `timelock: null` on the env-fallback path; server version string says `0.0.1`.
- Demo UI hardcodes the GitHub link to `https://github.com`.

### F9. Docs have drifted from reality 🟡
Test counts (22 vs 23), Solidity line count (279 vs 322), decay described as v2
while it is live, "rate limiting enabled" (it isn't), "on-chain RON may predate
identity support" (identity verified live), duplicate `See:` block in README
(~lines 288–297), and 11 root-level planning/design markdown files with
overlapping, partly-superseded content.
**Fix:** one README + `docs/` (architecture, operations, roadmap) + `archive/`
for superseded plans; correct the numbers; add a CI doc-lint that checks headline
claims (test counts, published versions) against the repo.

### F10. Discovery does not scale, and there is no indexer 🟡
`capabilitiesByType` grows unbounded and is returned whole; clients then loop
`getCapability` + `getSelfAttestScore` per id (O(n) RPC round-trips, no paging).
Fine at n=1; not at n=1,000. **Fix:** add paged views (`getCapabilitiesByTypePaged(type, offset, limit)`, `countCapabilitiesByType`), add an off-chain indexer (Ponder/The Graph, or a small `eth_getLogs` poller into SQLite as a first step) and serve `/api/discover` from it with pagination + ETag caching.

### F11. Trust model is still "agent grades its own homework" 
v0.1 reputation is self-attestation + a single owner adjudicator with delay 0
(the Timelock is real but the proposer/executor is one EOA, so it is effectively
a single key). Competitors ship counterparty-signed or staked-validator signals.
**Fix (v0.2 primitive, highest differentiation per unit of work):** two-sided
attestations — the requester countersigns a receipt (`attestReceipt(completionId, resultCID)`),
so a score is backed by an independent party; plus a challenge window with
optimistic resolution instead of owner-only adjudication. This is the change that
makes "credit bureau" credible rather than rhetorical.

### F12. No observability, no operations 🟡
No metrics, health only returns `{ok:true}`, no alerting, no uptime/price
monitoring, no key-rotation runbook, no disclosure policy. `pino` is a dependency
but logging is `console.*`.
**Fix:** structured logs via pino, `/api/healthz` with chain-id/RPC-latency/
indexer-lag fields, a small event poller that alerts on `ChallengeSubmitted` /
`ChallengeResolved` / `EthPoolWithdrawn`, and an `docs/OPERATIONS.md` runbook.

---

## 6. P2 — Backlog (after the above)

- Anti-abuse for a self-attest system: minimum bond to attest, per-address rate limits, sybil-resistant identity anchors (ENS/Basename, EAS attestation).
- Fee switch (dormant per `FEE_MODEL.md`) — implement the hook only once there is usage to meter.
- Capability lifecycle: `slashed` is write-once, no revoke-certification, no update-metadata path.
- One-challenge-per-completion limit; no appeal path.
- Cross-type search / semantic capability matching; versioning of capability metadata schemas.
- Hardhat 3 / contract-size and gas snapshots; `ethers` v6 upgrade hygiene in Python (`web3` v6-vs-v7 branch already supports both).
- Rename collisions: repo dir `new-credit-bureau`, npm scope `@taopp/*`, python package `taop`, Gitea-adjacent name `TAOP-protocol` — pick one naming story.

---
## 7. The plan (prioritized, with exit criteria)

Ordering principle: **contain risk → make claims true → fix the two bugs that
break the product promise → redeploy + republish → harden → then grow.** Do not
start new features before Phase 1 is closed; every new feature multiplies the
cost of the redeploy that F4/F5/F6 already force.

### Phase 0 — Contain the leak (½ day, do today)
| # | Task | Files |
|---|---|---|
| 0.1 | Treat the published Agent A key as burned; generate a fresh demo wallet; update `.env` (and remove the duplicate `AGENT_A_PK`) | `.env`, deploy script |
| 0.2 | `git rm --cached deployments.json taop.db taop.db-shm taop.db-wal`; purge history (`git filter-repo --invert-paths --path …`) and force-push; add `deployments.json.example` (addresses only) | `.gitignore`, repo history |
| 0.3 | Untrack generated junk: `typechain-types/`, `**/*.egg-info/`, `**/__pycache__/` | `.gitignore` |
| 0.4 | Rotate `PINATA_JWT` + `REPLICATE_API_TOKEN` if that `.env` was ever shared | `.env` |
| 0.5 | Gate every POST route behind `X-TAOP-Key`; wire `express-rate-limit`; refuse to bind a public interface without a key; update README so the cloudflared instruction is read-only-demo-only | `packages/backend/src/server.ts`, README |

**Exit:** repo history contains no private keys; `npm run backend:dev` refuses to
serve writes without a key; README no longer tells strangers to expose admin routes.

### Phase 1 — Make the toolchain honest (2–3 days)
| # | Task |
|---|---|
| 1.1 | Fix the 4 real type errors; replace the no-op `typecheck` script with real per-workspace typechecks; remove `\|\| true` from CI; add demo/mcp/backend typecheck jobs |
| 1.2 | Add backend API tests (vitest + supertest, chainless where possible); split Python tests into `network`-marked and offline; fix the decay assertion |
| 1.3 | Fix `discover()` resilience (per-id try/catch) in backend, MCP, TS SDK, Python SDK — ships immediately, no redeploy needed |
| 1.4 | Fix id derivation everywhere to parse `CapabilityRegistered` / `SelfAttested` logs |
| 1.5 | Fix decay (contract + `lastActivity` refresh on interaction); surface decay in `/api/agents/:addr/score` and the UI; correct `WHITEPAPER.md` decay claims |
| 1.6 | Docs truth pass: test counts, line counts, rate-limiting claim, identity note, README duplicate block, archive superseded plans |

**Exit:** CI fails on real breakage; `pytest` green; docs numbers match reality.

### Phase 2 — Ship v0.1.2 (3–5 days)
1. Contracts: swap-and-pop index cleanup in `withdrawBond`; decay v2 view; new tests
   for both (they become the regression suite for F4/F5/F6).
2. Redeploy to Base Sepolia (`npm run deploy:sepolia`), verify on Basescan,
   update `deployments.json.example` + README + `CHANGELOG.md` + `TEST_RESULTS.md`.
3. Run the full E2E (demo run → challenge → resolve → discover with `minScore=1`)
   and record the tx hashes as evidence.
4. Publish `@taopp/sdk@0.1.2` + `@taopp/mcp-server@0.1.1` (fix default RPC to
   `https://sepolia.base.org`, env-first config, correct version string, honor
   `DEPLOYMENTS_PATH` in every entry point).
5. Add `packages/python-sdk/README.md`, fix `_load_deployment`, publish `taop` to PyPI.
6. GitHub hygiene: repo description + topics (`ai-agents`, `reputation`, `base`,
   `mcp`, `lora`, `ethereum`), a `v0.1.2` release with notes, pinned README banner.
7. Stand up a **read-only** public demo (Fly.io/Render) — no keys on the write path.

**Exit:** an outsider can `npm i @taopp/sdk`, discover a live agent with score > 0,
and click a public demo URL — with no leaked key and no admin exposure.

### Phase 3 — Credibility & differentiation (2–4 weeks)

**Progress 2026-09-15:** F11 (two-sided trust), F10 (off-chain index + paginated
discovery) and F12 (observability + runbook) are implemented across the contract,
both SDKs, the MCP server, the backend and the demo UI, with a regression suite of
56 contract tests. They are **not yet deployed** — the live Base Sepolia pilot is
still v0.1.2 and consumers fall back to the self-attest score there. See
`CHANGELOG.md` [Unreleased].

- [x] Two-sided attestations (counterparty receipt: `attestReceipt`/`revokeReceipt`)
      + challenge window with optimistic resolution (`contestChallenge`/
      `finalizeChallenge`, owner fallback). `getTwoSidedScore` for ranking (F11).
- [ ] Multisig (Safe on Base) + non-zero Timelock delay, rehearsed on Sepolia;
      explicitly document the decision to **unfreeze the 0-delay policy** (frozen
      by choice in `PRE_MAINNET_CHECKLIST.md`).
- [x] Off-chain indexer + paginated discovery (F10): `getCapabilitiesByTypePaged` /
      `countCapabilitiesByType` on the registry; a SQLite `eth_getLogs` poller
      (`packages/backend/src/indexer.ts`) serves `/api/discover` with
      `limit`/`offset`, `X-Total-Count` and `ETag`, falling back to an on-chain
      scan until warm. Verified against live Base Sepolia (indexed the pilot
      capability, `lag=0`).
- [x] Observability + operations runbook (F12): pino structured logs with secret
      redaction, enriched `/api/healthz` (RPC latency, block, indexer lag, write
      mode), a `/api/alerts` event stream, and `docs/OPERATIONS.md`.
- [ ] Redeploy to Base Sepolia with the v0.2 contracts + update addresses/README.
- [ ] Audit (Slither + manual + external if funded) → mainnet deploy → verification → monitoring.

**Exit:** mainnet contracts with ≥1 external interaction, a public audit-or-review
artifact, and one external integration (framework, MCP directory, or agent).

### Suggested cadence
Sprint 1 = Phase 0 + 1. Sprint 2 = Phase 2. Sprints 3–5 = Phase 3. Update this
file (or `NEXT_STEPS.md`) weekly with what shipped vs. slipped.

---
## 8. Verification playbook (reproduce every finding)

```bash
# --- contracts: 23 tests, then prove F4/F5 with a throwaway diagnostic ---
npm run contracts:test
npx hardhat test test/tmp_staleindex.test.ts     # see §4 for the test body

# --- typecheck reality (F7) ---
npx tsc --noEmit --listFiles | wc -l             # 0 lines = no-op
(cd packages/backend && npx tsc --noEmit); echo $?   # 2 (real errors)
(cd apps/demo   && npx tsc --noEmit); echo $?        # 2

# --- python suite (F6/F7) ---
cd packages/python-sdk && .venv/bin/python -m pytest tests/ -q   # 1 failed, 5 passed

# --- leak check (F1) ---
git show HEAD:deployments.json | grep -i pk
git log --all --oneline -- .env                  # empty = .env never committed (good)
git ls-files | grep -E 'taop\.db|egg-info|__pycache__|typechain-types' | head

# --- live chain state ---
node -e "(async()=>{const{ethers}=require('ethers');const p=new ethers.JsonRpcProvider('https://sepolia.base.org',84532);
const r=new ethers.Contract('0x716EB78D4E7B297b53d9962e3952228691e3CEaA',['function getSelfAttestScore(address) view returns (uint64,uint64,uint64)','function nextCompletionId() view returns (uint256)'],p);
console.log((await r.getSelfAttestScore('0xD921D63e5d97AEe05Ffc5cccB0162589422DF2bE')).map(String), String(await r.nextCompletionId()));})()"
# → [ '3','0','0' ] '3'   ← score decayed to 0

# --- backend live (writes are unauthenticated today, F2) ---
npm run backend:dev &
curl -s localhost:4000/api/healthz
curl -s 'localhost:4000/api/discover?minScore=0'   # shows the agent at score 0
curl -s 'localhost:4000/api/discover?minScore=1'   # empty → the flagship query is broken

# --- published MCP server (works from a clean cwd) ---
cd /tmp && RPC_URL=https://sepolia.base.org \
  RON_ADDRESS=0x716EB78D4E7B297b53d9962e3952228691e3CEaA \
  REGISTRY_ADDRESS=0x6132175a065295A51FC6d0eA8f1a7456F5c82019 \
  npx -y @taopp/mcp-server   # pipe an initialize/tools/list JSON-RPC stream
```

---

## 9. Decisions only the owner can make

1. **Redeploy now vs. batch.** F4/F5/F6 all require a contract redeploy and a new
   `deployments.json`. Ship one v0.1.2 redeploy with all three fixes (recommended),
   or patch off-chain first and redeploy once with Phase 3?
2. **0-delay freeze.** Keep the frozen 0-delay policy for the pilot and unfreeze only
   for mainnet (Phase 3), or unfreeze on Sepolia next sprint to rehearse
   schedule/execute? Current docs freeze it "until real mainnet value justifies".
3. **Audit budget.** Free-only (Slither + manual + community) or paid audit before
   mainnet? This determines the Phase 3 timeline more than any engineering item.
4. **Agent A identity.** Rotate the address (clean break, new score history) or keep
   `0xD921D6…` and only rotate the key (preserves the 3 attestations)?
5. **Public demo hosting.** Read-only static/Vercel demo (safe, needs an indexer or
   public-RPC reads) vs. hosted write-enabled demo behind an API key (more
   impressive, more operational surface).

---

## 10. One-paragraph recommendation

Do Phase 0 today (it is hours, not days, and it is the only finding with a
real-world cost), then Phase 1 so the repository stops contradicting itself, then
ship v0.1.2 with the discovery-index, capability-id, and decay fixes plus
republished SDK/MCP packages, and put a read-only demo URL in the README before
telling anyone about the project. Everything else — new primitives, mainnet,
fees — is cheaper *after* those three phases.
---

## 11. Phase 0 — execution log (2026-09-15)

Status: **Phase 0 closed 2026-09-15.** Tokens rotated, history rewritten and
force-pushed, no sweep (the compromised testnet agent is retired). One external
residual remains: GitHub's dangling-object cache still serves the pre-purge blob
(`SECURITY.md` §3.7) and needs a GitHub Support GC pass. Two additional
toolchain bugs (found when CI first actually ran) were fixed alongside this —
see the note after the table.

| Item | Status | Evidence |
|---|---|---|
| 0.1 Rotate the leaked agent key | ✅ done | Fresh Agent A `0xB924e0…` generated by the v0.1.2 redeploy; the 3 leaked keys (`0x34c1f2…`, `0xff16cc…`, `0x12a8ae…` / agent `0xD921D6…`) are retired. |
| 0.2 Untrack + purge | ✅ done | History rewritten with `git filter-repo` and force-pushed; local and remote `main` contain no `deployments.json`/`taop.db*` in any commit, no reachable objects for those paths, and no key-shaped values. Backups: `../taop-pre-purge-20260915-164103.bundle` (pre-purge) + `-164445` (post-first-pass). Residual: GitHub still serves old commit `6a60a618` by SHA (`SECURITY.md` §3.7). |
| 0.3 Generated junk ignored | ✅ | `.gitignore` extended (`.venv/`, `*.egg-info/`, `*.whl`, `build/`, `*.db*`) |
| 0.4 Rotate Pinata/Replicate tokens | ✅ done (2026-09-15) | Never committed (verified `git log --all -- .env` is empty), but they sat next to a published repo |
| 0.5 Gate write routes | ✅ verified live | `X-TAOP-Key` (constant-time), `express-rate-limit` (240/min, 20 writes/5 min), `DEMO_READ_ONLY`, loopback-by-default, **refuses non-loopback bind without a key** (exit 1), startup security banner; demo UI can send the key |

Closed out (2026-09-15) after this log was first written: the GitHub Actions
workflow had invalid YAML and aborted every run in 0s, and `npm ci` failed on a
stale lockfile; both are fixed and the pipeline (`npm ci` → typecheck → 32
contract tests → all builds) is green (commits `5b8161f`, `257d593`, `d7a3c10`).

Regression checks after the changes: `npx hardhat test` → **23 passing**; demo build
and backend bundle build green; backend/demo `tsc --noEmit` show **only the 4
pre-existing errors** (backend `contracts.ts:274`, `demo.ts:84` ×2; demo
`App.tsx:600`), i.e. no new type errors from Phase 0 code.

Live middleware matrix (real server, `POST` to a nonexistent completion so nothing
is spent):

| Case | `GET /healthz` | `GET /discover` | `POST` no key | wrong key | correct key |
|---|---|---|---|---|---|
| loopback, no key | 200 | 200 | 400 | 400 | 400 |
| loopback + `TAOP_API_KEY` | 200 | 200 | **401** | **401** | 400 |
| loopback + `DEMO_READ_ONLY=true` | 200 | 200 | **503** | 503 | 503 |
| `HOST=0.0.0.0` without key | — (refuses to start, exit 1) | — | — | — | — |

Two bugs were found and fixed during this work by testing rather than reasoning:
(a) the read-only switch initially returned 503 for **reads** as well, which would
have broken the public read-only demo; (b) the purge script aborted mid-verification
because `pipefail` treated `git grep`'s "no match" exit code as failure.
