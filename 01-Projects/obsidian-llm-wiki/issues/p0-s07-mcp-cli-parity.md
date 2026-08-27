---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s07-mcp-cli-parity
state: backlog
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s07-mcp-cli-parity
description: "P0 S07: expose Recovery Flow v2 and Workflow apply through MCP and CLI parity"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s06b-obsidian-recovery-action
last-verified: 2026-08-28
---

# P0 S07: MCP and dedicated CLI parity

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Task 15

## What to build

Expose Flow actions `open|search|plan|refresh-plan|restart` and Workflow apply through MCP and a dedicated CLI by invoking the same shared Operations used by Obsidian. Keep parsing/formatting/errors at adapter boundaries and keep all stage, recommendation, recomputation, refresh, and claim semantics in domain/Workflow modules.

## Acceptance

- [ ] Domain, MCP, and CLI return equivalent response stages, Flow/Plan fingerprints, owner locks, recommended next requests, reasons, citations, diagnostics, apply states, and receipts on the same fixture.
- [ ] CLI supports `open|search|plan|refresh-plan|restart|apply`; complete prior Plan/stale/apply objects use JSON input files rather than argv.
- [ ] Claim files remain internal Workflow storage and are not read directly by adapters.
- [ ] Project ID remains identity; local vault/workspace path is an adapter argument only.
- [ ] Protocol-specific errors redact stacks, credentials, raw query/private transcript content, and absolute paths.
- [ ] Read-only Flow actions remain distinct from Workflow apply.
- [ ] MCP/CLI do not become the reference surface and start only after accepted S06B actual-Obsidian proof.

## Demo

Execute open→search→plan and apply against the same sanitized Project through domain, MCP, and CLI; compare fingerprints and receipt semantics, then exercise stale restart and explicit refresh.

## Dependencies

Blocked by accepted S06B actual-Obsidian verification.

## Non-goals

- Do not add adapter-owned state machines, direct claim storage reads, server Flow sessions, or copied validators.