# Emergency & key-management runbook

Operational security for running TAOP with real value. Read with
[`OPERATIONS.md`](OPERATIONS.md) and [`SECURITY-REVIEW.md`](SECURITY-REVIEW.md).

## 1. Key management

| Key | Privilege | Storage |
|---|---|---|
| Owner / Timelock proposer+executor | Resolve disputes, withdraw pools, set certifier | **Safe multisig** (before mainnet value). Never a hot EOA. |
| `DEPLOYER_PK` | Deploys contracts; owns them until transfer | Hardware wallet or KMS; used offline; never on the demo host. |
| `certifier` | Certify / slash capabilities | Multisig or a dedicated operator key — not the deployer. |
| `AGENT_A_PK` | Demo agent (bonds, gas) | Hot by design; keep only testnet-scale funds. |
| `TAOP_API_KEY` | Backend write gate | Server env only; rebuild the demo UI with the same `VITE_TAOP_API_KEY`. |

Rules:
- One key, one purpose. Never reuse the deployer/owner key as the agent key.
- Testnet and mainnet keys are completely separate; never put a mainnet key on
  the demo host.
- Rotate by redeploy or Timelock role change — there is **no in-place key swap**
  for the owner.
- Never commit keys; `.env` is gitignored and `chmod 600`. Secret scanning +
  push protection are enabled on the repo.

## 2. There is no pause — plan accordingly

The contracts have **no circuit breaker**. If a bug is discovered post-deploy:

1. **Assess blast radius.** Funds at risk are the challenge bonds + slashed pools
   held by the contracts, and the ability to flip disputes.
2. **Stop the bleeding.**
   - If a privileged path is being abused, rotate the Timelock proposer/executor
     to a safe key (requires another proposer; a single-key Timelock cannot be
     rotated safely — this is why the multisig matters).
   - If `certifier` is compromised, `setCertifier` to a new key via the Timelock.
   - Withdraw pools to a safe address via `withdrawEthPool` if that is the safer
     position.
3. **Communicate.** Post a disclosure per `SECURITY.md`; pause the public demo.
4. **Migrate.** Deploy a patched contract, publish the new addresses, and move
   users/agents across. There is no proxy/upgrade path — migration is a redeploy.

## 3. Scenario playbooks

**Owner key suspected compromised (single-key Timelock).** You cannot rotate
proposers if the attacker is the only proposer. Treat the contracts as
compromised: withdraw any owner-reachable pools you still can, publish a new
deployment, and retire the old addresses. (With a Safe, remove the compromised
signer and rotate.)

**Agent key leaked.** The agent can self-attest, post bonds, and register
identity — no owner rights. Retire the agent, redeploy with a fresh key, and note
it in `SECURITY.md` §3. If it ever reached Git, see the history-rewrite + GitHub
Support GC procedure.

**Public write path exposed.** If `TAOP_API_KEY` leaked or the write server was
reachable: rotate `TAOP_API_KEY`, rebuild the UI, restart the server with
`DEMO_READ_ONLY=true` until fixed, and review `/api/alerts` for unauthorized
`ChallengeSubmitted` / pool activity.

**RPC / provider outage.** `/api/healthz` shows `rpc.ok=false` + error. Switch
`BASE_MAINNET_RPC_URL` to a backup provider and restart. The indexer lags but
`/api/discover` falls back to on-chain reads.

**Reorg detected.** `/api/healthz` `indexer.reorgsDetected` increments; the
indexer rebuilds derived state from logs automatically. To force a full rebuild,
stop the backend, delete `taop.db*` (or `DELETE FROM agent_scores; DELETE FROM
indexed_logs; DELETE FROM meta WHERE key LIKE 'indexer_%'`), and restart with
`INDEXER_START_BLOCK=<deployment block>`.

**Contract bug (non-emergency).** Document it, open a private advisory
(`SECURITY.md`), write a regression test, and fold the fix into the next
redeploy. Do not hot-patch.

## 4. Pre-incident checklist

- [ ] Safe multisig is the Timelock proposer/executor; the deployer key is cold.
- [ ] `certifier` is the multisig/operator, not the deployer hot key.
- [ ] A second person (or documented cold procedure) can propose Timelock actions.
- [ ] Alerting wired to `/api/healthz` (`rpc.ok`, `indexer.lag`) and `/api/alerts`
      (`EthPoolWithdrawn`, `CertifierChanged`, `ChallengeResolved`).
- [ ] Backups of `deployments.json` + `.env` stored offline.
- [ ] This runbook and `OPERATIONS.md` reviewed by whoever is on call.
