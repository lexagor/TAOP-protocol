# RulingOracle — Phase 0 bonded adjudication pilot

`contracts/RulingOracle.sol` is the first contract of the pivot from a
score-first credit bureau to a **bonded adjudication oracle for public-evidence
agent work**. It does **not** custody case funds and is not a marketplace. A
marketplace keeps its own escrow and reads `outcome(caseId)` once a ruling is
final.

Status: **implemented and unit-tested, not deployed.** Phase 0 uses the
`ReviewerPanelAdapter` (three named reviewers, any two sign an EIP-712 review).
UMA OOv3 is deliberately deferred to the Phase-1 $2K+ tier.

## Frozen pilot parameters

| Parameter | Value |
|---|---|
| Case cap | `300 USDC` per case |
| Max live cases | `5` (max live exposure = `1,500 USDC`) |
| Operator bond | `3,000 USDC` floor (2x max live exposure) |
| Challenge window | `48 hours` after publication |
| Escalation window | `72 hours` after a challenge |
| Appeal resolution timeout | `30 days` after escalation (fallback to overturn) |
| Case fee | `25 USDC` flat, paid by the marketplace/payer at publication |
| Challenge bond | `10%` of case value, minimum `25 USDC` |
| Evidence URI cap | `512` bytes |
| Wronged-party challenge | free |
| Loss records | created only for a final `REFUND` ruling |

The constants are hard-coded so a pilot cannot silently re-price. A new
deployment is required to change them.

## Lifecycle

```
publishRuling (operator offer, no fee)
        │
        └── payFee (named fee payer, starts the challenge clock, charges $25)
                 │
                 ├── no challenge ──► finalizeUnchallenged (anyone after 48h)
                 │                        └── final REFUND → loss record
                 │
                 └── challenge (wronged party free; others post 10%/min $25)
                          │
                          ├── escalateRuling (operator, within 72h)
                          │        │
                          │        ├── 2-of-3 reviewers resolve(upheld=true)  → FINALIZED
                          │        └── 2-of-3 reviewers resolve(upheld=false) → OVERTURNED
                          │             (24h panel deadline; timeout → challenge succeeds)
                          │             (or after 30d silence, anyone may defaultOverturn)
                          │
                          └── operator does not escalate within 72h
                                   └── defaultOverturn (anyone) → challenge succeeds
```

On an overturned `PAY` ruling, the payer receives `value` from the operator
bond, the fee is refunded by the operator, the challenger's bond is returned, and
a **third-party** challenger receives a watcher bounty. A wronged party that
challenges for free receives the value but no bounty. The operator never keeps a
challenge bond. The same rules apply symmetrically to an overturned `REFUND`
ruling. A failed third-party challenge bond goes to the wronged party, not the
operator; the operator is compensated by the case fee. This is intentionally a
bounded, named-panel process, not a trustless court.

`outcome(caseId)` returns `(ruling, status, finalizedAt, evidenceHash)`. A
marketplace escrow should act only when `status` is `FINALIZED` (3) or
`OVERTURNED` (4); `ruling` is already the final direction (for `OVERTURNED` it
is the opposite of the original ruling). `PENDING_FEE` (5) means the operator
has published an offer but the fee payer has not activated it yet.

## Integration contract for a marketplace

1. Keep case funds in the marketplace's own escrow.
2. Send the case to the operator: `caseId`, provider, payer, fee payer, ERC-8004
   `agentId` (or `0`), value, `specHash`, public `evidenceHash`, `evidenceURI`.
3. The operator calls `publishRuling` to publish the offer. The named fee payer
   then approves `FEE` (25 USDC) and calls `payFee`; that starts the challenge
   clock. The fee payer is always `msg.sender`, so an operator cannot pull from
   an arbitrary address.
4. After the challenge/appeal process, read `outcome(caseId)` and settle the
   escrow. Do not treat a `RULED` or `CHALLENGED` ruling as final.

