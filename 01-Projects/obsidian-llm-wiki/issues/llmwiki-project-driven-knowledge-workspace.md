---
type: issue
entity: project/obsidian-llm-wiki/issue/llmwiki-project-driven-knowledge-workspace
state: backlog
review: draft
kind: knowledge-task
id: obsidian-llm-wiki/llmwiki-project-driven-knowledge-workspace
description: "BMAD product brief: an AI project workspace built on a searchable, citable personal knowledge base"
status: active
priority: 1
blocked-by: []
last-verified: 2026-08-27
---

# LLM Wiki: project-driven knowledge workspace

## Decision card

- **Driver**: Product owner
- **Approver**: Product owner
- **Contributors**: Product, domain, Obsidian UX, Agent workflow
- **Informed**: MCP, CLI, capability-worker maintainers
- **Lifecycle**: Product definition draft before implementation sequencing
- **Decision needed**: Accept the product wedge and first vertical journey before opening implementation issues

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

1. The user opens the Project Hub for a Project ID.
2. The Hub resolves the current Workspace Binding without exposing machine-local paths as project identity.
3. The Hub assembles:
   - Work-OS state: current stage, completed items, open items, dependencies, and blockers;
   - Project Memory: durable decisions, learned constraints, and recent summaries;
   - Evidence: cited vault, code, Source, and external-material references;
   - Work Runs and Session Records: recent Agent activity, checkpoints, and resumable context;
   - capability health: what can run now and what requires remediation.
4. The Hub presents a bounded recovery snapshot with clear freshness and diagnostic state.
5. The user chooses one next action: resume an Agent Work Run, open a task, inspect evidence, or repair a missing capability.
6. The selected action runs through the owning domain and returns a receipt or explicit failure.
7. The result is captured as draft or work-state evidence according to Promotion Policy; the Hub refreshes as a derived view.

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
| P0 | Project identity and workspace binding | Opening a Project Hub uses a stable Project ID and shows the bound workspace without confusing the local path with identity. |
| P0 | Recovery snapshot | The Hub shows current stage, done, in-progress, blocked, not-started, freshness, and a concrete next action. |
| P0 | Evidence links | Every displayed decision or status claim has at least one resolvable citation target or is marked unknown/uncorroborated. |
| P0 | Resumable Agent context | The user can select a recent resumable Work Run or Session Record and receive the required context without manually reconstructing it. |
| P0 | Explicit action boundary | Resume, run, update, or promote actions require the owning domain operation and return an auditable receipt or explained error. |
| P0 | Safe degradation | Missing capability, stale state, partial output, and failed recovery are visible with remediation or a manual next step. |
| P1 | Knowledge retrieval in project scope | Search prioritizes the active Project's sources, decisions, memory, and evidence while retaining citation targets. |
| P1 | Agent output landing | A completed Agent result is classified as view, work-state transition, knowledge claim, or external side effect and routed through the matching policy. |
| P1 | Progress refresh | Work-OS changes, Agent receipts, and approved memory updates refresh the derived Hub without a second state store. |
| P1 | Cross-surface parity | Obsidian, MCP, and CLI consume the same domain operation and contract for the recovery snapshot. |
| P2 | External projections | GitHub, Gitea, Linear, and other projections expose drift and links without becoming project truth. |
| P2 | Dashboard and visual projections | Data views, Canvas, and other renderers present derived project state without storing authoritative task or knowledge state. |

## Proposed recovery foundation decomposition

The active OpenSpec proposes promoting only the parts of the P1 rows required to
finish the first interrupted-work journey into the Foundation exit gate. This
does not reprioritize generic search, generic output processing, dashboards, or
external projections.

| Slice | Bounded outcome | Gate |
|---|---|---|
| S01 | Existing immutable `project-hub-recovery/v1` snapshot | complete baseline |
| S02 | Bounded resumable Work Run/Session context with owner locks | S01 |
| S03 | Project-scoped cited retrieval over existing owner records | S01 + S02 shared Workflow read model |
| S04A | Additive action candidates and immutable read-only plan | S01 + S02 + S03 |
| S06A | LLM Wiki/Ask Mate Project-context preview in actual Obsidian | S04A |
| S04B | Crash-safe Workflow apply and owner receipt | accepted S06A |
| S05 | TypeScript-owned Work Run output governance | S04B |
| S06B | Confirm/apply/receipt/refresh journey in actual Obsidian | S04B + S05 |
| S07 | MCP and dedicated CLI semantic parity | accepted S06B |
| S08 | Sanitized cross-surface recovery acceptance and timing gate | S07 |

Planning contract:

- `openspec/changes/project-hub-recovery-loop/`
- `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md`

All slices remain `review: draft` and non-executable until OpenSpec Phase 0
approves the source-completeness baseline, authority, schema/operation names,
issue splits, and delegation contract.

## Success metrics

Baselines are not yet measured. The first implementation issue must add a reproducible measurement path before claiming improvement.

- **Time to first defensible next action**: from opening a Project Hub to selecting a cited next action. Initial target: under 60 seconds for a previously active project.
- **Recovery completeness**: in a scripted interruption test, the user can identify current stage, blockers, next action, and the relevant Agent context without reopening the full prior transcript. Initial target: 4/4 checks.
- **Citation coverage**: percentage of non-trivial recovery claims with a resolvable citation target. Initial target: 100% for P0 claims; unknown is acceptable only when explicitly labeled.
- **Resume success**: percentage of valid recent Work Runs that can be resumed or explain the exact missing prerequisite. Initial target: 100% deterministic outcome, with no silent fallback.
- **State authority violations**: number of P0 flows that write project truth directly from the Hub or renderer. Target: zero.
- **Regression safety**: existing domain, MCP, CLI, and plugin verification remains green for every vertical slice.

