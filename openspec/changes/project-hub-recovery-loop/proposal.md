# Proposal: complete interrupted-work recovery with Recovery Flow v2

> Status: APPROVED DESIGN — implementation remains gated by reviewed Work-OS leaves
> Scope: Foundation gate for S01B–S08; S01 v1 remains completed history
> Out of scope: server-side recovery sessions, a second Project/task store, autonomous knowledge promotion, external tracker federation

## Why

`project-hub-recovery/v1` is a useful open-time read model, but the complete recovery journey is not a snapshot. Search depends on a user query, action planning depends on a candidate and exact Project Agent Binding revision, and a plan expires after five minutes. Keeping those steps as loosely related downstream calls would leave the client to invent a workflow and its own state semantics.

The product instead needs one stateless, staged Recovery Flow vocabulary that:

1. opens current Project recovery facts and bounded resumable context;
2. performs mandatory, repeatable, Project-scoped cited search;
3. derives safe candidates and exact Binding eligibility;
4. produces an immutable plan only from current locks;
5. stops before mutation and hands the full plan to Workflow apply;
6. routes completed Work Run output through replay-safe governance.

## What changes

### Replace

- Clean-cut over from `project-hub-recovery/v1` to `project-hub-recovery-flow/v2` when S04A completes the full read-only path.
- Remove the old `recovery` field from `project.hub.get`; that operation remains ordinary read-only Hub composition.
- Add the read-only `project.hub.recovery.flow` operation with closed request actions `open|search|plan|refresh-plan|restart` and response stages `open|searched|needs-agent-selection|planned|stale|unavailable`.

### Add

- S01B: the complete internal V2 request/response, stage, owner-lock, chained-fingerprint, validation, and reducer contract. It is not registered publicly until every read stage exists.
- S02: bounded authoritative context and Workflow read/store seams used by the V2 open stage.
- S03: mandatory, repeatable Project-scoped cited search. Each query branches from the current open/context basis and receives its own fingerprint.
- S04A: candidates, Binding eligibility, immutable plans, the complete Flow operation, caller migration, and v1 removal.
- S04B: Workflow-owned, claim-first resume/create apply with authenticated runtime actor identity and crash recovery.
- S05: closed output submission/quarantine plus claim-first owner routing at `workflow.agent.leave`.
- S06A/S06B: the Ask Mate Project-context preview and apply/receipt journey with no plugin-persisted Flow state.
- S07/S08: MCP/CLI parity and sanitized end-to-end acceptance.

## Approved interaction rules

- Responses carry the current stage payload plus upstream summaries, exact locks, and a chained Flow Fingerprint; they do not cumulatively copy prior large payloads.
- No server-side Flow state or cache exists. A later request repeats the minimum normalized inputs needed to recompute and verify its prior stage. Plan refresh and candidate override submit the complete prior Plan.
- Search is mandatory and may be repeated. Only the search branch actually used can feed the Plan.
- A searched response returns a closed recommended next request. Automatic planning is eligible only when exactly one current compatible Binding exists; otherwise the Flow returns `needs-agent-selection`.
- The user may replace the recommended candidate. Every replacement produces a new immutable Plan and Flow Fingerprint.
- Expired Plans require explicit `refresh-plan`; the UI never silently substitutes a new Plan.
- `project.hub.recovery.flow` stops at `planned`. Mutation remains `workflow.recovery.apply`.

## Priority

The recovery-required portions of cited retrieval, output landing, progress refresh, and MCP/CLI parity are promoted into the Foundation exit gate. Generic search expansion, generic dashboards, adapters, Fleet features, and external projections remain outside this change.

## Migration and rollback

The read-only implementation develops behind internal V2 contracts through S01B–S04A. S04A registers the complete Flow, migrates every repository caller/fixture/doc, removes the v1 type/validator/export and `project.hub.get.recovery`, and lands as one clean cutover. There is no dual-version shim. Rollback means reverting the cutover commit/release, not maintaining both contracts.

No new runtime dependency or required Python worker is added. Existing durable Work Run records keep their cross-runtime field shape.