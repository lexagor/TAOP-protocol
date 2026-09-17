## Summary

<!-- What does this change, and why? -->

## Checklist

- [ ] Tests added/updated (or N/A)
- [ ] Local checks pass: `npm run typecheck && npm run lint && npm run lint:sol`
- [ ] No secrets or keys added — `npm run scan:secrets` passes (keys live only in `.env`)
- [ ] Contracts changed → `npm run contracts:test`, `npm run contracts:test:foundry`, and `npm run slither` pass
- [ ] Deploy/backend changed → `npm run e2e:local` passes
- [ ] Docs updated (README / CHANGELOG / `docs/`)

## Security notes

<!-- Describe any change touching auth, keys, ownership, bonds, the trust model,
     dependencies, or CI, and why it is safe. Otherwise write "none". -->
