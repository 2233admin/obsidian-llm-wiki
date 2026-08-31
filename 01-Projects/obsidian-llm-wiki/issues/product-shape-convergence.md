---
type: issue
entity: project/obsidian-llm-wiki/issue/product-shape-convergence
state: backlog
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/product-shape-convergence
description: "Converge LLM Wiki's product information architecture, surface ownership, and entry hierarchy without treating any single visual surface as the product"
status: active
priority: 1
blocked-by: []
last-verified: 2026-08-29
labels:
- ready-for-agent
- llmwiki
- product-architecture
- obsidian-plugin
---

# Product shape convergence

## Problem Statement

LLM Wiki has the pieces of a coherent product, but users encounter them as competing product shapes. They cannot reliably tell where to begin, which surface owns an object, which view is authoritative, which view is derived, or how to recover when a capability is unavailable. This is an information-architecture and boundary problem, not a request for one more visual feature.

The fixed product baseline is:

- **LLM Wiki is the only product.** Obsidian is the primary human workbench and host, not a second product.
- **Ask Mate is the cross-domain entry.** It receives context, routes intent, and composes work across domains.
- **Project Hub is the project composition and recovery destination.** It is not the product root and does not own every fact it displays.
- **Agentfiles is the real existing Capability Library user surface.** It does not create a second product identity or own the Agent/capability runtime.
- **Visual Workspace is a domain.** It owns normalized visual documents and reviewable visual edits, independent of any renderer or Obsidian file type.
- **Canvas, Bases, Kanban, and Mermaid are projection, input, or adoption surfaces.** They are not automatically canonical sources.
- **Settings and Advanced Control Plane are management surfaces.** They manage configuration, health, permissions, diagnostics, and policy without absorbing domain ownership.
- **MCP, CLI, and session archiver are access/archive surfaces.** They expose or preserve shared operations and records without defining a parallel human IA or owning domain truth.
- **`outline-first` belongs only to Ask Mate's `make_map` flow.** It is not a product name, root, or global mode.

The `llmwiki-project-driven-knowledge-workspace` document is a historical product brief. Its “Project Hub primary entry” wording is superseded for entry routing by this issue and MUST NOT be treated as the current rule. This issue is the normative authority for the current entry relationship; `30-Architecture/llm-wiki-product-shape.md` is the companion architecture explanation. The S06 “Ask Mate primary entry” wording is interpreted here as “Ask Mate is the cross-domain entry.” The fixed relationship is therefore **LLM Wiki root → Ask Mate for cross-domain work; Project Hub for project composition and recovery**.

The current implementation has several human entry points, including the LLM Wiki ribbon/command, active-context and Project Context actions, Agentfiles, Settings, and an advanced modal. The unified navigation described here is the target IA and is not a claim that the current UI already implements it. The measurable outcome is that a user can identify the right entry, understand ownership and provenance, perform an allowed write, and recover from a missing or degraded capability without guessing at the source of truth.

## Solution

Implement one stable LLM Wiki product IA with a visible workspace context, a fixed entry relationship, and named destinations with explicit ownership. Every destination declares its job and whether the represented state is canonical truth, derived projection, user-authored input, or management state.

Target hierarchy:

1. **LLM Wiki root** — product identity and global navigation context.
2. **Current workspace context** — selected vault/workspace and optional Project binding; scopes search, citations, actions, and recovery.
3. **Ask Mate** — cross-domain conversation and intent routing.
4. **Knowledge** — search, citation, source/evidence navigation, Inbox, Memory, and promotion.
5. **Projects** — Project Hub, project work, and project recovery.
6. **Visual Workspace** — normalized visual documents, visual editing, and adoption/projection workflows.
7. **Agentfiles Library** — capability browsing, search, editing, organization, marketplace, conversations, and dashboards.
8. **Manage** — Settings, Doctor/health, and Advanced Control Plane.

The boundary model is explicit:

- A **canonical owner** owns identity, lifecycle, writes, conflicts, receipts, and provenance for an object class.
- A **derived projection** identifies its source and freshness and cannot silently become authoritative because it is convenient to edit or render.
- A **user-authored input** enters an explicit, reviewable adoption or conversion plan.
- A **control plane** manages settings, health, permissions, registration, diagnostics, and policy, but not domain data.
- An **access/archive surface** exposes or preserves an operation or record and shows its owner, provenance, permission needs, freshness, and migration route.
- A **cross-surface link** preserves object identity, workspace/Project context, action state, and a return or recovery location.

