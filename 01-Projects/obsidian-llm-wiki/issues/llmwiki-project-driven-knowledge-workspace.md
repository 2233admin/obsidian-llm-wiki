---
type: issue
entity: project/obsidian-llm-wiki/issue/llmwiki-project-driven-knowledge-workspace
state: backlog
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/llmwiki-project-driven-knowledge-workspace
description: "BMAD product brief: an AI project workspace built on a searchable, citable personal knowledge base"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/p0-s08-recovery-loop-acceptance
last-verified: 2026-08-28
---

# LLM Wiki: project-driven knowledge workspace

## Decision card

- **Driver**: Product owner
- **Approver**: Product owner
- **Contributors**: Product, domain, Obsidian UX, Agent workflow
- **Informed**: MCP, CLI, capability-worker maintainers
- **Lifecycle**: Product wedge and Recovery Flow v2 approved before implementation
- **Decision outcome**: Recovery-required S01B–S08 work is part of Foundation exit; S01B–S03 are verified completions, and implementation proceeds blockers-first from reviewed S04A

## Takeaway

LLM Wiki is an **AI-driven project workspace built on a searchable, citable personal knowledge base**.

The primary user is a personal developer. The primary entry is a Project Hub. The first complete journey is recovering interrupted work. The product must let the user understand the current project state, continue the relevant Agent work, and verify important claims against project evidence without reconstructing context by hand.

Knowledge and project execution are both core. The product relationship is **project-driven knowledge**: the active project selects the relevant work state, sources, decisions, memory, and Agent context.

## Problem and context

A personal developer's project context is split across repositories, Work-OS issues, Obsidian notes, external references, Agent sessions, and runtime outputs. Four failures occur together:

1. **Context loss**: after a session, machine, or Agent change, the developer cannot tell what was completed, blocked, decided, or next.
2. **Unreliable retrieval**: project material is searchable only in fragments, and results do not consistently point to citable evidence.
3. **Disconnected Agent output**: an Agent can produce a plan or patch without updating project state, preserving decisions, or making the next run resumable.
4. **Unclear progress**: tasks, dependencies, Work Runs, and external projections do not form one understandable project view.

The current repository already contains the main domain pieces, but its product framing is too broad. The product spine currently names Vault and Knowledge, Source and Ingest, Memory, Project and Work-OS, Ask Mate and Visual Workspace, Settings, Governance, MCP, CLI, and optional workers as coexisting surfaces. This brief makes the Project Hub the user-facing composition point while keeping each domain's authority intact.

## Target user and job

### Primary user

A personal developer who works across one or more repositories, uses Agent sessions to perform project work, and keeps durable context in an Obsidian vault.

### Job to be done

> When I return to a project after an interruption, show me the current truth, the evidence behind it, and the safest next action so I can continue without reloading the entire history into my head or into a new Agent session.

## First vertical journey: recover interrupted work

1. The user opens Recovery Flow for a canonical Project ID through Ask Mate Project Context.
2. The Flow resolves Workspace Binding without treating a machine-local path as Project identity.
3. The `open` stage composes Work-OS state, bounded Work Run/Session context, reviewed Project Memory, capability health, freshness, diagnostics, citations, and suggested queries.
4. The user performs mandatory Project-scoped cited search and may repeat queries; every query forms its own fingerprinted branch.
5. The Flow derives safe resume/create candidates and exact compatible Project Agent Bindings.
6. With exactly one compatible Binding, the searched stage supplies a closed recommended next request; multiple Bindings require explicit selection.
7. The Flow returns one immutable five-minute Plan. Candidate replacement and Plan refresh are explicit and produce new fingerprints.
8. After exact confirmation, `workflow.recovery.apply` claims and resumes/creates one Work Run and returns a receipt or explicit outcome-unknown.
9. `workflow.agent.leave` claims and routes Work Run output through Promotion/Write Policy; the UI discards ephemeral Flow state and opens current owner state again.

## Product goals

