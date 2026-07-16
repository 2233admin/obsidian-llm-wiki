---
type: issue
entity: project/obsidian-llm-wiki/issue/gitea-federation-adapter
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/gitea-federation-adapter
description: Federate gitea issues and work-OS as parallel, non-conflicting registrations (Task 9 gap)
status: active
priority: 3
blocked-by: []
last-verified: 2026-07-12
---

Federate gitea issues and work-OS as parallel, non-conflicting registrations

## Context

Wayfinder's rhizome+memex fleet-pilot map (obsidian-llm-wiki gitea issue #39,
https://git.xart.top:8418/Curry/obsidian-llm-wiki/issues/39, tickets #40-45) lives
on gitea's generic issue tracker with zero connection to this project's own
work-OS (`01-Projects/<project>/issues/`). Real friction from actually
running the wayfinder map is the spec input here, not a speculative design.

Gitea's issue system and this project's work-OS are **parallel** registrations
of the same project, not a truth-vs-projection hierarchy -- a project can
legitimately exist in both systems at once, and that's not a conflict. The
wayfinder map is the pilot case to federate first.

## Acceptance

- A gitea adapter (new, alongside the existing MCP `adapters/` layer) links a
  work-OS issue and its gitea counterpart, proven against the wayfinder map
  (obsidian-llm-wiki issue #39 and children) as the pilot instance.
- Both directions (work-OS -> gitea, gitea -> work-OS) are legitimate; landing
  one side first is a sequencing choice for this ticket, not a permanent
  restriction on the other.
- Conflict handling (same issue changed on both sides between syncs) is a
  real question this ticket must answer, not one it can duck by declaring
  one side authoritative.
- No new daemon: adapter runs at scan/CLI time only (Task 8 §0#8 / Task 9
  §0#13 carry over).
- Existing work-OS regression suite (`compiler/tests/test_work_os.py`,
  `mcp-server/src/project/parity.test.ts`) stays green; no change to
  `SNAPSHOT_FIELDS` or the shipped Task 8 schema.