The issue converges names, entries, routing, context preservation, owner indicators, provenance/freshness, migration language, safe failure states, and entry accessibility. It does not reimplement the underlying domain engines.

## User Stories

1. As a first-time user, I can enter LLM Wiki from one clearly named product root and understand that Obsidian is the workbench hosting it.
2. As a returning user, I can see the active vault/workspace and whether a Project is selected before I search, ask, edit, or recover work.
3. As a user with no bound Project, I can bind or create a Project from workspace context, understand the binding, and continue without treating a machine-local path as Project identity.
4. As a user with an invalid, stale, or missing binding, I can repair or defer it and still reach permitted unscoped Knowledge and management surfaces.
5. As a user, I can open Ask Mate and choose `ask`, `understand`, `make_map`, or `report_problem` without memorizing domain ownership.
6. As a user asking a factual or exploratory question, I can use `ask` and receive a cited answer with Knowledge Item type, scope, source, citation target, provenance, freshness, and a route to Knowledge.
7. As a user trying to understand context, I can use `understand` to inspect the active note, selection, Canvas, managed map, or Project context and see evidence and capability limits.
8. As a user making or revising a visual map, I can use `make_map`, where `outline-first` is shown only as that flow's planning strategy.
9. As a user reporting a product or diagnostic problem, I can use `report_problem` to review provenance-bearing observations and prepare a governed contribution plan without an automatic remote mutation.
10. As a user, I can distinguish Ask Mate's routing/composition role from the domain that owns the resulting object or write.
11. As a user, I can search Knowledge in the active scope and filter or group results by item type, Project, status, source, provenance, and freshness.
12. As a user, I can open a search result at a concrete citation target such as a file, heading, block, timestamp, issue, Work Run, or Kanban card.
13. As a user, I can quote or cite a Knowledge Item into Ask Mate, Project Hub, a visual edit plan, or an Agent conversation while retaining source and provenance links.
14. As a user, I can inspect Inbox items, understand lifecycle status, and choose to review, organize, analyze, or promote them.
15. As a user, I can inspect Memory separately from transient Agent output and see draft, reviewed, promoted, superseded, and Project-scoped states.
16. As a user, I can promote eligible knowledge through explicit review and understand whether evidence makes it auto-promotable, human-review-required, or blocked.
17. As a user, I can see when search, citation, Inbox, Memory, or promotion is degraded or unavailable and receive a useful fallback.
18. As a user, I can open Markdown for Visual Workspace adoption, preview interpretation, inspect ambiguity and provenance, and confirm before writing or normalizing.
19. As a user, I can adopt a supported Canvas structure through the same reviewable path and understand it is input or projection unless explicitly designated for that operation.
20. As a user, I can create or edit a Mind Map Document in Visual Workspace and understand the normalized document is the canonical visual object.
21. As a user, I can preview deterministic text, Mermaid, Canvas, or other supported projections, inspect source and freshness, and regenerate without competing authority.
22. As a user, I can prepare a Mind Map plan from Ask Mate, review nodes, edges, changes, evidence, affected projections, and fingerprint, and apply only after confirmation.
23. As a user, I can cancel, revise, or reopen a Mind Map plan without losing source context or confusing preview with applied change.
24. As a user, I can detect a stale or conflicting plan and am directed to refresh or re-plan rather than silently overwrite.
25. As a user, I can open Project Hub for the selected Project and see identity, binding, work state, sources, memory, Agent context, recovery state, capability health, citations, and next actions.
26. As a user returning after interruption, I can enter Project Hub/recovery, inspect complete, blocked, decided, and next work, and resume or create the correct Agent context.
27. As a user, I can distinguish Project Hub's composed status/recovery projection from the Work-OS issue, Work Run, Project Memory, or Knowledge Item that owns each fact.
28. As a user, I can open Project Canvas and navigate from each visual element to its canonical issue, Knowledge Item, Work Run, or Mind Map Document.
29. As a user, I can use Project Bases for structured records and understand which fields are projected, writable through an owning operation, or read-only.
30. As a user, I can use Project Kanban while preserving Work-OS ownership of issue state and seeing stale, derived, or unsynchronized cards.
31. As a user, I can view or export Mermaid as projection or input with visible source and regeneration rules.
32. As a user, I can browse Agentfiles Library by capability, category, source, installation state, compatibility, and health.
33. As a user, I can search Agentfiles Library and distinguish installed, available, mirrored, unavailable, disabled, and degraded capabilities.
34. As a user, I can open an Agentfile entry and read purpose, inputs, outputs, permissions, provenance, version, compatibility, and its invocation route.
35. As a user, I can edit an Agentfile or user-owned metadata in a marked editor with validation, preview, conflict handling, and separation of local edits from marketplace/source content.
36. As a user, I can favorite Agentfiles and organize user-controlled collections without changing registry identity or ownership.
37. As a user, I can browse Marketplace content, compare versions and provenance, understand trust and permissions, and explicitly install or mirror an entry.
38. As a user, I can inspect Agent Conversations associated with an Agentfile, distinguish transcript evidence from current configuration, and resume or inspect a conversation.
39. As a user, I can open Agentfiles Dashboard to inspect usage, health, compatibility, recent failures, and repair routes without confusing metrics with capability truth.
40. As a user, I can open Settings from Manage and find product, device, vault, workspace-Project, and session scopes with effective-value provenance.
41. As a user, I can run Doctor or health checks, distinguish available, degraded, unavailable, and disabled, and follow repair or fallback routes.
42. As a user, I can open Advanced Control Plane for capability registration, permissions, adapters, diagnostics, receipts, and policy without mistaking it for the everyday entry.
43. As an administrator or advanced user, I can make a control-plane change with scope, permission, validation, audit evidence, and rollback or disable semantics visible before confirmation.
44. As an Agent author, I can access the same domain operation through MCP with stable contracts, error semantics, citations, provenance, and write-policy boundaries.
45. As a CLI user, I can access supported operations without learning a second product IA or divergent ownership model.
46. As an automation author, I can distinguish read-only, derived, planned, confirmed-write, and external-side-effect operations in MCP and CLI responses.
47. As a user, I can see when an operation requires permission, secret, login, cookie, browser, manual action, or another Access Context before starting.
48. As a user, I can use a Secret Reference without any UI, Agent, MCP response, CLI output, log, or provenance display revealing the secret value.
49. As a user, I can distinguish source identity, citation target, provenance history, Access Context, and permission state rather than seeing one ambiguous “source” label.
50. As a user, I can trace a derived view or Agent result back to canonical objects and evidence, including inferred, ambiguous, stale, and unreviewed results.
51. As a user, I am warned when a derived view cannot be written safely, its owner is unavailable, or the operation would create duplicate authority.
52. As a user, I receive a specific empty state when no Project is selected, no Knowledge Items match, no Agentfiles are installed, no capability is available, or no recovery candidate exists.
53. As a user, I receive a specific failure state after partial progress and can inspect what was preserved, what was not written, and the safe next action.
54. As a user, I receive a degraded-mode route when an optional adapter, relation source, renderer, marketplace, MCP server, or CLI dependency is unavailable.
55. As a user, I can recover from an outcome-unknown write using a durable receipt or status check instead of blindly retrying.
56. As a keyboard user, I can reach root, current context, Ask Mate, Knowledge, Projects, Visual Workspace, Agentfiles, and Manage through predictable focus order and commands.
57. As a keyboard or screen-reader user, I can identify current surface, selected Project, action state, errors, and confirmation boundaries from accessible names and announcements.
58. As a user in a narrow Obsidian pane, I can reach primary entries and current context without hidden hover targets or an unscrollable navigation layout.
59. As a new user, I can discover the difference between shortcut, projection, canonical editor, and control-plane screen from labels, help text, and contextual links.
60. As a user moving across surfaces, I can follow a stable link to canonical objects, preserve Project/workspace context, and return without losing query, plan, or recovery branch.
61. As a user encountering a renamed or relocated entry, I can use a compatibility redirect or migration message to reach the canonical destination and understand the new name.
62. As a maintainer, I can add a capability, projection, or host adapter by declaring owner, inputs, outputs, permissions, health, provenance, and entry route without inventing a product root.
63. As a user who prefers reduced motion, I can discover and reach primary surfaces and understand route/state changes without animation.
64. As a user who zooms or uses a narrow pane, I can reach root, context, and destinations through zoom-safe reflow without losing labels or actions.
65. As a keyboard or assistive-technology user, I can tell where focus moves when a surface or modal opens and have focus restored when it closes.
66. As a user, I can distinguish status, severity, selection, and ownership without color alone.
67. As a user, I receive accessible validation and error announcements for route, permission, conflict, failure, and recovery states.
68. As a touch user, I can activate navigation, recovery, confirmation, and return targets within usable bounds without hover.
69. As a session-archiver user, I can find archive access under Agent/automation access, inspect archive provenance and permissions, and recover from unavailable, partial, or stale archive state without treating archive as domain truth.

