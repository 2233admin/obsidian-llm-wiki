---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s08-recovery-loop-acceptance
state: backlog
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/p0-s08-recovery-loop-acceptance
description: "P0 S08: verify Recovery Flow v2 cutover, failures, parity, privacy, and timing"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s07-mcp-cli-parity
last-verified: 2026-08-28
---

# P0 S08: Recovery Flow v2 Foundation acceptance

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]
OpenSpec: `openspec/changes/project-hub-recovery-loop/`
Implementation plan: `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md` Task 16

## What to build

Create one sanitized end-to-end fixture and actual-Obsidian procedure covering V1 removal, all V2 Flow actions/stages, stateless recomputation, repeated search branches, Binding/candidate/Plan decisions, explicit refresh, Workflow apply, output routing, parity, privacy canaries, failure/replay paths, and the under-60-second Plan-preview target.

## Acceptance

- [ ] V1 production schema/types/validator/export/file and `project.hub.get.recovery` are absent; V1 historical issue/ADR prose remains.
- [ ] Fixture includes every owner, Work Run/events, unique/multiple/no compatible Bindings, reviewed/draft memory, repeated queries, alternate candidates, capabilities, claims, outputs, and canaries.
- [ ] All five request actions and six response stages pass; minimal-input prerequisite recomputation rejects branch mixing and full-prior-Plan refresh/override works.
- [ ] Search is mandatory/repeatable; auto-plan eligibility uses exactly one Binding; multiple Binding, candidate override, expired Plan, explicit refresh, stale restart, and unavailable remediation are observable.
- [ ] Apply/output same-token replay, both claim races, every crash window, and outcome-unknown preserve exactly one Work Run and at most one owner effect.
- [ ] Obsidian, MCP, and CLI agree on Flow/Plan fingerprints, locks, stages, recommendations, apply state, and receipts.
- [ ] ItemView reload persists no Flow state and no serialized surface contains canaries, credentials, transcript bodies, unsafe query material, or absolute paths.
- [ ] After one familiarization, three actual-Obsidian runs from Open Project Hub invocation to cited immutable Plan preview are each under 60 seconds with raw timings.
- [ ] Any failure creates a linked follow-up and leaves S08/Foundation incomplete.

## Demo

Recover a deliberately interrupted sanitized Project end to end, repeat and mix searches, exercise Binding/candidate/refresh/stale/unavailable paths, confirm one Plan, route output, verify parity and privacy, then record three timing runs.

## Dependencies

Blocked by S07 parity. This is the final Foundation gate.

## Non-goals

- Do not waive pre-existing failures, retain V1 compatibility, or declare Foundation complete from automated tests alone without actual Obsidian evidence.