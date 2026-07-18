## Context

LLM Wiki already has canonical Work-OS issues, Project Context, Project Hub, Agent Domain threads, Settings, Operation Write Policy, and governed Host Capability Connectors. Its current Canvas and Mermaid exporters are derived workflow or graph views; they are not a round-trippable mind-map model. OBC and plugin health checks also lack a shared problem-intake contract, so findings do not become reviewable project work in a consistent way.

Ask Mate is the proposed Obsidian-native user experience. It must remain a thin control surface: model configuration belongs to Settings, conversation identity belongs to Agent Domain, mind-map semantics belong to Visual Workspace, problem triage belongs to Problem Intake, and authoritative tasks remain Work-OS Markdown issues.

The implementation is GPL-3.0-only first-party code. It must work without a paid mind-map plugin, arbitrary plugin command execution, or a required rendering service.

## Goals / Non-Goals

**Goals:**

- Let a user select an Obsidian Markdown note or core Canvas, inspect the interpreted structure, clarify ambiguities conversationally, and create or revise a useful mind map.
- Provide a normalized, host-neutral Mind Map Document with stable node identity, provenance, optimistic revision checks, and deterministic projections.
- Let OBC, approved plugin adapters, Host Capability diagnostics, and Agents report problems through one provider-neutral intake contract.
- Turn a reviewed Problem Observation into a Work-OS issue proposal and apply it only through existing project operations.
- Let the user explicitly choose whether a product problem remains local, is submitted as a redacted upstream Issue, or is prepared as a verified pull request.
- Make visual workspaces, diagnostics, issues, Work Runs, and verification visible together in Project Hub.

**Non-Goals:**

- Replacing Work-OS, Project Context, Agent Domain, Settings, or Host Capability domains.
- Treating Canvas, Mermaid, Kanban, Bases, or Ask Mate conversation history as canonical project state.
- Supporting arbitrary Obsidian plugin APIs or `executeCommandById`.
- Building real-time multi-user collaborative editing in the first release.
- Auto-promoting generated claims, auto-creating authoritative issues, or auto-closing issues from a diagnostic scan.
- Automatically submitting remote Issues, pushing branches, creating pull requests, marking pull requests ready, or merging changes.
- Guaranteeing lossless import of every third-party mind-map format.

## Decisions

### 1. Domain first, Ask Mate as a vertical control surface

Create two bounded domain capabilities:

- **Visual Workspace** owns Mind Map Documents, source snapshots, edit plans, validation, and projections.
- **Problem Intake** owns Problem Observations, fingerprints, triage lifecycle, and issue proposals.

Ask Mate calls their Operations and reuses Agent Domain Threads for governed conversational context. It stores only device-local UI preferences and ephemeral editor state.

This is preferred over an Ask Mate monolith because the MCP server, CLI, tests, and future hosts need the same behavior. It is also preferred over extending Project Domain because Project Hub is a read model and must not absorb mutation authority from visual, diagnostic, or Work-OS owners.

### 2. Markdown-backed mind maps with a normalized intermediate model

The domain uses a normalized `MindMapDocument`:

```text
MindMapDocument
  id, projectId?, title, rootNodeId, revision, sourceSnapshot, metadata
  nodes[]: id, label, kind, noteRef?, summary?, citations[], attributes
  edges[]: id, from, to, relation, order, provenance, confidence?
```

The first-party editable format is a human-readable Markdown mind-map note using headings or nested lists and stable Obsidian block IDs inside an LLM Wiki managed section. Existing Markdown outside the managed section is never rewritten. A selected ordinary note can be interpreted into a draft document without modifying the note.

Obsidian core Canvas is an import/export adapter. User-authored Canvas is parsed into a draft with explicit ambiguity diagnostics; only a generated or explicitly adopted Canvas is eligible for round-trip updates. Mermaid mindmap is a derived export, not an editable source of truth.

This is preferred over storing only Canvas JSON because Markdown remains reviewable, diffable, searchable, and host-neutral. It is preferred over storing opaque generated JSON because users must be able to understand and repair their data without LLM Wiki.

### 3. Plan/preview/apply for every assisted edit

Parsing, generation, restructuring, and issue conversion produce immutable plans containing:

- exact source revision or content hash;
- proposed node, edge, issue, or external contribution changes;
- provenance and model/provider facts when generation is used;
- warnings, ambiguity choices, and affected paths;
- a stable plan fingerprint.

Apply requires the matching fingerprint, current source revision, actor, and transition token. A mismatch fails closed and requires regeneration. This reuses the repository's dry-run, optimistic-lock, audit, and idempotency conventions.

### 4. Deterministic structure before semantic decoration

Mind-map construction uses explicit structure first: headings, nested lists, block IDs, Canvas connections, wikilinks, Work-OS dependencies, and reviewed graph relations. Model-generated grouping, summaries, or suggested edges are marked as suggestions until the user accepts the preview.

The renderer derives a primary rooted tree for layout and represents non-tree cross-links separately. It applies deterministic ordering, node limits, pruning diagnostics, and a dependency-free tidy-tree layout before considering optional render adapters.

This is preferred over sending the complete graph directly to a renderer because raw causal or backlink graphs are not readable mind maps.

### 5. Provider-neutral Problem Observations

Problem Intake accepts a `ProblemObservation` with:

```text
id, projectId, provider, providerVersion, ruleId, subject
severity, summary, evidenceRefs[], observedAt
sourceFingerprint, observationFingerprint, lifecycle
suggestedAction?, linkedIssue?, linkedContributions?
```

The observation fingerprint is derived from provider identity, rule identity, canonical subject, and normalized evidence identity. Repeated scans update occurrence and verification facts without creating duplicate observations or issues.

Providers include first-party OBC, Host Capability doctor results, allowlisted Obsidian plugin adapters, and explicit Agent/manual reports. Provider output is evidence, not authoritative task state.

### 6. Typed, read-only plugin diagnostic adapters

An approved plugin adapter may discover availability, version, health, and typed problem reports through an allowlisted API contract. It may not execute arbitrary commands, mutate plugin state, read undeclared resources, or inherit authority from plugin installation.

Agent-triggered scans require canonical Project Context, Work Run, Assignment Plan, and Capability Grant. Human-local scans still pass Operation Write Policy before persisting observations. Secrets and plugin-private data are redacted before durable storage.

### 7. Project management remains Work-OS-owned

Problem Intake may produce `IssueChangePlan` records, but apply delegates to `project.issue.create`, `project.issue.update`, or `project.comment.add`. It cannot write issue files directly.

Project Hub adds read-only sections for:

- untriaged and recurring Problem Observations;
- maps linked to the Project and their source freshness;
- observation-to-issue-to-Work-Run-to-verification trace;
- stale or failed plugin diagnostics.

Mind-map nodes may link to canonical issue entities and display derived state, but changing task state routes to Work-OS.

### 8. User-controlled upstream Issue and pull-request contribution

Problem Intake exposes one explicit disposition choice for a reviewed observation:

```text
local_only | submit_issue | prepare_pull_request
```

`local_only` records no external intent. `submit_issue` produces an immutable `ExternalContributionPlan` containing the exact target repository, sanitized title and body, evidence references, labels, linked local observation and Work-OS issue, Settings snapshot, remote-head facts, warnings, and plan fingerprint. Apply first routes canonical local work through Work-OS, then delegates the remote create to the configured Project Tracker projection. It records pending and success receipts and fails closed on an outcome-unknown response.

`prepare_pull_request` is available only when a governed forge adapter can resolve the canonical repository and base revision, an isolated worktree or equivalent sandbox can be created without touching the user's unrelated changes, a bounded fix can be produced, regression tests pass, and a reviewable diff plus test evidence exists. The plan contains base/head revisions, branch or fork target, exact diff summary, changed paths, test commands and results, Issue/observation links, title, body, draft state, warnings, and fingerprint. Failed tests, stale base revisions, unavailable credentials, missing push permission, or an unbounded fix make the PR path unavailable and offer `submit_issue` instead.

Apply is an external side effect. It requires explicit per-run approval, Operation Write Policy, current plan fingerprint, current repository facts, and a fresh transition token. The first release creates a draft pull request after a separate branch-push confirmation; marking it ready is another explicit action, and merge is never performed by this flow. Provider contracts remain host-neutral, with GitHub as the first supported forge.

