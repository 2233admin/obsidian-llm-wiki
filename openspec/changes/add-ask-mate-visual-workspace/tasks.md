## 1. Domain vocabulary and contracts

- [ ] 1.1 Add canonical Visual Workspace, Mind Map Document, Visual Edit Plan, Problem Intake, Problem Observation, Issue Change Plan, Problem Disposition, and External Contribution Plan terms to `CONTEXT.md` with authority and avoid-language boundaries.
- [ ] 1.2 Create shared Visual Workspace and Problem Intake package/module skeletons following the Settings Platform and Agent Domain build, export, and test patterns.
- [ ] 1.3 Define versioned TypeScript contracts and strict validators for mind-map nodes, edges, source snapshots, projections, observations, verification facts, issue plans, contribution dispositions, remote submission previews, patch evidence, and receipts.
- [ ] 1.4 Add secret, machine-path, unknown-field, graph-cycle, dangling-edge, and fingerprint validation tests before persistence or Operations are implemented.

## 2. Visual Workspace core

- [ ] 2.1 Implement deterministic Mind Map Document IDs, stable node/block IDs, canonical serialization, revision chains, and content fingerprints.
- [ ] 2.2 Implement a persistence adapter that atomically writes project or global mind-map records while preserving immutable revisions and audit provenance.
- [ ] 2.3 Implement graph validation for one root, ordered hierarchy, optional cross-links, node limits, and explicit ambiguity or truncation diagnostics.
- [ ] 2.4 Add interruption, optimistic-conflict, replay, cross-Project, and malformed-record persistence tests.

## 3. Markdown mind-map vertical slice

- [ ] 3.1 Define and document the first canonical Markdown managed-section syntax using human-readable hierarchy and stable Obsidian block IDs.
- [ ] 3.2 Implement a side-effect-free Markdown source adapter for headings, nested lists, block IDs, wikilinks, source ranges, and ambiguity diagnostics.
- [ ] 3.3 Implement deterministic managed-section serialization that preserves all bytes outside the managed section.
- [ ] 3.4 Implement Visual Edit Plan preview/apply with source-hash locking, affected-path reporting, explicit actor, plan fingerprint, and idempotent transition token.
- [ ] 3.5 Add fixtures proving parse determinism, plain-editor readability, byte-preserving surrounding prose, concurrent-edit rejection, and replay-safe apply.

## 4. Mind-map projections

- [ ] 4.1 Implement deterministic primary-tree selection and secondary cross-link derivation from explicit structure, reviewed relations, and accepted suggestions.
- [ ] 4.2 Implement a dependency-free bounded tidy-tree layout with stable ordering, collapsed clusters, and node/depth truncation diagnostics.
- [ ] 4.3 Implement Mermaid `mindmap` export and a textual hierarchy/cross-link projection with source and citation links.
- [ ] 4.4 Implement Obsidian core Canvas export without changing the existing project workflow Canvas contract.
- [ ] 4.5 Add golden fixtures for deterministic Markdown, textual, Mermaid, and Canvas output across hierarchy, dependency, and causal projection modes.

## 5. Visual Workspace Operations and policy

- [ ] 5.1 Add read, parse, validate, plan, apply, and export Operations with strict input schemas and protocol-neutral Operation Results.
- [ ] 5.2 Extend Operation Write Policy with exact Visual Workspace targets, audit intents, and post-write refresh intents.
- [ ] 5.3 Add Settings definitions for experimental enablement, default projection limits, model-assisted suggestions, and Canvas adoption policy without plugin-private defaults.
- [ ] 5.4 Mount the same Operations in MCP, CLI/reference tests, and the Obsidian production control plane.
- [ ] 5.5 Add cross-host parity, unauthorized-write, stale-plan, audit, and settings-doctor tests.

## 6. Ask Mate minimum usable experience

- [ ] 6.1 Add an Obsidian Ask Mate ItemView and commands that explicitly identify the active note, selection, supported Canvas, mind map, and canonical Project Context.
- [ ] 6.2 Implement the `Understand this` flow with deterministic source interpretation, source links, ambiguity display, and focused clarification prompts.
- [ ] 6.3 Implement the `Make or revise a map` flow with structural preview, suggestion selection, affected-file diff, warnings, confirmation, and apply result.
- [ ] 6.4 Reuse effective Settings model configuration, Agent Domain Thread identity, Usage Events, and safe degraded mode when generation is unavailable.
- [ ] 6.5 Add keyboard navigation, textual tree mode, accessible labels, view-state restoration, and mobile-bounded layout behavior.
- [ ] 6.6 Add Obsidian integration tests proving no write before confirmation, no parallel canonical state in plugin data, failed generation recovery, and Project-context isolation.

## 7. Problem Intake core

- [ ] 7.1 Implement canonical Problem Observation fingerprints, lifecycle transitions, occurrence aggregation, verification history, and suppression-policy contracts.
- [ ] 7.2 Implement bounded persistence with revision locking, audit provenance, secret redaction/rejection, and cross-Project isolation.
- [ ] 7.3 Implement provider-neutral intake and scan-result normalization without writing notes, issues, or plugin state.
- [ ] 7.4 Implement Issue Change Plan preview/apply that deduplicates against linked or matching authoritative issues and delegates writes only to Project Operations.
- [ ] 7.5 Implement immutable External Contribution Plan records for `local_only`, `submit_issue`, and `prepare_pull_request`, including exact target/content/effect previews and explicit external-side-effect approval.
- [ ] 7.6 Add tests for recurrence, meaningful evidence changes, dismissal/reopen, non-reproduction verification, duplicate-issue prevention, idempotent issue routing, missing consent, and contribution-plan staleness.

