# Canonical checkout

Use this tree for all reviews, deploys, and raise materials:

- **Path:** `/Users/a/Documents/cline-desktop/credit-bureau/new-credit-bureau`
- **Remote:** `https://github.com/lexagor/TAOP-protocol.git`
- **Branch:** `main`
- **Baseline before the Phase-0 work:** `54716d5`
- **Phase-0 release tag:** `v0.6.0-ruling-oracle`

The other checkouts found on disk had no commits ahead of `origin/main`, but
they had dirty worktrees and different histories. They were moved on
2026-11-02 to:

`/Users/a/Documents/_archive/taop-checkouts-2026-11-02/`

That folder contains the original dirty trees and a `MANIFEST.txt` with each
HEAD, dirty-entry count, and the canonical remote. Do not review or deploy from
the archived trees. Every external review request must pin the commit hash:

```bash
git rev-parse HEAD
```
