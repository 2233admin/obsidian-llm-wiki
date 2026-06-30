---
type: issue
entity: project/obsidian-llm-wiki/issue/integrate-agent-workflow-intake
state: done
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/integrate-agent-workflow-intake
description: Document Claude Code and Codex external workflow intake
status: active
priority: 2
blocked-by: []
assignee: codex
last-verified: 2026-06-30
---

Document Claude Code and Codex external workflow intake

## Context

External repositories, toolchains, skill packs, and workflow runtimes need one
obsidian-llm-wiki intake path so Claude Code and Codex do not fork the memory workflow.

## Acceptance

- `docs/AGENT_WORKFLOW_INTEGRATION.md` defines the host-neutral intake contract.
- `CLAUDE.md` links the contract for Claude Code.
- `AGENTS.md` links the contract for Codex.
- `docs/INGEST.md` documents external repo URL registration and Phase 1 local
  path limits.
- `docs/MEMORY_GOVERNANCE.md` documents draft, review, and promotion boundaries.
- `docs/LOCAL_PROJECTS.md` routes executable work to
  `01-Projects/<project>/issues/` and rejects the retired docket path.

## Verification

- Content check passed for `source.register`, `repoPath`, `01-Projects`,
  `00-Inbox/AI-Output`, docket retirement, Claude/Codex entrypoints, and the
  LazyCodex example.
- Markdown fence balance check passed for the touched Markdown files.