## Implementation Decisions

- **Object-to-owner matrix is frozen and explicit.** Knowledge search, citation, and index are cross-domain read surfaces, not universal ownership. Raw Capture and source evidence belong to the Source/Ingest owning domain or path. Reviewed durable knowledge and Memory belong to Knowledge/Governance paths. `Work-OS issue`, `comment`, and `kanban_card` belong to Project/Work-OS. Mind Map and other visual objects belong to Visual Workspace. External projections remain owned by their respective external systems; inside LLM Wiki they are projections. “Knowledge Item” is retained only as the unified retrieval/citation vocabulary, not as a universal owner.
- **Entry convergence is fixed.** LLM Wiki is the sole product root. Obsidian is the primary workbench. Ask Mate is the cross-domain entry. Project Hub is the project composition/recovery destination. New commands, ribbons, views, deep links, and adapter shortcuts resolve to these or to an explicitly named child surface under the same IA.
- **Surface roles are fixed.** Agentfiles remains the real Capability Library user surface. Visual Workspace is the domain; Canvas/Bases/Kanban/Mermaid are projection, input, or adoption surfaces. Settings/Advanced Control Plane are management surfaces. MCP/CLI/session archiver are access/archive surfaces.
- **Owner indicators are mandatory.** Each represented object exposes owner, canonical/derived/input state, provenance, and freshness. Projection and access/archive writes route through the canonical owner with its validation, permission, conflict, receipt, and audit behavior.
- **Write and failure semantics are explicit.** Read, derived, planned, confirmed-write, external-side-effect, archived, partial, unavailable, degraded, stale, conflict, and outcome-unknown states remain distinguishable. Plans and previews do not write until explicit apply. Unknown outcomes route to status or recovery, never blind retry.
- **Migration is a compatibility boundary.** Supported commands, deep links, stored identifiers, automation contracts, and archive references continue to route or show a clear mapping. Old human-facing labels redirect to one canonical display name; compatibility remains isolated and removable after callers retire.
- **Modularity is preserved.** Surface modules and domain boundaries remain separate. They share navigation, context, ownership, provenance, freshness, link, and return/recovery contracts rather than being merged into one component or runtime.

