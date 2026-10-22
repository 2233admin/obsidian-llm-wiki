# ADR 0003 — Workflow Read Runtime Projection

> **Status:** accepted  
> **Date:** 2026-09-01  
> **Deciders:** product owner  
> **Decision target:** Make Workflow the single semantic read seam for Work Run runtime state while preserving the Project Hub contract.

---

## Context

Project Hub currently interprets Work Run JSON, expiry aliases, workflow status, and runtime file discovery while Workflow already owns Work Run reads, checkpoint parsing, fingerprints, and drift-sensitive validation. Keeping two readers causes the same vault state to acquire different meanings, especially for legacy aliases, malformed records, nested runtime files, and expiry at request time.

The change must preserve the existing Project Hub `sections.runtime` shape and semantics. It must also remain safe for read-only callers: runtime records may contain malformed or stale input, and citations must stay vault-relative without exposing tokens, prompts, transcripts, or private paths.

## Decision

### D1. Extend the existing `WorkflowReadModel`

The existing `WorkflowReadModel` is extended with one public method:

```ts
readRuntimeProjection(projectId: string, observedAt?: number): NormalizedWorkRunProjection;
```

No second public reader module, Work Run store, or Hub-owned semantic parser is introduced. Workflow owns the interpretation of Work Run runtime state, including:

- canonical and legacy field aliases and conflict diagnostics;
- Work Run validation and malformed-record diagnostics;
- expiry and stale classification;
- checkpoint parsing, checkpoint-set fingerprints, and drift;
- recursive runtime discovery and vault-relative source citations;
- workflow status and agent-state file reads needed by the runtime section.

### D2. Return a fully evaluated request-local projection

The projection is evaluated for the request and is not backed by a cross-request cache. `observedAt` is explicit so expiry and stale classification are deterministic in tests and callers can choose the observation instant. When omitted, the implementation may use the current time at the request boundary.

The public projection records are:

```ts
interface NormalizedWorkRunRuntime {
  readonly projectId: string;
  readonly workRunId: string | null;
  readonly workItemId: string | null;
  readonly state: string | null;
  readonly stage: string | null;
  readonly resumable: boolean;
  readonly path: string;
  readonly stale: boolean;
  readonly citationTargets: readonly string[];
}

interface NormalizedWorkRunProjection {
  readonly activeRuns: readonly NormalizedWorkRunRuntime[];
  readonly staleRuns: readonly NormalizedWorkRunRuntime[];
  readonly runCount: number;
  readonly agentStateFiles: readonly string[];
  readonly workflowState: {
    readonly stage: string;
    readonly objective: string;
    readonly path: string;
  } | null;
  readonly stage: string | null;
  readonly stageCitation: string | null;
  readonly sourceFiles: readonly string[];
  readonly drift: readonly string[];
}
```

Arrays and nested records are returned as new values for each call. Runtime run collections preserve the existing Project Hub lexical path order because it also determines staged-run fallback; source files and citations remain deterministic. Callers cannot mutate one projection and affect a later request.

### D3. Preserve the Project Hub output contract

Project Hub remains a read-only composition surface. Its runtime section keeps the current fields, meanings, active-state set, stale behavior, resumability value, freshness inputs, citation format, health calculation, ordering, and diagnostic strings. After the cutover, Hub maps the Workflow projection into that existing section and does not retain a duplicate Work Run JSON parser.

### D4. Discover runtime files recursively with explicit exclusions

Workflow walks the Work-OS project `runs` root recursively and includes readable JSON files. Internal `output-*` and `recovery-*` trees are excluded from the projection and its source citations. A readable JSON file below a direct `runs/` child is not silently discarded: it remains available as a normalized record and contributes a deterministic `run_noncanonical_path:<vault-relative-path>` drift entry.

All source files and citation targets are vault-relative, deterministic, and filtered through the existing safe-read rules.

## D5. Preserve compatibility and make malformed state visible

Canonical fields take precedence when only one representation is present. Legacy aliases remain readable. When canonical and legacy values conflict, the projection records explicit drift rather than silently choosing an ambiguous value. Malformed JSON, missing project IDs, and project-mismatched records remain visible through drift but are omitted from `activeRuns`, `staleRuns`, and `runCount`, matching the existing Project Hub contract. Valid JSON arrays and non-null scalar values enter the same alias lookup as the prior Hub parser and therefore report `run_project_id_missing:<path>`; JSON `null` still dereferences during that lookup and is reported as `malformed_run:<path>`. Valid-project records with invalid Work Run or Work Item IDs remain represented with null invalid identifiers and are non-resumable. Invalid expiry is distinct from an expired valid timestamp.

Workflow status parsing preserves the existing `malformed_workflow_state`, `stage`, and `stageCitation` behavior. If workflow status is unavailable, a resumable staged run remains the fallback for `stage` and `stageCitation`.

## Contract and verification

Task 1 freezes this decision with deterministic fixtures for normal, legacy, malformed, canonical/legacy conflict, project mismatch, invalid expiry, nested, and excluded runtime files. Focused contract assertions cover active and stale runs, aliases, run count, agent files, workflow state, stage citations, source files, drift, explicit observation time, ordering, and request-local immutability. Representative Project Hub assertions cover normal completed, legacy alias, and malformed/drift cases.

The Task 1 projection assertions intentionally fail until `readRuntimeProjection` is implemented. Existing Workflow and Project Hub tests remain the compatibility baseline and must continue to pass.

## Consequences

- Workflow becomes the single semantic owner for Work Run runtime reads.
- Project Hub has one thinner mapping boundary and one stable output contract.
- Legacy and malformed vault data remains observable through diagnostics instead of producing divergent interpretations.
- Tests must pass an explicit observation time whenever expiry behavior is under assertion.
- The implementation must preserve the current public Hub shape while moving interpretation behind the Workflow seam.
