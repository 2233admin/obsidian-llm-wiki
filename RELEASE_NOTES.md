# LLM Wiki v2.8.0-beta.4

This beta makes session capture safer to ship, updates memU for its current
PostgreSQL schema and Jina embedding profile, and refreshes the supported build
and release toolchain. It also adds a Spanish project overview.

## Added

- The session archiver is now a packaged MCP CLI. It supports multiple source
  projects, writes each project to its own archive path, and ships in the MCP
  release archive.
- Governed Agentfiles workflows can capture and review agent-facing project
  instructions through the existing knowledge-governance path.
- A Spanish README is available from the main project language navigation.

## Changed

- memU recall now reads `recall_files` and `recall_file_segments`, uses
  `jina/v5-omni-nano` as the default memU embedding profile, and supports direct
  768-dimensional vector recall.
- Explicit embedding endpoint assignments still override profile endpoints.
  Without an assignment, each built-in profile uses its own endpoint.
- Proxy-enabled embedding requests use a required `undici` proxy agent and do
  not silently bypass an explicitly configured proxy.
- MCP, TypeScript, CodeMirror, GitHub Actions, Caddy, and OpenSpec dependencies
  were refreshed together with their lockfiles and release workflow pins.
- The Obsidian plugin release for this candidate is `0.4.0-beta.6`. The MCP
  runtime package is `0.4.0-beta.4`.

## Fixed

- `searchByVector()` now returns memU 2.0 recall-segment matches for the default
  768-dimensional Jina profile instead of returning an empty result.
- The Settings runtime no longer replaces Jina's built-in API endpoint with the
  default local Ollama endpoint unless an endpoint override was explicitly set.
- Session metadata, including thread names, is redacted before archive files are
  written.
- Fleet registry secret scanning recognizes both permanent and temporary AWS
  access-key IDs while requiring a complete three-segment JWT, avoiding broad
  false positives on unrelated base64url text.
- The external release archive now includes `session-archiver.js`.
- Prerelease plugin tags are marked as GitHub prereleases and are not promoted
  to the repository's latest stable release.

## Security

- Session archives redact authorization headers, API keys, bearer tokens, and
  sensitive metadata before persistence.
- Fleet registry validation rejects `AKIA` and `ASIA` access-key IDs and compact
  JWTs before configuration is stored.
- Dependency lockfiles resolve with zero known npm advisories at release
  preparation time. The release workflow repeats dependency installation and
  all security gates from clean environments.

## Upgrade notes

1. Use Node.js 20.18.1 or newer for the MCP package.
2. Review [docs/INSTALL.md](docs/INSTALL.md) and
   [docs/SETTINGS.md](docs/SETTINGS.md).
3. If memU is enabled, configure the Jina credential through the existing
   device-local Secret Reference or explicitly bind memU to an Ollama profile.
4. If an embedding proxy is required, set `OLLAMA_EMBED_PROXY`; direct fallback
   is no longer used when a proxy was requested.
5. Install Obsidian plugin `0.4.0-beta.6` from its matching numeric GitHub tag.
   The retained plugin ID remains `vault-mind-promote`, so existing vault state
   is preserved across the upgrade.

## Release evidence

The `v2.8.0-beta.4` tag workflow requires a fresh signed
`docs/release-evidence/v2.8.0-beta.4.json` produced by the real 5090 acceptance
sequence at the final tested product commit. The verifier rejects unsigned or
stale reports, product changes after the tested commit, identity drift, and
noncanonical fixtures.

Real memU PostgreSQL and configured third-party network providers remain opt-in
environment tests. This beta does not claim those integrations when their
services or credentials are absent.