## Testing Decisions

Use **Obsidian plugin host integration** as the highest-value seam. Verify observable activation, registered destinations, command and ribbon routing, custom view reachability, view state, active workspace/Project context, and context preservation across route changes and returns. This is the acceptance seam for IA convergence, not a claim that it covers every engine.

Reuse existing focused tests for lifecycle/activation, view registration and state, Agentfiles, Settings, Control Plane, Project Hub, recovery, Visual Workspace, MCP/CLI, and session archiver behavior as regression coverage. Extend focused tests only for externally visible entry labels, destination registration, routing, context, ownership indicators, provenance/freshness, compatibility redirects, safe failure, and accessibility entry reachability.

This issue implements and verifies IA, entry, routing, context preservation, ownership indicators, migration, and entry accessibility. It does not redo bottom-layer engines and does not claim tests have passed. The route-coverage matrix, where needed, is regression coverage rather than full-product E2E.

Host integration checks cover:

- One LLM Wiki root and intended destinations are exposed without duplicate authority.
- Cross-domain actions route to Ask Mate; project composition and recovery route to Project Hub; workspace, Project, query, plan, and recovery context survive.
- Ask Mate routes `ask`, `understand`, `make_map`, and `report_problem`, with `outline-first` confined to `make_map`.
- Destinations expose responsibilities, owner indicators, canonical/derived/input status, provenance, and freshness; projection and archive writes route to owners.
- Session archiver is reachable as access/archive, and unavailable, partial, stale, permission, provenance, and migration states recover safely.
- Empty, degraded, conflict, outcome-unknown, and no-Project states preserve context and offer a safe next action.
- Supported compatibility commands, deep links, identifiers, and archive references route or show migration.
- Reduced-motion discoverability, zoom/reflow, focus trap/restoration, non-color status, accessible validation/error announcements, and usable touch targets are reachable at the host boundary.