The SDK client is `RulingOracleClient` in `packages/sdk/src/clients.ts`; the
ABI is `RULING_ORACLE_ABI` in `packages/sdk/src/abis.ts`.

## Deployment

Local (mock USDC + reviewer panel, $3,000 bond auto-funded):

```bash
npm run deploy:ruling
npm run e2e:ruling
```

Base Sepolia mock-stack E2E (requires `DEPLOYER_PK` with testnet ETH and
`BASE_SEPOLIA_RPC_URL`; deploys throwaway reviewers):

```bash
npm run e2e:ruling:sepolia
```

Base Sepolia / Base:

```bash
# 1. Deploy the Phase-0 reviewer panel (owner must set reviewers).
RULING_REVIEWERS=0xA,0xB,0xC npm run deploy:panel:sepolia

# 2. Deploy the oracle, pointing at the panel.
RULING_USDC_ADDRESS=0x... \
RULING_ESCALATION_ADDRESS=0xPanel... \
RULING_REVIEWERS=0xA,0xB,0xC \
RULING_TREASURY=0xSafe... \
RULING_OWNER=0xSafe... \
RULING_BOND_USDC=3000 \
npm run deploy:ruling:sepolia
```

- Canonical USDC is used automatically on chains 8453 and 84532 when
  `RULING_USDC_ADDRESS` is omitted.
- Non-local deploys **require** `RULING_ESCALATION_ADDRESS`; the core oracle
  rejects a zero appeal address.
- If the panel owner is a Safe (recommended on mainnet), deploy with
  `RULING_WIRE_PANEL=false` and execute `setOracle` + `setReviewers` from the
  Safe.
- Mainnet additionally requires `ALLOW_RULING_MAINNET=true`, an explicit Safe
  owner, and an explicit treasury. Do not enable it before the audit, entity,
  and panel are ready.
- The deployment artifacts are `ruling-oracle-deployment.json` and
  `reviewer-panel-deployment.json` (both gitignored).

## Trust model and known limitations

- **Trusted first instance.** The operator decides `PAY`/`REFUND`, attests to
  the evidence hashes, and can decline to publish. The bond, challenge window,
  and appeal are the checks on that power.
- **Free wronged-party challenge is griefable.** A payer can challenge every
  `PAY` ruling for free, forcing the operator to escalate or accept a default
  overturn. This is intentional protection for the wronged party, but the
  operator must budget escalation costs and response time.
- **Named reviewer panel, not a trustless court.** Three named reviewers, any
  two of whom sign the outcome. They are not bonded on-chain in Phase 0; the
  operator bond is the economic backstop. Reviewer bonds/slashing are a Phase-1
  upgrade.
- **UMA OOv3 is deferred.** At a $300 cap, the OOv3 assertion bond and DVM
  escalation cost more than the case. UMA belongs to the $2K+ tier with a
  ≥$20K bond; the non-payable `IEscalationOracle` can be served by a pre-funded
  adapter or a future oracle version.
- **No pause.** Settlement paths cannot be frozen; the operator can stop
  publishing but cannot block challenges, finalization, or default overturns.
- **ERC-8004 identity is attested, not verified on-chain.** The operator/market
  must ensure `agentId` belongs to the provider before publishing.
- **USDC assumptions.** Six decimals, no fee-on-transfer, no rebasing. The pilot
  uses canonical USDC on Base.

## Tests

```bash
npx hardhat test test/RulingOracle.test.ts
npm run lint:sol
npm run sdk:build
```

The suite covers the full lifecycle, both ruling directions, all boundaries,
wronged-party and third-party challenges, reviewer 2-of-3 signatures, adapter
failures, default overturn, liveness timeout, loss records, treasury rotation,
and the accounting invariant `USDC balance == operatorBond + challengeBonds`.
The reviewer-panel suite is `test/ReviewerPanelAdapter.test.ts`; the local
end-to-end demo is `scripts/e2e-ruling.ts`.
