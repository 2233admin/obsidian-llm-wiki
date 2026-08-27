---
type: issue
entity: project/obsidian-llm-wiki/issue/p0-s02-resumable-agent-context
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/p0-s02-resumable-agent-context
description: "P0 S02: build a safe resumable Agent context bundle for an active project"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s01-project-hub-recovery-snapshot
last-verified: 2026-08-27
---

# P0 S02: resumable Agent context

Parent brief: [[llmwiki-project-driven-knowledge-workspace]]

## What to build

From a Project Hub recovery snapshot, resolve the latest valid resumable Work Run or Session Record into a bounded context bundle. The bundle must carry the stable Project ID, Work Item ID, Work Run ID, current task state, reviewed decisions, relevant citations, recent checkpoints, and explicit missing prerequisites without treating raw session output as project truth.

## Acceptance

- [ ] A versioned context-bundle contract identifies Project ID, Work Item ID, nullable Work Run ID, nullable source Session Record, owner locks, freshness, citations, and resume prerequisites.
- [ ] Selecting a valid resumable run returns enough context for a new Agent session to continue without replaying the full transcript.
- [ ] Missing, expired, stale, or incompatible runs return an explained non-resumable result and a manual next action.
- [ ] Session-derived claims remain draft or evidence until the owning Promotion Policy accepts them.
- [ ] Private transcript content, cookies, tokens, and machine-local paths are excluded from persisted or returned context.
- [ ] Repeated resolution of the same inputs yields the same bundle fingerprint.

## Implementation contract

- Add the read-only `project.hub.resume-context.get` operation. It accepts a Project reference, the current recovery snapshot fingerprint, and an optional Work Run ID. It rejects stale S01-projected facts and separately rejects changed owner locks instead of overclaiming snapshot staleness.
- Keep the closed, versioned, JSON-safe bundle contract in `mcp-server/src/project-hub/resume-context.ts`. Implement the exact field table, nullability, enums, bounds, comparators, byte-allocation order, safe normalization, and fingerprint rules in `openspec/changes/project-hub-recovery-loop/design.md` D3–D6; do not create compatibility aliases.
- Resolve Work Item state and blockers through Work-OS. Resolve Work Run identity/lifecycle and checkpoints through Workflow durable run records. Resolve reviewed decisions through Project Memory and Session identity/metadata through the Session Record boundary. The resolver must not treat the recovery projection or Work-OS issue files as Work Run authority.
- Select deterministically: an explicitly requested valid run first; otherwise the recovery snapshot's recommended resumable run; otherwise the latest valid Session Record. Use the normative comparator in OpenSpec D4. An invalid explicit run never falls through.
- Return a discriminated result: `resumable` carries the bounded context bundle; `not-resumable` carries one enumerated reason code, diagnostics, citations, and one manual next action. Missing, stale, expired, malformed, mismatched, incompatible, unsafe, or oversized input never falls back silently.
- Reject unsafe caller fields without echo. Omit unsafe optional owner values with a stable diagnostic; unsafe mandatory identity/safety values make the result unavailable. Fingerprint only the normalized safe result.
- Add contract tests in `mcp-server/src/project-hub/resume-context.test.ts` and operation tests in `mcp-server/src/project/project-hub.test.ts`. Cover the OpenSpec R1–R4 scenarios, including exact owner-lock invalidation, null-versus-omitted validation, deterministic truncation, mandatory-envelope overflow, and value-based secret/transcript/path canaries.

### Owning code boundaries

- Unchanged S01 recovery contract: `mcp-server/src/project-hub/recovery.ts`; S02 must not edit it.
- New S02 selection, closed schema, safe normalization, and fingerprint: `mcp-server/src/project-hub/resume-context.ts`
- Project Hub operation wiring: `mcp-server/src/project/project-hub.ts`
- Reviewed memory and Session Records: `mcp-server/src/project-memory/**` through `createDurableProjectMemorySource`
- Work Run and checkpoint authority: `mcp-server/src/workflow/workflow.ts`
- Tests: `mcp-server/src/project-hub/resume-context.test.ts` and `mcp-server/src/project/project-hub.test.ts`

### Non-goals

- Do not resume or create a Work Run; S04 owns mutation.
- Do not add MCP- or CLI-specific formatting; S07 owns adapter parity.
- Do not persist a second context store or copy raw Session evidence into Work-OS or Project Memory.

## Demo

Select the latest resumable Work Run in a sanitized project and receive a compact, cited context bundle plus the exact next action; select an expired run and see a deterministic remediation instead.

## Dependencies

Blocked by S01 because the bundle is selected from the Project Hub recovery snapshot.
