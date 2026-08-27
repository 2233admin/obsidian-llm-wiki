---
status: accepted
date: 2026-08-28
---

# Replace Recovery Snapshot v1 with Stateless Recovery Flow v2

Project Hub recovery needs user-supplied search, candidate choice, exact Project Agent Binding selection, and a five-minute plan. Those facts do not coexist when the Hub first opens, so treating the complete journey as one snapshot is misleading. We will clean-cut over from `project-hub-recovery/v1` to the read-only `project-hub-recovery-flow/v2`, exposed by `project.hub.recovery.flow` as stateless staged requests. The stages are `open`, `searched`, `needs-agent-selection`, `planned`, `stale`, and `unavailable`; every stage uses a chained Flow Fingerprint plus the exact owner locks it read.

## Considered Options

- Keep `Recovery Snapshot v1` and add downstream operations: rejected because the approved product contract requires one coherent interaction vocabulary rather than a snapshot plus an implicit client workflow.
- Put the whole journey in one response: rejected because search is query-dependent, planning is selection-dependent, and cumulative context/search/plan payloads are large and short-lived.
- Persist a server-side recovery session: rejected because Project Hub is a derived read model and must not become a second workflow state store.

## Consequences

`project.hub.get` remains ordinary Hub composition and loses its v1 `recovery` field when the complete V2 read path lands. `project.hub.recovery.flow` advances through closed `open|search|plan|refresh-plan|restart` request actions, returns only the current stage payload plus upstream summaries and locks, and stops at an immutable Recovery Plan. Search is mandatory and repeatable. A searched response may supply a closed recommended next request; automatic planning is allowed only when exactly one compatible Binding exists. Apply remains the separate Workflow-owned mutation. The completed S01 v1 issue stays historical; a new S01B contract-kernel issue precedes S02, and the clean cutover occurs when S04A finishes the complete read-only Flow.

Because no Flow response is stored, each later request repeats the minimum normalized inputs needed to recompute and verify its prior stage. Search-to-plan repeats query/limit/candidate/Binding inputs; Plan refresh and candidate override additionally submit the complete prior Plan so its original time-bound bytes can be validated. This cost is accepted to avoid a server session/cache and to prevent clients from mixing unrelated Flow branches.

Flow Fingerprints hash a non-self-referential intrinsic stage projection. Root-open convenience fields and exact next requests are derived only after hashing from fingerprint-free request intents; stale restart carries a finite stale proof rather than a nested response.