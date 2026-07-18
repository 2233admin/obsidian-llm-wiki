## ADDED Requirements

### Requirement: Obsidian-native Ask Mate surface
The Obsidian plugin SHALL provide an Ask Mate interaction surface that can operate on the active note, selected text, selected Mind Map Document, supported Canvas, or current Project Context without requiring a paid or third-party mind-map plugin.

#### Scenario: User opens Ask Mate from a note
- **WHEN** a Markdown note is active
- **THEN** Ask Mate identifies the selected context, shows what will be read, and offers understand, map, and problem-to-work intents

#### Scenario: No supported context is selected
- **WHEN** the active view cannot be interpreted safely
- **THEN** Ask Mate explains the supported inputs and performs no implicit vault scan or write

### Requirement: Interactive clarification before structure changes
Ask Mate SHALL surface ambiguous roots, parent-child relationships, labels, scope, and desired output as focused clarification choices before producing a Visual Edit Plan when those choices materially change the map.

#### Scenario: Two plausible map roots exist
- **WHEN** selected content yields two equally plausible roots
- **THEN** Ask Mate presents both with source evidence and waits for the user's choice before planning a write

### Requirement: Preview and explicit apply
Ask Mate SHALL display structural changes, affected files, generated content provenance, warnings, issue mutations, and any remote Issue or pull-request target/content/diff/test evidence before apply, and SHALL invoke only the matching domain apply Operation after explicit user confirmation.

#### Scenario: User rejects part of a generated map
- **WHEN** the user deselects suggested nodes or edges in preview
- **THEN** Ask Mate creates or requests a revised plan whose fingerprint covers only the accepted changes

#### Scenario: User closes the view during preview
- **WHEN** no apply confirmation has been submitted
- **THEN** no map, Project issue, plugin state, durable knowledge, remote Issue, branch push, or pull request is changed

### Requirement: User-controlled problem reporting and fixing
Ask Mate SHALL offer `Keep local`, `Submit Issue`, and `Prepare pull request` for a reviewed product problem, SHALL explain unavailable choices, and SHALL preserve the user's ability to edit or remove every externally submitted field.

#### Scenario: User chooses Submit Issue
- **WHEN** the user reviews a finding and selects `Submit Issue`
- **THEN** Ask Mate shows the exact target, title, body, bounded evidence, redactions, local issue effect, and remote effect before requesting confirmation

#### Scenario: User chooses Prepare pull request
- **WHEN** a governed forge binding and verified isolated patch are available
- **THEN** Ask Mate shows the exact diff, changed paths, base/head facts, test evidence, branch or fork target, title, body, and draft state before offering separate push and create confirmations

#### Scenario: User cancels remote submission
- **WHEN** the user cancels at report preview, diff review, branch push, or pull-request creation
- **THEN** later external steps do not execute and the local observation remains usable for another disposition

### Requirement: Domain authority boundaries
Ask Mate SHALL use Agent Domain for durable Thread identity, Settings Platform for model and provider configuration, Visual Workspace for map behavior, Problem Intake for findings and contribution plans, Work-OS for local issue changes, and governed tracker/forge adapters for remote mutations, and SHALL NOT persist parallel copies of their canonical state in plugin data.

#### Scenario: Project issue state is changed from a map node
- **WHEN** a user requests a task transition through Ask Mate
- **THEN** the request is routed to the canonical Project operation and the map only refreshes its derived issue projection

### Requirement: Deterministic degraded mode
Ask Mate SHALL remain usable for parsing, manual restructuring, preview, apply, diagnostics review, and issue routing when no model provider is configured or the configured model is unavailable.

#### Scenario: Model call fails
- **WHEN** generation times out or the provider is unavailable
- **THEN** Ask Mate preserves the current draft, reports a safe failure, and offers deterministic parsing and manual editing without partial writes

### Requirement: Accessible and inspectable interaction
Ask Mate SHALL expose keyboard-operable navigation, textual tree and change representations, and source links for every visual node so that core workflows do not depend solely on spatial rendering.

#### Scenario: User switches to textual map view
- **WHEN** a mind map is open
- **THEN** the same node hierarchy, cross-links, statuses, and validation warnings are available in an ordered textual representation