- Make Project Hub the fastest path from interruption to a defensible next action.
- Make project claims traceable to vault, code, Source, Issue, or Session Record evidence.
- Keep Work-OS, Knowledge, Memory, Agent Run, Settings, and capability domains authoritative in their own boundaries.
- Let a user resume Agent work with stable Project ID, Work Item ID, Work Run ID, and transition context.
- Make missing, stale, partial, unsupported, or conflicting state visible instead of silently guessing.
- Keep MCP and CLI behavior reusable without allowing their protocol shapes to define the human product.
- Preserve ordinary Markdown and Work-OS notes as durable user truth.

## Non-goals for the first product slice

- A generic note-taking replacement independent of project work.
- Autonomous promotion of model-generated knowledge claims into durable truth.
- A second project-management or task-tracking system.
- Making MCP, CLI, Canvas, Bases, derived boards, or runtime caches authoritative.
- Requiring Python, MemU, Graphify, or another optional worker to open the product.
- Supporting every external platform or Agent runtime before the recovery journey works locally.
- Treating the current DataView implementation as the product centerpiece; DataView is a derived project view capability.

## Product requirements and priority

| Priority | Requirement | Observable acceptance |
|---|---|---|
| P0 | Project identity and workspace binding | Recovery Flow uses stable Project ID and never persists local path as identity. |
| P0 | Stateless staged Recovery Flow | Closed V2 actions/stages advance through recomputed fingerprints without a server session/cache or plugin-persisted Flow state. |
| P0 | Current recovery facts and bounded context | Open shows stage, work groups, freshness, reviewed context, checkpoints, prerequisites, citations, and capability health within fixed bounds. |
| P0 | Mandatory Project-scoped evidence | Repeatable search returns only active-Project owner evidence with resolvable Citation Targets, provenance, freshness, and independent branch fingerprints. |
| P0 | Safe candidate and Plan boundary | Candidate/Binding choice is explicit or uniquely eligible; immutable Plan is previewed before mutation and never invents execution identity. |
| P0 | Explicit action boundary | Workflow claims before resume/create and returns one auditable receipt or outcome-unknown. |
| P0 | Agent output landing | Successful/review completion uses claimed output routing for view, work-state transition, knowledge claim, external side effect, or quarantine. |
| P0 | Safe degradation and refresh | Stale, unavailable, partial, expired, malformed, and uncertain outcomes are visible with explicit restart/refresh/remediation. |
| P0 | Progress refresh | Accepted owner receipts cause a new owner-derived Flow open without a second state store. |
| P0 | Cross-surface parity | Obsidian proves the journey first; MCP/CLI later expose the same Flow/apply contracts. |
| P2 | External projections | GitHub, Gitea, Linear, and other projections expose drift and links without becoming project truth. |
| P2 | Dashboard and visual projections | Data views, Canvas, and other renderers present derived project state without storing authoritative task or knowledge state. |

## Approved recovery foundation decomposition

Only the parts required for the first interrupted-work journey move into
Foundation exit. Generic search expansion, generic output processing,
dashboards, adapters, Fleet work, and external projections remain outside this
change.

| Slice | Bounded outcome | Direct gate |
|---|---|---|
| S01 | Historical completed `project-hub-recovery/v1` behavior baseline | complete |
| S01B | Complete internal closed Recovery Flow v2 contract kernel; no public partial Operation | S01 |
| S02 | Workflow store/read seams plus V2 open and bounded context | S01B |
| S03 | Mandatory repeatable Project-scoped cited search | S02 |
| S04A | Candidates, Binding eligibility, immutable Plan, complete Flow registration, caller migration, V1 removal | S03 |
| S06A | Ephemeral Ask Mate Project-context preview in actual Obsidian | S04A |
| S04B | Claim-first Workflow apply and owner receipt | accepted S06A |
| S05 | Claimed Work Run output governance | S04B |
| S06B | Exact confirm/apply/receipt and owner-backed Flow restart in actual Obsidian | S05 |
| S07 | MCP and dedicated CLI semantic parity | accepted S06B |
| S08 | Sanitized cross-surface acceptance, privacy, replay, and timing gate | S07 |

Planning contract:

- `docs/adr/0001-project-hub-recovery-flow-v2.md`
- `openspec/changes/project-hub-recovery-loop/`
- `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md`

S01B–S03 are verified completions. S04A is the immediately executable leaf;
S06A–S08 remain blocked by the direct dependency chain above.

