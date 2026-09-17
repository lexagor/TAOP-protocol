# Publishing

How to publish the packages. **Publishing is manual and deliberate** — the
workflows only run on `workflow_dispatch`; no release publishes automatically.

Current versions: `@taopp/sdk@0.3.0` · `@taopp/mcp-server@0.3.0` · `taop@0.3.0`.

Version bumps live in:
- `packages/sdk/package.json`, `packages/mcp-server/package.json`
- `packages/mcp-server/src/index.ts` (`version:` in the MCP `Server` ctor)
- `packages/python-sdk/pyproject.toml` and `taop/__init__.py` (`__version__`)
- any `@taopp/sdk` range in `packages/backend`, `packages/mcp-server`,
  `apps/static-demo` — remember **`^0.1.x` does not match `0.3.0`**; bump the range too.

## npm — `@taopp/sdk` + `@taopp/mcp-server`

**One-time setup (owner):** on npmjs.com → each package → *Settings* → *Trusted
Publisher* → GitHub Actions with owner `lexagor`, repo `TAOP-protocol`, workflow
`publish-npm.yml`, environment `npm-publish`. (Or add a granular token as the
`NPM_TOKEN` secret and uncomment the `NODE_AUTH_TOKEN` lines in the workflow.)

**Publish:** GitHub → Actions → **Publish npm packages** → *Run workflow*.
Leave `dry_run` on for a first pass (builds + `npm publish --dry-run`), then run
again with `dry_run` off.

**Manual fallback:**
```bash
np login                       # 2FA; needs publish rights on @taopp
npm publish -w @taopp/sdk --access public
npm publish -w @taopp/mcp-server --access public
```

**Verify / retire old versions:**
```bash
npm view @taopp/sdk version && npm view @taopp/mcp-server version
npm deprecate @taopp/sdk@0.1.2 "superseded by 0.3.0"
```

## PyPI — `taop`

**One-time setup (owner):** PyPI → *Your projects* → Publishing (or the
"pending publisher" if the project doesn't exist yet) → add publisher: owner
`lexagor`, repo `TAOP-protocol`, workflow `publish-python.yml`, environment `pypi`.

**Publish:** GitHub → Actions → **Publish Python SDK** → *Run workflow*. It builds
sdist+wheel, runs `twine check` and `check_wheel.py`, then uploads via OIDC.

**Manual fallback:**
```bash
cd packages/python-sdk
python3 -m venv /tmp/pub && . /tmp/pub/bin/activate
pip install -q build twine
python -m build && python -m twine check dist/* && python check_wheel.py dist/*.whl
TWINE_USERNAME=__token__ TWINE_PASSWORD=pypi-XXXX python -m twine upload dist/*
```

**Verify:**
```bash
python3 -m venv /tmp/v && /tmp/v/bin/pip -q install taop==0.3.0
/tmp/v/bin/python -c "import taop; print(taop.__version__)"   # 0.3.0
```

## After publishing

- Point users at the new versions in `README.md` / package READMEs.
- Create/annotate a GitHub release (`sdk-v0.3.0` / `py-v0.3.0`, or extend the
  `v0.3.0` release notes).
- The deployed contracts are independent of package versions; the SDK falls back
  to the self-attest score on pre-v0.2 deployments and uses the credit score on v0.3.
