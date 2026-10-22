---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s07-mcp-cli-parity
state: done
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s07-mcp-cli-parity
description: "P0 S07: expose Recovery Flow v2 and Workflow apply through MCP and CLI parity"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s06b-obsidian-recovery-action
last-verified: 2026-08-29
---

# P0 S07: MCP and dedicated CLI parity

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Task 15

## What to build

Expose Flow actions `open|search|plan|refresh-plan|restart` and Workflow apply through MCP and a dedicated CLI by invoking the same shared Operations used by Obsidian. Keep parsing/formatting/errors at adapter boundaries and keep all stage, recommendation, recomputation, refresh, and claim semantics in domain/Workflow modules.

- [x] Domain, MCP, and CLI return equivalent response stages, Flow/Plan fingerprints, owner locks, recommended next requests, reasons, citations, diagnostics, apply states, and receipts on the same fixture.
- [x] CLI supports `open|search|plan|refresh-plan|restart|apply`; complete prior Plan/stale response/apply objects use JSON input files rather than argv.
- [x] Claim files remain internal Workflow storage and are not read directly by adapters.
- [x] Project ID remains identity; local vault/workspace path is an adapter argument only.
- [x] Protocol-specific errors redact stacks, credentials, raw query/private transcript content, and absolute paths.
- [x] Read-only Flow actions remain distinct from Workflow apply.
- [x] MCP/CLI do not become the reference surface and start only after accepted S06B actual-Obsidian proof.

## Verification evidence — 2026-08-29

- `npm exec bun -- test src/project-hub/cli.test.ts src/project-hub/parity.test.ts src/project-hub/recovery-loop.e2e.test.ts` — 8 passed, 0 failed.
- `npm run typecheck` and `npm run rebuild` passed; `recovery-flow-cli.js` is included in the package bin/files and both setup launchers copy it.
- Built CLI smoke passed against the sanitized `.gstack/qa-vault`: `open` returned `open`, `search` returned cited `searched`, and `plan` returned an immutable `planned` response with fingerprints and owner locks.
- Parity test invokes the same `project.hub.recovery.flow` Operation through the dispatcher used by MCP and the dedicated CLI; no claim-file reads or adapter state were added.

## Dependencies

Blocked by accepted S06B actual-Obsidian verification.

## Non-goals

- Do not add adapter-owned state machines, direct claim storage reads, server Flow sessions, or copied validators.