## Acceptance criteria for this product brief

This brief is ready to decompose when:

- the Project Hub is accepted as the primary recovery entry;
- Project ID, Workspace Binding, Work-OS, Knowledge, Memory, Session Record, Work Run, and capability health ownership is explicit;
- the recovery journey has an observable start, end, user choice, and failure path;
- P0 requirements have deterministic acceptance checks;
- non-goals prevent a second task system and uncontrolled Agent autonomy;
- implementation work is split into bounded Work-OS issues, each with verification evidence.

The product is not ready to call complete until a real sanitized project can pass the recovery journey end to end.

## Domain and authority boundary

```text
Project Hub (derived, read-only composition)
├── Project ID + Workspace Binding
├── Work-OS truth: issues, dependencies, blockers, stage
├── Knowledge truth: cited Evidence and Source material
├── Memory truth: reviewed decisions and durable context
├── Session Record: resumable Agent context
├── Work Run: execution attempt and receipt
├── Settings Platform: effective config and capability health
└── Promotion Policy: routing for output and side effects
```

The Hub may summarize and link these domains. It must not duplicate their authoritative state. A recovery snapshot is a projection with freshness and diagnostic metadata.

## First implementation slices

1. Define a `Project Hub recovery snapshot` contract with explicit freshness, citations, next-action candidates, and missing-capability diagnostics.
2. Build a deterministic read-only composer over existing Project, Work-OS, Memory, Session Record, Work Run, and Settings contracts.
3. Add one Obsidian-first recovery surface with evidence links and a clear action boundary.
4. Add one resumable Agent action using stable Project/Work Item/Work Run identifiers and explicit transition context.
5. Capture the result as a governed Work Run output and refresh the derived Hub.
6. Add MCP/CLI parity only after the Obsidian path is understandable and verified.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Hub becomes a second task database | Keep it read-only; every write delegates to the owning domain and records a receipt. |
| Model summary is mistaken for truth | Label freshness and evidence; require citations for P0 claims; route knowledge claims to review. |
| Session output drifts from project state | Treat Session Record as recovery material, not Work-OS authority; reconcile through explicit Work Run output. |
| Scope expands into every adapter and platform | Gate work by the recovery journey; defer external projections and new workers until P0 passes. |
| Missing optional runtime blocks the whole product | Expose Capability Health and manual remediation; keep the core Project Hub usable. |
| Project identity leaks machine-local paths | Use Project ID as durable identity and Workspace Binding as local association. |

## Assumptions and open questions

- The existing Project, Work-OS, Project Memory Loop, Session Record, Work Run, Settings Platform, and Promotion Policy contracts can expose the minimum read surfaces without becoming a new shared database.
- A Project Hub recovery snapshot can remain derived and be regenerated after every accepted state transition.
- Obsidian remains the primary human-facing surface; MCP and CLI are access surfaces.
- What minimum context must be included for an Agent resume to be safe: last prompt, current issue, decisions, source citations, or a structured bundle?
- Which existing Project Hub or session-record contracts are stable enough to compose, and which need a versioned recovery-specific adapter?
- What is the smallest sanitized project fixture that represents interruption, stale evidence, blocked capability, and resumable Agent work?
- Should the first recovery action resume an existing Work Run only, or also create a new Work Run from a reviewed next action?
- Which metrics can be measured locally without recording private transcript content?

## Assets touched by future implementation

| asset_id | relation | change_or_usage | scope | risk | verify | rollback |
|---|---|---|---|---|---|---|
| `project-hub-recovery-contract` | new domain contract | Defines the derived recovery snapshot and next-action candidates | Shared TypeScript domain | Contract drift across plugin/MCP/CLI | Contract fixtures, typecheck, parity test | Revert contract version and adapters |
| `project-memory-loop` | input authority | Supplies reviewed project memory and session-derived context | Project Memory Loop | Stale or unreviewed memory appears authoritative | Freshness and promotion-policy tests | Disable the input adapter |
| `work-os-issues` | input authority | Supplies current work state and blockers | `01-Projects/<project>/issues/` | Duplicate task state if Hub writes directly | Issue list/board verification | Keep Hub read-only |
| `obsidian-plugin-project-hub` | primary surface | Displays recovery snapshot and explicit actions | Obsidian plugin | UX hides freshness or action risk | Sanitized Obsidian smoke path | Remove view/command registration |
| `mcp-project-hub` | agent access surface | Exposes the same recovery operation through MCP | MCP server | Protocol shape leaks into domain | MCP operation contract test | Remove operation registration |
| `cli-project-hub` | automation surface | Provides headless inspection and resume planning | CLI | CLI becomes the only supported path | Real sanitized CLI preview | Remove CLI entrypoint |

## Evidence used

- `CONTEXT.md` for canonical vocabulary and authority boundaries.
- `30-Architecture/llm-wiki-product-spine.md` for Obsidian-first ownership and access-surface boundaries.
- `docs/AGENT_WORKFLOW_INTEGRATION.md` for the BMAD-lite path and Work-OS issue routing.
- `ROADMAP.md` for the current product-foundation priority and existing issue taxonomy.
- Current repository package and issue structure inspected on 2026-08-27.