## Success metrics

Baselines are not yet measured. S08 owns the reproducible measurement path and baseline; no earlier slice may claim improvement without that evidence.

- **Time to first defensible next action**: from opening a Project Hub to selecting a cited next action. Initial target: under 60 seconds for a previously active project.
- **Recovery completeness**: in a scripted interruption test, the user can identify current stage, blockers, next action, and the relevant Agent context without reopening the full prior transcript. Initial target: 4/4 checks.
- **Citation coverage**: percentage of non-trivial recovery claims with a resolvable citation target. Initial target: 100% for P0 claims; unknown is acceptable only when explicitly labeled.
- **Resume success**: percentage of valid recent Work Runs that can be resumed or explain the exact missing prerequisite. Initial target: 100% deterministic outcome, with no silent fallback.
- **State authority violations**: number of P0 flows that write project truth directly from the Hub or renderer. Target: zero.
- **Regression safety**: existing domain, MCP, CLI, and plugin verification remains green for every vertical slice.

## Acceptance criteria for this product brief

This brief is approved and decomposed. S01B–S03 have passed focused
verification and independent review. Implementation continues from S04A because:

- Ask Mate Project Context is the primary recovery entry;
- Project ID, Workspace Binding, Work-OS, Knowledge, Memory, Session Record, Work Run, Settings, Agent Domain, and Promotion/Write Policy ownership is explicit;
- Recovery Flow has observable start/end, user query/choice, stale/unavailable paths, exact Plan boundary, Workflow receipt, and output route;
- P0 requirements have deterministic automated and actual-surface acceptance;
- non-goals prevent a second task/Flow state store and bound Luna autonomy;
- S01B–S08 are reviewed Work-OS issues with direct blocking edges and verification evidence destinations.

The product is not complete until a real sanitized Project passes R1–R11,
including actual Obsidian timing and privacy gates.

## Domain and authority boundary

```text
Project Hub (derived, read-only composition)
├── Project ID + Workspace Binding
├── Recovery Flow v2 (stateless staged read model)
├── Work-OS truth: issues, dependencies, blockers, stage
├── Knowledge truth: cited Evidence and Source material
├── Memory truth: reviewed decisions and durable context
├── Session Record: safe resumable context metadata
├── Workflow: Work Run, lease, recovery/output claims and receipts
├── Agent Domain: Binding/Profile role, revisions and capabilities
├── Settings Platform: effective config and capability health
└── Promotion/Write Policy: output and external-side-effect routing
```

Recovery Flow may summarize and link these owners. It persists no Flow state and
owns no mutation. A later request repeats minimum inputs and recomputes its
prior stage. Apply/output writes remain Workflow-owned.

## First implementation slices

1. **Complete — S01B** defines the complete internal closed V2 request/response/stage/fingerprint kernel while V1 remains byte-stable.
2. **Complete — S02** extracts Workflow store/read seams and composes open plus bounded context.
3. **Complete — S03** adds mandatory repeatable Project-scoped cited search.
4. **Next — S04A** adds candidates/Binding eligibility/immutable Plans, registers the complete Flow, migrates callers, and removes V1.
5. S06A proves the ephemeral read-only Flow through Ask Mate Project Context in actual Obsidian.
6. S04B applies one exact Plan through claim-first Workflow ownership.
7. S05 claims and routes Work Run output through owner policy.
8. S06B proves confirmation, receipt, outcome remediation, and owner-backed Flow restart in actual Obsidian.
9. S07 adds MCP/CLI parity only after the human journey is accepted.
10. S08 enforces sanitized cross-surface behavior, privacy, replay, and timing.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Recovery becomes a second task or session database | Flow is read-only/stateless; no server cache or plugin persistence; every mutation delegates to Workflow. |
| V2 ships partially while V1 and V2 drift | S01B is internal only; public registration and V1 removal happen together after all read stages exist. |
| Client mixes search branches or stale selections | Chained Flow Fingerprints and minimal-input recomputation reject branch mixing and return explicit stale restart. |
| Automatic planning guesses an Agent identity | Auto-plan eligibility requires exactly one compatible Binding; Plan binds only role/Binding/Profile; apply actor supplies execution identity. |
| User confirms a silently replaced Plan | Plan expires visibly and refresh is explicit; candidate override/refresh validates complete prior Plan and produces a new fingerprint. |
| Model summary is mistaken for truth | Require citations/freshness; reviewed-only memory; quarantine malformed output; claims never auto-promote. |
| Apply/output retry duplicates mutation | Durable plan/output claims, idempotent owner receipts, replay/rebound rules, and outcome-unknown precedence. |
| Scope expands into adapters/platforms | Foundation gate is limited to the first recovery journey; external projections/workers remain deferred. |
| Missing optional runtime blocks core | Expose capability remediation; core Flow requires no new runtime or Python worker. |
| Luna implementation shape drifts from approved design | Internal shape may vary, but contract/authority/effect changes stop; controller updates canonical plans after review. |