## 8. OBC and third-party plugin diagnostics

- [ ] 8.1 Add a first-party OBC diagnostic adapter that invokes one shared OBC engine and normalize broken-link, orphan, stale, and safe-fix-plan findings into Problem Observations.
- [ ] 8.2 Route or replace the duplicate `vault.lint` link-diagnostic implementation through the shared OBC engine while preserving compatibility output and tests.
- [ ] 8.3 Define the versioned typed Obsidian plugin diagnostic adapter contract, descriptor fields, resource scopes, health results, and bounded finding schema.
- [ ] 8.4 Implement Host Capability proxy enforcement for diagnostic operations, including Project Context, Work Run, Assignment Plan, Capability Grant, allowlist, timeout, and output-schema checks.
- [ ] 8.5 Implement one low-risk reference plugin diagnostic adapter selected from existing installed/open-source plugin workflows without exposing arbitrary command execution.
- [ ] 8.6 Add malicious adapter, undeclared payload, missing grant, secret leak, unavailable plugin, version drift, and repeated-scan tests.

## 9. Project management and traceability

- [ ] 9.1 Add Project Hub read models for visual workspace freshness, untriaged/recurring observations, provider health, linked issues, Work Runs, and verification evidence.
- [ ] 9.2 Add Ask Mate `Report or fix a problem` triage flow with multi-select, duplicate explanation, local/Issue/PR disposition, exact previews, explicit apply, and result links.
- [ ] 9.3 Add derived issue state and Work Run status overlays to mind-map nodes while routing every task mutation to Work-OS Operations.
- [ ] 9.4 Extend Bases, Canvas, and textual Project projections with observation and map links without making any derived view authoritative.
- [ ] 9.5 Add end-to-end tests from plugin/OBC finding through observation, issue proposal, upstream Issue or PR link, Work Run trace, verification, and regenerated project views.

## 10. User-approved upstream Issue and pull-request contribution

- [ ] 10.1 Implement provider-neutral contribution preflight for repository identity, default branch, base revision, credential-free binding, permissions, fork policy, and capability health, with GitHub as the first provider.
- [ ] 10.2 Implement secret-safe upstream Issue planning that links a reviewed local Work-OS issue and exposes the exact editable target, title, body, evidence, labels, redactions, and warnings.
- [ ] 10.3 Implement upstream Issue apply through the existing Project Tracker projection with explicit per-run approval, pending/success receipts, idempotent replay, and outcome-unknown reconciliation.
- [ ] 10.4 Implement isolated fix preparation that never modifies unrelated user work, records base/head facts, produces a bounded diff, adds or updates a regression test, and captures deterministic test evidence.
- [ ] 10.5 Implement PR eligibility checks that reject failed tests, stale bases, unbounded changes, secret-bearing diffs, missing push permission, and unresolved repository identity while offering Issue fallback.
- [ ] 10.6 Implement separately confirmed branch/fork push and draft pull-request creation with replay-safe receipts, linked observation/local issue, and no ready-for-review or merge side effect.
- [ ] 10.7 Implement a separately previewed ready-for-review transition; keep merge explicitly outside Problem Intake and Ask Mate.
- [ ] 10.8 Add end-to-end tests for keep-local, cancellation at every step, editable redaction, duplicate remote Issue prevention, dirty-worktree isolation, failed tests, stale base, lost provider response, draft-only creation, and no automatic merge.

## 11. Core Canvas adoption and safe round trip

- [ ] 11.1 Implement read-only core Canvas import for text nodes, file nodes, directed edges, and explicit unsupported-construct diagnostics.
- [ ] 11.2 Implement candidate-root and candidate-parent clarification for ambiguous user-authored Canvas files.
- [ ] 11.3 Implement explicit Canvas adoption and hash-locked round-trip updates only for generated or adopted files.
- [ ] 11.4 Add fixtures proving ambiguous Canvas never writes silently, unsupported nodes remain visible in diagnostics, and concurrent edits fail closed.

## 12. Documentation, compatibility, and release gates

- [ ] 12.1 Update architecture, local project management, Agent workflow integration, MCP tool reference, Obsidian plugin guide, contribution guide, privacy disclosure, and Chinese user documentation.
- [ ] 12.2 Document the GPL-3.0-only implementation, third-party notice rules, supported free/core integrations, contribution provider boundaries, data formats, backup, recovery, and feature-disable path.
- [ ] 12.3 Add migration and doctor checks for schema versions, corrupt revisions, stale projections, missing adapters, orphan observations, linked-issue drift, stale contribution plans, and outcome-unknown receipts.
- [ ] 12.4 Run targeted unit and integration tests, Obsidian plugin tests, MCP build/typecheck, Python OBC tests, contribution adapter tests, OpenSpec validation, dependency/license audit, and a clean-vault smoke scenario.
- [ ] 12.5 Keep the feature experimental until accessibility, mobile bounds, format round trips, permission failures, contribution safety, privacy redaction, and no-paid-plugin acceptance scenarios pass.