This keeps continuous improvement inside the product without turning Problem Intake into a Git client or treating remote state as canonical.

### 9. Ask Mate interaction model

Ask Mate provides three initial intents:

1. **Understand this** — read the selected note or Canvas, explain the interpreted structure, and ask focused clarification questions.
2. **Make or revise a map** — generate an edit plan, show a structural/diff preview, and apply after explicit confirmation.
3. **Report or fix a problem** — show deduplicated findings and let the user keep them local, create local work, submit a redacted upstream Issue, or prepare a verified draft pull request. Every step exposes the exact local and remote effects before confirmation.

Ask Mate uses the effective Settings model connection and can degrade to deterministic, non-generative parsing and manual editing when no model is configured. Generated content records provider/model provenance and Usage Events without persisting credentials.

## Risks / Trade-offs

- **[Scope spans UI, two domains, connectors, and project views]** → Deliver vertical slices: Markdown mind-map core first, then Ask Mate preview/apply, then OBC/problem intake, then third-party adapters and Project Hub composition.
- **[User-authored notes and Canvas can be ambiguous]** → Parse into drafts, surface ambiguity diagnostics, and require adoption/confirmation before writes.
- **[LLM generation may invent structure or claims]** → Prefer explicit structure, retain citations, label suggestions, and require user confirmation.
- **[Round-trip editing can overwrite concurrent changes]** → Lock source hashes and revisions; fail closed on drift.
- **[Plugin APIs vary or disappear]** → Keep adapters versioned, typed, health-checked, optional, and isolated behind Host Capability contracts.
- **[Diagnostic floods can overwhelm project management]** → Fingerprint, deduplicate, aggregate occurrences, support dismissal rules, and never create issues automatically.
- **[Diagnostic evidence may leak private vault content]** → Default to bounded summaries and references, redact secrets and machine paths, and let the user edit the exact remote title/body before submission.
- **[Automated fixes may be wrong or overwrite user work]** → Use isolated worktrees, lock base revisions, require regression tests and diff review, and fall back to an Issue when a verified patch cannot be produced.
- **[Remote create responses may be lost or replayed]** → Persist pending/success receipts, block blind retries on outcome-unknown results, and reconcile before another mutation.
- **[Large maps become unreadable or slow]** → Enforce bounded projections, deterministic pruning, collapsed clusters, and explicit truncation diagnostics.
- **[A custom view increases maintenance cost]** → Keep the domain and file format independent of the Obsidian renderer and test Operations without the UI.

## Migration Plan

1. Introduce vocabulary, domain contracts, schemas, and in-memory/reference implementations without changing current exports.
2. Add Markdown import, managed-section serialization, deterministic layout, and MCP Operations behind an experimental setting.
3. Add Ask Mate read/clarify/preview/apply for Markdown maps; keep existing Canvas and project exporters unchanged.
4. Add Problem Intake with a first-party OBC adapter and issue-plan routing.
5. Add the local/Issue/PR disposition flow, GitHub Issue projection, and verified draft-PR adapter behind explicit external-side-effect approval.
6. Add Project Hub triage/visual/contribution projections and approved plugin diagnostic adapters.
7. Add core Canvas adoption/import/export after fixtures prove safe ambiguity handling and hash-locked round trips.
8. Promote the feature from experimental after format, migration, accessibility, performance, contribution safety, and GPL dependency checks pass.

Rollback disables the feature flag and leaves Markdown maps, observations, and audit records readable. Derived Canvas/Mermaid views can be regenerated or removed without deleting canonical notes or Work-OS issues.

## Open Questions

- Should the first editable Markdown syntax use nested lists only, headings plus lists, or support both with one canonical serializer?
- Which Obsidian core Canvas constructs are required for the first safe import slice: text/file nodes and directed edges only, or groups as well?
- Which third-party plugin diagnostic adapters are valuable enough for the first release after OBC?
- Should dismissed Problem Observations use exact fingerprints only or also support reviewed rule/subject suppression patterns?
- What default node and depth limits provide a useful mobile experience?
- After GitHub, should the next contribution provider be Gitea or GitLab?