## Approved assumptions and remaining measurement work

- Existing owner records can expose minimum read facts through extracted TypeScript seams without a new shared database.
- Search is required before planning and may repeat; only the selected branch feeds Plan.
- The UI can meet the under-60-second target with a searched response plus a closed recommended next request and optional automatic second read call.
- Flow/query/selection/Plan state is intentionally disposable across ItemView reload.
- Local measurement records no private transcript or raw unsafe query material.
- The remaining unknown is the measured baseline and actual three-run duration; S08 records it rather than predicting it.

## Assets touched by future implementation

| asset_id | relation | change_or_usage | scope | risk | verify | rollback |
|---|---|---|---|---|---|---|
| `project-hub-recovery-flow-v2` | replacement domain contract | Closed stateless actions/stages, layered locks, chained fingerprints and clean V1 cutover | Shared TypeScript domain | Partial/dual contract or branch mixing | Contract kernel, equivalence, absence scan, parity | Revert the cutover release |
| `project-hub-recovery-operation` | read access surface | Complete `project.hub.recovery.flow`; ordinary `project.hub.get` loses V1 recovery field | MCP application catalog | Adapter owns stage semantics | Operation contract and read-only byte tests | Remove Flow registration and revert cutover |
| `workflow-recovery-claims` | mutation authority | Plan/token and output/token claims plus receipts/outcome-unknown | Work-OS Project runtime roots | Duplicate Work Run or owner effect | Fault injection, races, replay and doctor tests | Disable apply/output mutation; retain claims for reconciliation |
| `project-memory-loop` | input/output owner | Supplies reviewed context and receives cited draft claims | Project Memory | Unreviewed memory appears current or drafts duplicate | Reviewed-only and idempotent owner-receipt tests | Disable owner port |
| `work-os-issues` | input/output owner | Supplies work/blockers and receives allowlisted transitions | `01-Projects/<project>/issues/` | Hub writes task truth directly | Work-OS operation/board tests | Keep Flow read-only and disable transition route |
| `obsidian-ask-mate-recovery-panel` | primary human surface | Ephemeral open/search/selection/Plan/apply/receipt/restart | Obsidian plugin | Hidden stale Plan or persisted sensitive query | Actual Obsidian, reload-reset, keyboard/focus tests | Remove panel wiring |
| `mcp-project-hub` | agent access surface | Exposes shared Flow/apply after Obsidian proof | MCP server | Protocol shape leaks into domain | Domain/MCP parity test | Remove adapter exposure |
| `cli-project-hub` | automation surface | Headless Flow/apply mapping | CLI | CLI becomes reference behavior | Real fixture CLI and parity tests | Remove CLI bin/target |

## Evidence used

- `CONTEXT.md` for canonical vocabulary and authority boundaries.
- `docs/adr/0001-project-hub-recovery-flow-v2.md` for the Snapshot-to-Flow decision.
- `30-Architecture/llm-wiki-product-spine.md` for Obsidian-first ownership and access-surface boundaries.
- `docs/AGENT_WORKFLOW_INTEGRATION.md` for BMAD-lite and Work-OS routing.
- `openspec/changes/project-hub-recovery-loop/` for approved V2 contracts and scenarios.
- `ROADMAP.md` for Foundation dependency order.
- Current repository source/caller/issue structure inspected on 2026-08-28.
