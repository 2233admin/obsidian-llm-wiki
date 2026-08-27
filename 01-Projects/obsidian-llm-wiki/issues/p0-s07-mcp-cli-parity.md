---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s07-mcp-cli-parity
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s07-mcp-cli-parity
description: "P0 S07: expose the same Project Hub recovery contract through MCP and CLI"
status: active
priority: 2
blocked-by:
  - obsidian-llm-wiki/p0-s01-project-hub-recovery-snapshot
  - obsidian-llm-wiki/p0-s04b-workflow-recovery-apply
  - obsidian-llm-wiki/p0-s05-agent-output-governance
  - obsidian-llm-wiki/p0-s06b-obsidian-recovery-action
last-verified: 2026-08-27
---

# P0 S07: MCP and CLI parity

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Task 13

## What to build

Expose the same Project Hub recovery snapshot and governed next-action operation through MCP and CLI. Protocol formatting, argument parsing, and transport errors stay in their adapters; domain semantics, citations, freshness, action policy, and receipts remain shared with Obsidian.

## Acceptance

- [ ] MCP and CLI return the same versioned recovery snapshot fields, diagnostics, citations, freshness states, and next-action candidates as the shared domain operation.
- [ ] MCP and CLI accept Project ID and Work Run identifiers without treating machine-local paths as project identity.
- [ ] Resume or action requests use the same transition context and governance checks as the Obsidian path.
- [ ] Protocol-specific errors are formatted at the adapter boundary without leaking stacks, secrets, or private transcript content.
- [ ] Read-only inspection is distinct from mutating or external-side-effect operations.
- [ ] Contract parity tests compare MCP, CLI, and domain outputs on the same sanitized fixture.

## Demo

Run the same project recovery query from Obsidian, MCP, and CLI and compare the snapshot fingerprint; submit the same governed next action and receive equivalent receipts or equivalent failure diagnostics.

## Dependencies

Blocked by S04B, S05, and accepted S06B actual-Obsidian verification. MCP/CLI may not become the reference surface before the human journey is proven.
