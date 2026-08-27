---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s02-resumable-agent-context
state: backlog
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s02-resumable-agent-context
description: "P0 S02: compose Recovery Flow open stage with bounded resumable context"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s01b-project-hub-recovery-flow-v2
last-verified: 2026-08-28
---

# P0 S02: Recovery Flow open context

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Tasks 3–5

## What to build

Extract Workflow Work Run store/read seams and implement the V2 `open` stage. Compose current Project/work recovery facts with bounded authoritative Work Run or Session context, reviewed decisions, checkpoints, prerequisites, capability summary, citations, suggested queries, owner locks, omissions, and the root Flow Fingerprint. Do not expose candidates or a Plan before mandatory search.

## Acceptance

- [ ] Work Run identity/lifecycle comes from durable Workflow records; checkpoint summary/evidence comes from matching agent event records.
- [ ] Open selects current Work Run context before safe Session fallback and never treats raw Session evidence as Project truth.
- [ ] The open payload keeps V1-equivalent Project/stage/work-group/freshness/diagnostic/citation behavior while adding bounded context and suggested queries.
- [ ] Context retains at most 32 reviewed decisions, 32 checkpoints, 64 citations, 16 prerequisites, and 32 diagnostics within 64 KiB canonical JSON; mandatory safety data is allocated first.
- [ ] Owner locks are exact and ordered; unrelated owner changes do not falsely change the action-relevant recovery fingerprint.
- [ ] Unsafe identity/mandatory facts make the stage unavailable; unsafe optional values are omitted with bounded diagnostics and no echo.
- [ ] The issue registers no public partial V2 Operation and performs no mutation.

## Demo

Compose open for one resumable Work Run, one Session fallback, and one unsafe/oversized owner case; show bounded context and a stable root Flow Fingerprint without changing vault bytes.

## Dependencies

Blocked by reviewed S01B contract kernel. S03 consumes the Workflow read model and open-stage fingerprint from this issue.

## Non-goals

- Do not perform search, derive candidates, select a Binding, generate a Plan, apply Workflow, or remove V1.