## Out of Scope

- Defining any visual feature as the product.
- Replacing the LLM Wiki product name or treating Obsidian as a competing product.
- Making `outline-first` global or treating it as product identity.
- Merging every surface into one component, view, or runtime module.
- Declaring Canvas, Bases, Kanban, Mermaid, Project Hub, Agentfiles, Ask Mate, MCP, CLI, or session archiver universal canonical sources.
- Replacing the existing ownership model with a new store solely to simplify navigation.
- Building a renderer, marketplace, Agent runtime, MCP protocol, CLI implementation, or session-archiver implementation.
- Adding automatic remote side effects, implicit promotion, secret-value storage, or blind retries.
- Redesigning every screen's styling before IA, ownership, and migration contracts are established.
- Removing supported compatibility paths before redirects and migration guidance are verified.
- Reimplementing or comprehensively re-verifying Knowledge, Visual Workspace, Agentfiles, Settings, MCP/CLI, or session-archiver engines.
- Treating dashboards, transcripts, projections, generated views, archives, or access surfaces as durable truth merely because they are easy to browse.

## Further Notes

This is a product-shape, entry, and surface-ownership convergence specification for future implementation work. It is not a claim that the current UI already has the target navigation, and it does not claim that any test has passed.

Fixed assumptions and scope:

- LLM Wiki is the only product; Obsidian is the primary workbench.
- Ask Mate is the cross-domain entry; Project Hub is project composition and recovery.
- Agentfiles is an existing Capability Library user surface.
- Visual Workspace is a domain; Canvas/Bases/Kanban/Mermaid are projections or adoption surfaces.
- Settings and Advanced Control Plane are management surfaces.
- MCP, CLI, and session archiver are access/archive surfaces.
- `outline-first` is limited to Ask Mate `make_map`.
- The first implementation slice is host-level IA, entry, routing, context, ownership indicators, provenance/freshness, migration, and accessible reachability.

Acceptance criteria:

1. Product copy and navigation identify LLM Wiki as the sole product, route cross-domain entry to Ask Mate, and route project composition/recovery to Project Hub.
2. Host integration covers activation, destination registration, command/ribbon routing, custom Ask Mate view reachability, view state, and workspace/Project context preservation.
3. The explicit owner matrix distinguishes cross-domain Knowledge search/citation/index reads, Source/Ingest raw Capture and evidence, Knowledge/Governance reviewed durable knowledge and Memory, Project/Work-OS issue/comment/kanban_card, Visual Workspace Mind Map/visual objects, and externally owned projections shown in LLM Wiki as projections; “Knowledge Item” is only unified retrieval/citation vocabulary.
4. Ask Mate routes all four intents and shows `outline-first` only within `make_map`.
5. Agentfiles, Visual Workspace, projection/adoption surfaces, management surfaces, and access/archive surfaces use the declared vocabulary and responsibilities.
6. Empty, unavailable, degraded, stale, conflict, partial, permission/Secret Reference, and outcome-unknown entry states have safe recoverable routes without asserting bottom-layer success.
7. Supported commands, deep links, identifiers, automation contracts, and archive references either continue to route or show explicit migration.
8. Existing focused tests are reused as regression coverage; verification remains scoped to IA, entry, routing, context, ownership, migration, and accessibility reachability.
9. Entry acceptance covers keyboard and screen-reader reachability, reduced motion, zoom/reflow, focus restoration, non-color status, validation/error announcements, and touch target bounds.
10. Relevant product vocabulary and surface documentation no longer describe projections or access/archive surfaces as domain truth, introduce a duplicate product identity, or present historical Project Hub/Ask Mate entry wording as unresolved; the historical `llmwiki-project-driven-knowledge-workspace` brief is marked as historical/layered or otherwise excluded as a current-rule source, this issue is used as the entry-relationship authority, and `30-Architecture/llm-wiki-product-shape.md` is identified as the companion architecture explanation.
