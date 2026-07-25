---
type: issue
entity: project/obsidian-llm-wiki/issue/add-ask-mate-visual-workspace
state: done
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/add-ask-mate-visual-workspace
description: Build Ask Mate, interactive mind maps, governed problem intake, and user-approved Issue or PR contribution.
status: active
priority: 1
blocked-by: []
assignee: codex
last-verified: 2026-07-19
labels:
- ready-for-agent
- ask-mate
- mind-map
- problem-intake
- obsidian-plugin
- project-management
---
# Add Ask Mate Visual Workspace

## Outcome

Deliver a GPL-3.0-only Obsidian experience that can read user-authored Markdown or supported core Canvas structures, clarify and generate mind maps interactively, turn reviewed OBC or approved plugin findings into canonical Work-OS tasks, and let users explicitly keep a product problem local, submit a redacted upstream Issue, or prepare a verified draft pull request.

The first release uses a structured outline with live deterministic visual preview and confirmed write-back. Direct node dragging and installed ecosystem mind-map extensions are optional enhancements, not core dependencies.

## Architecture

- Visual Workspace owns Mind Map Documents, safe edit plans, and deterministic projections.
- Graphify is an important optional Knowledge Adapter: its extracted, inferred, ambiguous, or unknown relations remain provenance-bearing suggestions until the user accepts them.
- Problem Intake owns diagnostic observations, deduplication, triage, and issue proposals.
- Ask Mate is the Obsidian interaction surface and owns no parallel domain state.
- Work-OS Markdown issues remain the only authoritative project work state.
- Host Capability adapters remain typed, allowlisted, permission-gated, and read-only for diagnostic discovery.
- Problem Intake owns contribution choice and immutable previews; governed tracker/forge adapters own confirmed remote side effects.
- Pull requests require isolated changes, regression evidence, exact diff review, and separate push/create confirmation; the flow never merges automatically.

## Implementation Contract

OpenSpec change: `openspec/changes/add-ask-mate-visual-workspace/`

Implementation follows that change's proposal, design, capability specs, and eight tracer-bullet tasks. The first usable vertical slice is Markdown mind-map read, outline editing, live preview, and hash-locked apply; Graphify-assisted suggestions, Ask Mate, Problem Intake/OBC, optional plugin diagnostics, and Project Hub traceability follow without making Graphify or an ecosystem plugin a source of truth.

## Current Progress

- [x] First-release product boundary is locked: outline editing and live preview are core; direct node dragging and ecosystem mind-map plugins are optional.
- [x] Domain vocabulary, OpenSpec proposal/design/capability deltas, eight tracer bullets, and primary-source prior-art review are landed in the working change.
- [x] The shared graph edge contract and Graphify adapter retain aggregated relation, confidence, adapter identity, and source evidence, with graceful degradation and regression coverage.
- [x] The first managed-map vertical slice is implemented: shared Domain validation, byte-preserving Markdown round trip, immutable preview, source-hash conflict rejection, replay receipts, MCP parity, and an Obsidian Ask Mate outline/preview/confirm surface.
- [x] Graphify runtime settings and the shared read-only adapter graph facade are activated; Obsidian treats Graphify evidence as optional, provenance-bearing review context and degrades without blocking outline editing.
- [x] Ordinary Markdown/Canvas adoption, deterministic text/Mermaid/Canvas projections, ambiguity review, and first-party map creation are implemented through Visual Edit Plans.
- [x] Problem Intake/OBC, approved plugin diagnostics, Project Hub traceability, upstream Issue submission, and verified draft-PR preparation are implemented through production composition roots.

## Verification

- Visual Workspace package: 27 tests passed; typecheck and build passed.
- Problem Intake package: 20 tests passed; typecheck and build passed.
- Obsidian plugin: 63 tests passed; typecheck, production build, and bundle-boundary verification passed.
- MCP focused integration: 108 tests passed, including Forge, Problem Intake, Project Hub, plugin diagnostics, Visual Workspace, tool-document parity, and isolated slow VaultBrain checks.
- MCP production build passed and generated bundles were rebuilt.
- Release security: 26 tests passed; offline release gate passed with all findings empty and GPL-3.0-compatible runtime licenses reviewed.
- OpenSpec strict validation passed.

## Acceptance

- A user can create and revise a useful mind map directly in Obsidian without a paid mind-map plugin.
- A user can complete the first-release outline/preview/apply loop when Graphify and all third-party mind-map plugins are unavailable.
- When Graphify is available, extracted and inferred relations remain visibly distinct, source-linked, and opt-in.
- User-authored notes or supported Canvas files are read without modification and ambiguous structure is confirmed before adoption.
- No generated map or issue mutation is applied before a visible preview and explicit confirmation.
- Repeated OBC or plugin findings deduplicate into provenance-bearing observations.
- Approved findings route through Project Operations to create or update Work-OS issues.
- A user can keep a finding local, submit an editable and secret-safe upstream Issue, or prepare a pull request only when a bounded isolated fix passes its declared regression tests.
- No remote Issue, branch push, pull request, ready-for-review transition, or merge occurs from diagnostic collection or model output alone.
- Remote create operations are replay-safe after a durable receipt, and outcome-unknown responses block blind retry.
- Project Hub can trace map nodes and observations through issue, Work Run, and verification state.
- Strict OpenSpec validation, domain tests, Obsidian integration tests, OBC tests, typecheck/build, and GPL dependency checks pass.
