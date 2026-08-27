# Proposal: complete the Project Hub recovery loop

> Status: DRAFT — awaiting principal review
> Scope: proposed foundation gate for S02–S08 over the shipped S01 recovery snapshot
> Out of scope: new project identity, new task store, autonomous knowledge promotion, external tracker federation

## Why

1. `project-hub-recovery/v1` can show current state and a bounded next action, but it cannot yet produce a safe context bundle that a fresh Agent can execute.
2. Project evidence is still retrieved through separate surfaces, so a recovery action cannot prove that its context and citations came from the same Project snapshot.
3. Selecting a next action does not yet create or resume a governed Work Run with replay protection and an auditable receipt.
4. Agent output is not yet routed end to end through the four Run Output Classes and Promotion Policy.
5. The complete journey is not yet available and acceptance-tested through the Obsidian-first surface, MCP, and CLI.

## What Changes

### Add

- A versioned, bounded resumable-context result with deterministic selection, fingerprints, citations, checkpoints, reviewed decisions, explicit prerequisites, and failure diagnostics.
- Project-scoped cited retrieval normalized through existing Knowledge, Work-OS, Project Memory, Session Record, and Work Run owners.
- An additive action-candidate set plus read-only plan and Workflow-owned apply operations that bind one current snapshot, context bundle, evidence set, candidate, transition token, and Work Run receipt without changing S01.
- Versioned classification and governance routing for view, work-state transition, knowledge claim, and external side-effect outputs.
- An Obsidian Project Hub recovery journey and a sanitized cross-surface acceptance fixture.

### Modify

- Project Hub shared TypeScript domain and operation registration.
- Workflow and Project Memory read boundaries only where a missing read contract is required.
- Obsidian, MCP, and CLI adapters to consume shared contracts without owning semantics.
- Work-OS delivery issues S02–S08 with verification evidence after each slice.

## Priority decision required

The parent brief currently labels Project-scoped retrieval, Agent output landing, progress refresh, and cross-surface parity as P1. This proposal promotes only the portions required to prove the interrupted-work recovery loop into the foundation exit gate. Phase 0 must explicitly approve that promotion and update the parent requirement table before S02/S03 become executable; it is not a status-only edit.

## Capabilities

### New

- `project-hub-resume-context`
- `project-scoped-cited-retrieval`
- `project-hub-governed-action`
- `agent-output-governance`
- `project-recovery-acceptance`

### Modified

- `project-hub`: compose and expose recovery data without acquiring write authority.
- `workflow`: expose authoritative Work Run and checkpoint reads and execute approved replay-safe transitions.
- `project-memory`: expose reviewed claims and Session Record metadata without returning raw private transcripts.

## Impact

- Add: shared contracts, resolver/search/action modules, sanitized fixtures, Obsidian recovery view, adapter parity tests.
- Modify: Project Hub operation wiring, Workflow and Project Memory read ports, plugin/MCP/CLI adapters, Work-OS issue evidence.
- Dependencies: no new runtime dependency and no required Python worker.
- Migration: additive versioned contracts; existing `project.hub.get` and `project-hub-recovery/v1` remain readable.
- Rollback: disable new action and surface registrations while retaining read-only S01 snapshots and durable Work Run receipts.