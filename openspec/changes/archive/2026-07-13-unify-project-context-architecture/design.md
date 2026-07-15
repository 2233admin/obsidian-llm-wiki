## Context

The repository already contains the right primitives, but they are not one contract. Python workspace discovery treats `project/<slug>` as logical identity, stores shared project records in `Projects/<slug>.md`, and keeps machine paths in `.vault-mind/local-bindings.json`. TypeScript Work-OS and workflow operations use `01-Projects/<project>/`; source and context operations use `10-Projects/<project>/`; older operations and tests still derive identity from paths or write incompatible `Projects/` records. Python leasing and TypeScript workflow checkpoints also describe different halves of a Work Run without sharing an identifier.

The optimization is therefore boundary repair, not a new project application or a merged mega-record. Each domain keeps its own truth, and Project ID becomes the explicit join key.

## Goals / Non-Goals

**Goals:**

- Make `project/<slug>` the stable cross-runtime identity and accept display names or paths only at compatibility boundaries.
- Reuse the existing shared project record and machine-local binding mechanisms.
- Preserve separate registry, Work-OS, and knowledge roots while making their relationship deterministic.
- Give callers one Project Context Resolver and one read-only Project Hub.
- Give Python selection/leasing and TypeScript agent workflow one Work Run identity and lifecycle.
- Migrate with characterization tests, dry-run plans, conflict reporting, canonical writes, and rollback evidence.

**Non-Goals:**

- Building the Obsidian Project Hub or settings UI in this change.
- Moving every project-related file into one directory or one database.
- Making a repository, GitHub Project, board, or local directory authoritative for Project identity.
- Replacing gstack, external issue trackers, or provider-owned workflow state.
- Adding a daemon, mandatory remote service, embeddings, or a new dependency.

## Decisions

### 1. Extend the existing Project Registry contract

The shared `Projects/<slug>.md` record carries logical identity and lifecycle only. Its canonical `entity` is the Project ID (`project/<slug>`). The existing `.vault-mind/local-bindings.json` remains the only store for machine-local absolute paths. A derived JSON index may accelerate lookup later, but it cannot become a second source of truth.

Alternative considered: create a new project database or `_llmwiki/project-registry.json` as authority. Rejected because it would duplicate a working vault-first identity model and create the fourth representation this change is intended to eliminate.

### 2. Keep domain roots separate and join them explicitly

- `Projects/<slug>.md` owns registry identity and project lifecycle.
- `01-Projects/<slug>/` owns current Work-OS intent, issues, workflow state, and durable Work Run summaries.
- `10-Projects/<slug>/` owns project-scoped sources, memory, evidence, and analysis.
- `.vault-mind/` owns device-local paths, leases, and rebuildable runtime state.

Records in the first three roots SHALL carry or resolve to the same Project ID. Code must use a shared `ProjectRef`/resolver instead of constructing roots from an unvalidated `project` string.

Alternative considered: merge all roots under `01-Projects`. Rejected because work state, durable knowledge, logical identity, and device-local runtime have different authority and retention rules.

### 3. Add one Project Context Resolver

All MCP and compiler entry points normalize external references to a Project ID before domain work. Resolution order is exact Project ID, registered alias/slug, bound workspace path, then explicit not-found or ambiguity. Ambiguous references never select the first match. Compatibility fields remain at public boundaries during migration, but internal functions accept `ProjectId` or `ProjectContext`.

The resolver returns identity, lifecycle, vault domain roots, optional local workspace binding, external projection descriptors, and diagnostics. It never returns secret values.

### 4. Make Project Hub a read-only composition

`project.hub.get` assembles intent, Work Items, knowledge currency, active Work Runs, workspace health, effective Settings Snapshot metadata, Capability Health, and integration drift. Every field identifies its owning domain and freshness. Mutations are routed to that domain's operation; no `project.hub.update` operation is introduced.

This supersedes the older idea of storing a machine path or copied workflow state in a Project Hub note. A rendered note remains a disposable human-facing view.

### 5. Unify execution around Work Run

The Python Work Driver remains responsible for deterministic next-work selection and lease acquisition. Once claimed, it creates a Work Run ID and durable run record under the Work-OS project. TypeScript `agent.join`, step, checkpoint, leave, and doctor operations attach to that same Work Run ID. Machine-local lease tokens remain in `.vault-mind/_leases.json`; durable state and outputs use the Project ID and Work Run ID.

The lifecycle is `planned -> leased -> running -> awaiting_review|completed|failed|cancelled`. Repeated commands with the same transition token are idempotent. Run Output Class and Promotion Policy remain the authority for writes and external side effects.

Alternative considered: replace Python with TypeScript immediately. Rejected because language consolidation does not solve the missing domain contract and creates unnecessary migration risk.

### 6. Migrate by compatibility, not a flag day

New code writes Project IDs and canonical domain paths only. Reads temporarily recognize legacy `project` strings and incompatible `Projects/` records, but emit diagnostics. A migration planner inventories records, proposes mappings, hashes affected files, and refuses ambiguous or conflicting changes. Apply writes through Operation Write Policy, records audit evidence, and never revives `10-Projects/*/docket/**` as current work.

## Risks / Trade-offs

- [Slug collisions or renamed projects] -> Resolve through explicit aliases and conflict reports; never infer through path basename alone.
- [Dual-read hides incomplete migration] -> Attach compatibility diagnostics and counters to resolver and doctor output, then remove readers only after zero-use release evidence.
- [Cross-language state drift] -> Define shared fixtures for Project ID, resolver results, Work Run transitions, and lease/run joins; run them in both Python and TypeScript tests.
- [Project Hub becomes another writable truth] -> Expose read operations only and include owner/freshness metadata for every section.
- [Partial migration corrupts links] -> Default to dry-run, hash preconditions, atomic per-file writes, audit manifests, and resumable batches.
- [More explicit identifiers add call-site friction] -> Keep compatibility normalization at public boundaries and make internal types reject bare strings.

## Migration Plan

1. Add regression fixtures that lock current `Projects/`, `01-Projects/`, `10-Projects/`, resolver, Work Driver, workflow, and recall behavior.
2. Extract shared Project ID parsing and Project Context resolution in TypeScript and Python, backed by identical conformance fixtures.
3. Make Project Registry reads understand existing shared project records and make all new project/domain records carry Project ID.
4. Add inventory and dry-run migration operations; ship diagnostics before changing writes.
5. Switch project, workflow, source, context, and Work Driver writes to canonical domain paths while retaining compatibility reads.
6. Introduce Work Run records and join Python leases to TypeScript agent lifecycle through Work Run ID.
7. Add Project Hub read model and health/drift reporting.
8. Migrate unambiguous records in audited batches; quarantine conflicts for review.
9. Remove retired docket write permission and deprecate path-derived `vault.project` behavior.
10. Remove compatibility reads only after doctor reports no remaining usage across a release window.

Rollback restores files from the migration manifest, retains aliases, and re-enables compatibility reads. Work Run creation is additive, so older leases remain readable until they expire.

## Open Questions

- Whether Project ID aliases belong only in the shared project record or also in a rebuildable derived index.
- Whether durable Work Run records should be Markdown-first or JSON plus a rendered Markdown view; the conformance contract must remain format-neutral.
- Which external projection fields are safe to commit globally versus keep device-local; credentials always remain Secret References.
