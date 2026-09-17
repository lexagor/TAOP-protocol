# Hardened Timelock (multisig + non-zero delay)

The pilot runs a `TimelockController` with **delay 0** and the deployer EOA as both
proposer and executor — architecturally hardened, but operationally a single key.
This document is the rehearsal path to the mainnet shape: a **multisig proposer**
and a **non-zero delay**, so no single key can resolve disputes or move funds
instantly.

> Policy note: the 0-delay freeze for the pilot is **by choice** (see
> `PRE_MAINNET_CHECKLIST.md`). Unfreezing it is a deliberate decision — do it for
> the hardened Sepolia rehearsal and for mainnet, not silently.

## What the deploy script already supports

`scripts/deploy-base-sepolia.ts` and `scripts/deploy-local.ts` read:

| Env | Effect |
|---|---|
| `TIMELOCK_DELAY` | `minDelay` in seconds (`0` pilot/pilot-default; e.g. `3600`, `86400`) |
| `MULTISIG_ADDRESS` | sets proposers **and** executors to this address (e.g. a Safe) |
| `PROPOSERS` / `EXECUTORS` | comma-separated lists if you want them to differ |

`admin` is always `address(0)` (no lingering admin role after setup), and both
contracts transfer ownership to the Timelock.

## Local rehearsal (no keys, no funds)

```bash
# deploy with a 1h delay and a multisig proposer/executor
TIMELOCK_DELAY=3600 \
MULTISIG_ADDRESS=0x0000000000000000000000000000000000000001 \
DEPLOYMENTS_PATH=/tmp/taop-hardened.json \
  npx hardhat run scripts/deploy-local.ts

# prove schedule → too-early revert → time.increase → execute
npx hardhat test test/TimelockDelay.test.ts
```

`test/TimelockDelay.test.ts` covers exactly what matters:

- `getMinDelay() == 3600`
- a non-proposer **cannot** `schedule`
- `schedule` succeeds, `execute` **reverts before** the delay, succeeds after
- the 0-delay pilot path still executes immediately (for contrast)

## Sepolia rehearsal

1. Create a Safe (or any multisig) on Base Sepolia; note its address. Fund it —
   the proposer/executor pays gas for `schedule`/`execute`.
2. Deploy hardened:
   ```bash
   MULTISIG_ADDRESS=0xYourSafe TIMELOCK_DELAY=3600 npm run deploy:sepolia
   ```
3. Confirm `getMinDelay() == 3600` and that `hasRole(PROPOSER_ROLE, safe)`,
   `hasRole(EXECUTOR_ROLE, safe)` are true, and no one retains `DEFAULT_ADMIN_ROLE`.

## Running an admin action through the Timelock

**Easiest path — generate the Safe batches:**

```bash
npm run timelock:tx -- --action pause --delay 3600
npm run timelock:tx -- --action cooldown --seconds 3600
npm run timelock:tx -- --action resolve --completion 1 --upheld true
npm run timelock:tx -- --action setCertifier --certifier 0xYourSafe
npm run timelock:tx -- --action withdrawRon --to 0xAddr --amount-eth 0.01
```

It writes `timelock-batch-schedule.json` and `timelock-batch-execute.json` for
<https://app.safe.global/apps/transaction-builder> (same salt in both) and prints
the raw calldata. It never sends anything.

### Manually

`resolveChallenge`, `withdrawEthPool` and `setCertifier` are `onlyOwner`, and the
owner is the Timelock. To execute one:

1. Encode the calldata, e.g.
   ```ts
   const data = ron.interface.encodeFunctionData("resolveChallenge", [completionId, true]);
   ```
2. From the **multisig**, call
   `timelock.schedule(target, value, data, predecessor=0x00…, salt, delay)`.
3. Wait for `delay`, then (anyone with the EXECUTOR role, or anyone if executor is
   the zero address) call
   `timelock.execute(target, value, data, predecessor, salt)`.

The backend already handles the 0-delay case synchronously. With a **non-zero**
delay it only *schedules* and returns `{ scheduled: true, executed: false, delay }`
(see `packages/backend/src/contracts.ts` `executeViaTimelock`), so a keeper must
call `execute` after the delay. Authorize actions at:

- RON: `resolveChallengeCompletion`-style calls via `/api/completions/:id/resolve`
- Registry: `setCertifier` (via a script), `withdrawEthPool`

## Proposer / executor guidance

- **Proposer:** the multisig only (no EOA) — this is what limits unilateral action.
- **Executor:** either the multisig, or `address(0)` to let *anyone* execute a
  proposal that has already passed its delay (common; the delay is the guard).
- **Delay:** pick per risk. 1h is fine for a rehearsal; 24h+ for mainnet value.

## Rollback

To return to the pilot, redeploy with the defaults (no `TIMELOCK_DELAY`,
no `MULTISIG_ADDRESS`). Nothing is upgraded in place.
