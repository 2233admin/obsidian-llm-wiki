# Agent Wiki release evidence

Date: 2026-07-23  
OpenSpec change: `internalize-agent-wiki-toolchain`

This record covers the filesystem baseline, optional-provider contract smoke, cross-runtime contracts, compiler source revision/retraction, maintenance, retrieval routing, generated artifacts, and production bundle reproducibility.

## Lifecycle scenario

`mcp-server/src/release/agent-wiki-lifecycle.e2e.test.ts` executes:

```text
register -> report-only plan -> filesystem ingest -> verify
         -> durable maintenance plan/drain -> filesystem retrieval
         -> source revision/re-ingest -> contribution revision -> source retraction
```

The same scenario validates the OpenCLI capture-only boundary and a compatible cached capability receipt without requiring a live network or installed provider. The compiler's provider call is served by a deterministic loopback OpenAI-compatible endpoint; no external network is used.

Result:

```text
bun test src/release/agent-wiki-lifecycle.e2e.test.ts
1 pass, 0 fail
```

The maintenance stage drains the queue entry created by ingest through the production `CompileTrigger`, `DurableMaintenanceQueue`, and real `compiler/compile.py`. Source-versioned revise/retract uses the production Python `contribution_manifest` API with the ordinary fail-closed provenance gate.

## Verification matrix

| Surface | Command | Result |
|---|---|---|
| Shared Agent Wiki TypeScript contracts | `bun test && bun run typecheck && bun run build` in `packages/agent-wiki-contracts` | 4 passed; typecheck/build passed. |
| Settings TypeScript conformance | `bun test && bun run typecheck && bun run build` in `packages/settings-platform` | 49 passed; typecheck/build passed. |
| Settings Python conformance | `python -m pytest compiler/tests/test_settings_platform.py -q` | 48 passed. |
| Compiler and Python domains | `python -m pytest compiler/tests -q` | 885 passed plus 33 subtests. |
| MCP server | `bun test tests/ src/` | 682 passed, 18 skipped, 0 failed across 89 files. |
| MCP type safety | `npm.cmd run typecheck` | Passed. |
| Obsidian control plane | `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd run verify:bundle-boundary` | 65 passed; typecheck, production build, and boundary verification passed. |
| MCP reference | build followed by `node dist/scripts/generate-tools-doc.js` | `docs/mcp-tools-reference.md` regenerated; generator regression passed in full MCP suite. |
| Production bundles | two consecutive `npm.cmd run rebuild` runs plus SHA-256 comparison | Identical hashes: MCP `2FB94839707EF4E3549810B611F5E7E6B95EE872A73071B531A59E7E7455757E`; Agent CLI `ECB021A9B675DB73A7E284FBCC123352D3212F5F1126F29EE2E8B81D0D05BC5D`. |
| OpenSpec | `openspec validate internalize-agent-wiki-toolchain --strict --no-interactive` | Valid. |
| Patch hygiene | `git diff --check` | No whitespace errors; one expected CRLF-to-LF notice for an edited Markdown file. |

The 18 skipped MCP tests require a separately provisioned `MEMU_TEST_DSN` PostgreSQL/pgvector integration environment. The production suite still exercises MemU failure isolation, secret handling, settings, subprocess boundaries, and vector contracts. Filesystem-only operation and the Agent Wiki lifecycle do not depend on that service.

The repository's `verify:bundle` command intentionally fails while regenerated bundle files differ from `HEAD`, reporting them as “missing or stale.” This change updates those generated artifacts, so pre-commit dirtiness is expected. Typecheck, build, bundle generation, startup/unit coverage, and consecutive-build hash equality provide the pre-commit verification; the clean-tree check becomes applicable after the generated artifacts are committed.

## Rollback evidence

Unit and integration coverage verifies:

- disabled ingest blocks `run`/`resume` while retaining `plan`/`inspect`/`verify`;
- `legacy-threshold` restores compile triggering without deleting queue state;
- `legacy-rrf` restores pure RRF ordering while preserving normalized results;
- disabled probes prevent live probing while retained profile state stays readable;
- legacy Ingest Run/receipt/queue readers upgrade in memory and persist canonical v1 only on a later mutation;
- legacy `unknown-provenance` compiler output requires report/backfill and a full rebuild before destructive retraction.

No optional provider is required for the verified filesystem baseline.
