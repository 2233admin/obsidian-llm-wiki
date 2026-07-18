## ADDED Requirements

### Requirement: Normalized Mind Map Document
The system SHALL represent every editable or generated mind map as a versioned Mind Map Document with stable node and edge identities, one explicit root, ordered hierarchy, optional cross-links, source provenance, Project identity when scoped, and a deterministic fingerprint.

#### Scenario: Same source is parsed twice
- **WHEN** unchanged Markdown is parsed twice with the same adapter version and options
- **THEN** both results contain the same node identities, ordering, provenance, and document fingerprint

#### Scenario: Invalid hierarchy is supplied
- **WHEN** a document has no root, multiple parent hierarchy edges for one node, a hierarchy cycle, or a dangling edge
- **THEN** validation fails without writing a map or derived view

### Requirement: Obsidian source adapters
The Visual Workspace SHALL read a selected Markdown note or supported Obsidian core Canvas into a draft Mind Map Document without modifying the source and SHALL report unsupported or ambiguous structures explicitly.

#### Scenario: User selects an ordinary Markdown note
- **WHEN** the note contains headings, nested lists, block IDs, or wikilinks
- **THEN** the adapter returns a draft hierarchy with source ranges and ambiguity diagnostics while leaving the note bytes unchanged

#### Scenario: User selects an ambiguous Canvas
- **WHEN** Canvas edges do not define one unambiguous rooted hierarchy
- **THEN** the adapter returns candidate roots or parent choices for confirmation and does not silently discard or reinterpret edges

### Requirement: Markdown-backed editable maps
The system SHALL support a human-readable Markdown mind-map format with stable Obsidian block identities and an LLM Wiki managed section, SHALL preserve content outside that managed section byte-for-byte, and SHALL keep the map searchable through normal vault query surfaces.

#### Scenario: Existing prose surrounds a managed map
- **WHEN** an approved edit updates nodes inside the managed section
- **THEN** only the managed section changes and the surrounding prose remains byte-identical

#### Scenario: Map note is opened without LLM Wiki
- **WHEN** a user views the Markdown in plain Obsidian or another editor
- **THEN** the hierarchy, labels, wikilinks, and citations remain human-readable

### Requirement: Reviewable visual edit plans
Every assisted create, import adoption, restructure, or generated revision SHALL first return an immutable Visual Edit Plan containing the source revision lock, proposed changes, affected paths, provenance, warnings, and plan fingerprint, and apply SHALL require explicit confirmation and an idempotent transition token.

#### Scenario: Source changes after preview
- **WHEN** the source hash or Mind Map Document revision differs from the lock in the approved plan
- **THEN** apply fails closed and requests a fresh preview without partially writing files

#### Scenario: Apply is retried
- **WHEN** the same plan fingerprint and transition token are replayed after a completed write
- **THEN** the system returns the prior result without duplicating nodes, audit events, or projections

### Requirement: Deterministic bounded projections
The system SHALL derive a primary rooted tree before layout, SHALL render non-tree relationships as secondary cross-links, and SHALL produce deterministic Markdown, Obsidian Canvas, and Mermaid mindmap projections with explicit node, depth, and truncation diagnostics.

#### Scenario: Knowledge graph contains many cross-links
- **WHEN** a projection is requested from a graph that is not a tree
- **THEN** the renderer selects a deterministic primary hierarchy and retains eligible cross-links without promoting them to duplicate parents

#### Scenario: Projection exceeds configured limits
- **WHEN** the source has more nodes or depth than the selected projection policy permits
- **THEN** the result is pruned or clustered deterministically and reports what was omitted

### Requirement: Suggestions remain reviewable
Model-generated labels, summaries, groupings, and edges SHALL be marked with generation provenance and SHALL NOT become accepted map structure, durable knowledge, or project work until included in an approved edit or promotion flow.

#### Scenario: Model proposes an unsupported relationship
- **WHEN** a generated edge has no explicit source relation or reviewed citation
- **THEN** the preview marks it as a suggestion and apply requires the user to accept it explicitly
