# Markdown-First Data Views Internalization Design

**Status:** Draft for review  
**Date:** 2026-08-27  
**Scope:** Clean-room internalization of the product ideas observed in the Obsidian Components reference project

## 1. Decision summary

LLM Wiki will internalize the reference project's useful product ideas as an
independent, Markdown-first data-view capability. It will not copy, embed,
reverse-engineer, or become runtime-compatible with the reference plugin.

The architecture combines two decisions:

1. **Managed Markdown configuration** is the durable representation of a data
   view definition.
2. **A host-neutral query and view-model core** computes deterministic results;
   Obsidian, MCP, and CLI surfaces render or preview those results.

Canvas/layout is a later projection. It is not the authority for query state,
row data, or source content.

The first implementation slice is a complete vertical path for Table and
Kanban views backed by Markdown/frontmatter, including controlled property
edits through the existing immutable `VisualEditPlan` boundary.

## 2. Reference ideas and clean-room boundary

The reference material establishes product-level ideas, not an implementation
contract:

- Markdown-like content can be presented as visual components.
- One source set can support multiple views such as table, gallery, kanban,
  calendar, and chart.
- A page can be composed from multiple blocks.
- Components can participate in workflows through controlled actions.

The allowed internalization input is limited to those ideas, public product
labels, public documentation, release metadata, and independently observed
sample data. The implementation must remain independently designed and
written.

The following are explicitly out of scope:

- importing the reference bundle or its source code;
- decompiling or reproducing bundled implementation logic;
- parsing or writing the reference `.components` runtime format;
- claiming compatibility with its undocumented persistence or execution model;
- distributing a derivative of its bundle or dependencies.

The feature name, schema names, module names, algorithms, and persistence
format in this design belong to LLM Wiki.

### 2.1 Evidence from the supplied templates

The supplied vault templates add concrete product evidence beyond the public
release metadata:

- `*.components` files persist a graph of reusable components with stable IDs.
- `multi` containers compose children as list, column, tab, or grid layouts.
- Grid layouts carry separate mobile and laptop coordinates, showing that
  responsive composition is a first-class concern.
- `dynamicDataView` components define typed properties such as text, select,
  multi-select, number, image, date, formula, task list, and button.
- Data views support nested boolean filter groups, relative-time predicates,
  sorting, grouping, pagination, templates, and “create new page” behavior.
- Practical templates combine views with business workflows: PARA
  classification, journal and emotion tracking, habit logging, inventory
  management, file relocation, and project task capture.
- Dashboards combine count cards, progress indicators, charts, calendars,
  quotes, navigation buttons, references, and time-based widgets.
- Custom components can read vault files, metadata, Dataview state, local
  component storage, and external resources; this explains their flexibility
  but also identifies arbitrary code execution and opaque side effects as a
  boundary we must not inherit.
- Sample records remain ordinary Markdown/frontmatter: journal notes,
  inventory notes, and PARA notes are the durable business data.

### 2.2 Requirements derived from the templates

The internalized architecture must account for four distinct layers:

```text
source records
    ↓
query and aggregation
    ↓
view and dashboard composition
    ↓
typed, reviewable actions
```

The first vertical slice remains Table and Kanban, but the architecture must
reserve explicit extension points for:

- composite containers (`stack`, `columns`, `tabs`, `grid`) with responsive
  layout profiles;
- nested boolean predicates, relative-time windows, aggregates, and typed
  derived values;
- template-driven record creation and domain-specific workflows;
- typed actions such as open source, invoke a registered command, create from a
  template, patch a property, or move a source file.

These extension points do not authorize arbitrary scripts. Every future action
must resolve to an allowlisted intent with source provenance and an immutable
edit or execution plan. Dashboard layout must remain separate from source
records and query results, so it can be rebuilt without data loss.

The templates also establish an important product principle: users do not want
to configure an abstract query engine first. They want a useful dashboard for
an actual domain such as projects, journals, habits, or inventory. The
implementation should therefore ship domain-oriented examples and templates
over the same generic contracts rather than exposing only low-level primitives.

## 3. Product goals

### 3.1 Goals

- Let users define a reusable view over ordinary Markdown pages.
- Keep Markdown, frontmatter, properties, and stable block identities as the
  only source of truth.
- Offer a single query model for Table, Kanban, and later projections.
- Make every displayed value traceable to a vault-relative source and range.
- Make controlled edits reviewable, fingerprinted, conflict-safe, and atomic.
- Reuse the same domain behavior from the Obsidian plugin, MCP server, and CLI.
- Make missing fields, malformed sources, unknown values, and conflicts
  visible instead of silently guessing.
- Leave room for Gallery, Calendar, Chart, and Canvas without coupling those
  projections to the query engine.
- Support composed dashboards built from reusable view blocks, with responsive
  layout profiles kept separate from source records.


### 3.2 Non-goals

- Replacing the Markdown compiler or changing vault truth rules.
- Introducing a private database, daemon, index service, or cloud runtime.
- Making Python, MemU, Graphify, or another external worker a runtime
  prerequisite.
- Executing arbitrary JavaScript, JSX, shell commands, or network requests from
  a view definition.
- Building a full drag-and-drop page editor in the first slice.
- Implementing every reference-project feature before the first vertical slice
  is verified.

## 4. Architectural principles

1. **Markdown authority:** durable query definitions and source content live in
   ordinary Markdown and existing vault metadata.
2. **Projection purity:** a renderer may derive display state but may not own
   source data or silently persist changes.
3. **Source traceability:** every row and field carries a source reference when
   one exists.
4. **Determinism:** the same source snapshot and query produce the same model,
   diagnostics, ordering, and fingerprint.
5. **Explicit uncertainty:** missing, malformed, unsupported, and inferred
   values remain distinguishable.
6. **Controlled mutation:** all writes become immutable plans and require an
   explicit host confirmation.
7. **Host-neutral core:** domain behavior is independent of Obsidian, Node file
   APIs, MCP transport, and Python.
8. **Explicit evolution:** schema changes use a new version rather than
   silently changing v1 semantics.
9. **Boring security:** no eval, no implicit code execution, no vault escape,
   and no secret-bearing persisted configuration.

## 5. System architecture

```text
Managed Markdown dashboard or data-view block
              |
              v
  strict parser and validator
              |
              v
  host-provided immutable source snapshots
              |
              v
       declarative query evaluator
              |
              v
     DataViewModel + diagnostics
              |
              v
      dashboard composition layer
        /          |           \
       v           v            v
    Table       Kanban       later views
        \          |           /
         v         v          v
      Plugin / MCP preview / CLI JSON
              |
              v
          VisualEditPlan
                |
                v
       explicit host confirmation
                |
                v
          atomic persistence
```

### 5.1 Domain core

`packages/visual-workspace` owns the behavior:

- data-view types;
- strict validation;
- managed Markdown parsing and canonical serialization;
- source snapshot input contracts;
- query evaluation;
- Table and Kanban projections;
- source-aware action planning;
- diagnostics and deterministic fingerprints.

The package does not read the filesystem or call external services.

### 5.2 Shared wire contracts

`packages/agent-wiki-contracts` owns JSON-safe, versioned contracts when the
same definitions or results cross Plugin, MCP, and CLI boundaries. Its schemas
and fixtures remain the canonical wire representation. The domain package
remains the implementation of behavior and invariants.

### 5.3 Obsidian plugin

The plugin is the primary human-facing surface. It:

- reads Markdown and metadata through the Obsidian host;
- builds source snapshots;
- renders Table and Kanban models;
- opens source notes from source references;
- presents diagnostics and previews;
- requests explicit confirmation before applying a plan;
- persists the result atomically through the host boundary.

The plugin does not redefine query semantics or maintain a second component
schema.

### 5.4 MCP server

The MCP surface exposes three narrow operations:

- `visual_workspace.discover` — find data-view definitions and supported source
  scopes;
- `visual_workspace.preview` — return deterministic rows, diagnostics,
  provenance, and an optional preview;
- `visual_workspace.plan` — create an immutable plan for a supported action.

MCP does not directly write vault files. Any future apply capability must
preserve the presented plan fingerprint, actor, transition token, source lock,
and confirmation rules already required by `visual-workspace`.

### 5.5 CLI

The CLI reuses the domain core for reproducible diagnostics and automation:

```text
llmwiki view validate <path>
llmwiki view query <path> --json
llmwiki view preview <path> --action ...
```

CLI output is diagnostic or preview output. It does not own a separate query
engine or renderer.

### 5.6 Python and external workers

The first slice has no Python or external-worker dependency. An eventual index
may be a read-side accelerator only. It must return verifiable source
references, and the vault snapshot remains authoritative.

## 6. Persistence format

A data-view definition is stored in a managed block with an explicit version:

```md
<!-- llmwiki:data-view:v1 {"id":"release-board","title":"Release Board","view":"kanban"} -->
{
  "view": "kanban",
  "source": {"kind":"folder","path":"01-Projects/releases"},
  "select": [
    {"field":"title","label":"Title"},
    {"field":"status","label":"Status"},
    {"field":"priority","label":"Priority"}
  ],
  "where": {
    "field":"status",
    "operator":"in",
    "value":["todo","in-progress"]
  },
  "groupBy":"status",
  "orderBy":[{"field":"priority","direction":"asc"}]
}
<!-- /llmwiki:data-view:v1 -->
```

The exact canonical serializer will normalize JSON key order and preserve
bytes outside the managed range, following the existing mind-map Markdown
contract.

Unknown fields, duplicate IDs, invalid markers, unsupported operators, invalid
source scopes, and malformed JSON are errors. The parser does not silently
ignore them.

Query configuration and view configuration are separate conceptual objects,
even when v1 serializes them in one managed block. This permits later layout
or renderer options to evolve without changing query meaning.

## 7. Source model

The host supplies immutable snapshots rather than the domain core opening
files:

```ts
interface WorkspaceSource {
  path: string;
  sha256: Sha256Digest;
  title: string;
  frontmatter: Record<string, JsonValue>;
  blocks: readonly SourceBlock[];
}
```

A field value keeps its origin:

```ts
interface SourceValue {
  value: JsonValue | null;
  source: {
    path: string;
    range?: SourceRange;
    blockId?: string;
    field?: string;
  };
}
```

Source paths are vault-relative. Absolute machine paths, credentials, and
secret-bearing values are rejected from persisted definitions and provenance.

A page without a stable block identity is identified by its normalized
vault-relative path. Array position is never an identity.

## 8. Query model and semantics

### 8.1 Supported v1 source scopes

- one explicit file;
- one vault-relative folder;
- an explicit list of vault-relative files.

The host owns discovery within the allowed vault root. The domain core
receives the resulting snapshots and does not traverse outside the scope.

### 8.2 Supported v1 fields

- page title;
- vault-relative path;
- frontmatter/property values;
- supported block or property references supplied by the host.

### 8.3 Supported v1 expressions

Filters support only:

- `equals`;
- `in`;
- `exists`;
- `contains`.

Sorting supports strings, numbers, dates, and paths. Grouping supports one
field. Dates use an explicit normalized representation; they do not depend on
machine-local timezone behavior.

Arbitrary expressions, recursion, network calls, shell commands, and implicit
query chaining are not part of v1.

### 8.4 Unknown and malformed values

- A missing field is `unknown`, not an empty string.
- A field with an unsupported type is `unknown` with a diagnostic.
- A malformed source produces a source diagnostic; valid sources may still be
  returned.
- An invalid query prevents that view from executing.
- Diagnostics are returned alongside valid results and are visible to every
  host surface.

### 8.5 Stable ordering

The evaluator applies the explicit sort order first. Equal values use the
vault-relative source path as a deterministic tie-breaker. Group order uses an
explicit `groupOrder` when present; otherwise unlisted values use stable
lexicographic order after listed values.

The same immutable snapshots and query must yield identical rows, groups,
diagnostics, and fingerprints.

## 9. View model and projections

All renderers consume one intermediate model:

```ts
interface DataViewModel {
  schemaVersion: 1;
  queryId: string;
  columns: readonly DataViewColumn[];
  rows: readonly DataViewRow[];
  groups: readonly DataViewGroup[];
  diagnostics: readonly DataViewDiagnostic[];
}

interface DataViewRow {
  id: string;
  source: VisualSourceReference;
  values: Record<string, SourceValue>;
}
```

### 9.1 Table

Table is the baseline projection:

- columns follow the query's select order;
- row identity is source identity;
- clicking a row opens its source;
- sorting, grouping, and column visibility are renderer state;
- renderer state is not written to the source;
- property edits target the smallest resolvable source range.

### 9.2 Kanban

Kanban requires one `groupBy` field:

- each unique value becomes a column;
- missing values go to a fixed `unknown` column;
- explicit group order wins, with stable ordering for other values;
- moving a card means changing the group field;
- a move creates a controlled property-edit plan;
- any stale source lock rejects the entire move, not only one card.

### 9.3 Composition model

Dashboard composition is a separate projection over view blocks. Its v2
extension points are:

- `stack` for ordered vertical composition;
- `columns` for responsive horizontal composition;
- `tabs` for alternate views over related data;
- `grid` for explicit block placement;
- `reference` for reusing a named view or component definition.

Composition nodes have stable IDs and may carry mobile and laptop layout
profiles. They reference view definitions; they do not duplicate query results
or source records. Removing or corrupting a layout must leave the underlying
view definitions valid and allow a deterministic default layout to be rebuilt.

The first slice renders one view at a time. It does not persist drag-and-drop
coordinates.

### 9.4 Later projections


The architecture reserves, but does not implement in v1:

- Gallery, using an explicitly typed image/file field;
- Calendar, using an explicit date field and timezone;
- Chart, consuming typed aggregate values rather than arbitrary expressions;
- Canvas, arranging view blocks as a derived layout.

None of these projections may become the authority for query state or source
content.

## 10. Action and write-back model

Actions are risk-tiered:

```text
read-only
  open source, filter, sort, group, preview

write intent
  edit property, move Kanban card, batch update

execution
  explicit apply after plan confirmation
```

The first slice supports only property edits and Kanban moves. Both resolve
source references, validate the current source, and call the existing
`createVisualEditPlan` path.

A plan contains:

- complete before and after snapshots;
- source SHA-256 locks;
- affected vault-relative paths;
- query/view/action provenance;
- warnings and diagnostics;
- plan fingerprint.

Applying a plan requires the presented fingerprint, confirming actor, fresh
transition token, complete source lock, and matching before snapshot. A
multi-file plan is all-or-nothing. Replaying the same request returns its
recorded result and does not apply twice.

A renderer never performs a direct filesystem write.

## 11. Error model

Errors are categorized and preserved across host boundaries:

- `ParseError` — invalid managed block or schema;
- `QueryError` — invalid scope, operator, or field semantics;
- `SourceDiagnostic` — one source is malformed, incomplete, or unsupported;
- `ConflictError` — source changed after the snapshot or plan;
- `LimitError` — configured scope or result limit exceeded;
- `ApplyError` — fingerprint, actor, token, or confirmation mismatch.

Parse and query errors stop the affected view. Source diagnostics may coexist
with valid rows. Conflict and apply errors prevent every part of a plan from
being written.

MCP maps errors to `{ code, message, kind }`, where `code` and `message` remain
compatible with the server's unified error response. Messages identify the
query, source, or field involved when available.

## 12. Limits and observability

Every query has explicit limits for source count, result rows, nesting depth,
and files per edit plan. Exceeding a limit returns a diagnostic; it never
silently truncates data.

Each query, preview, and plan emits a structured trace containing:

```text
queryId
sourceCount
rowCount
diagnosticCount
unknownValueCount
duration
sourceHashes
planFingerprint
```

Traces never contain complete Markdown, secret values, absolute machine paths,
or unconfirmed write results.

## 13. Security requirements

The implementation must reject or prevent:

- `eval`, `Function`, arbitrary JSX, or arbitrary script execution;
- network requests initiated by a view;
- shell or process execution initiated by a view;
- reads outside the vault root;
- persisted credentials, tokens, or absolute machine paths;
- renderer paths that bypass source locks or apply confirmation;
- reference-project bundle or private-format compatibility behavior.

The plugin, MCP server, and CLI must all use the same validation and planning
rules. Security behavior cannot be weakened by choosing a different host.

## 14. Versioning and extension

The first durable format is `llmwiki:data-view:v1`.

- Unknown fields are rejected in v1.
- A semantic change creates v2 rather than changing v1 interpretation.
- Migrations produce a preview and do not directly modify a user's file.
- Query, view options, layout, and action request can evolve independently.
- Existing v1 renderers remain able to consume unchanged v1 models.

The planned capability sequence is:

```text
v1    query + Table/Kanban + controlled property edits
v1.x  deterministic limits, diagnostics, formatting improvements
v2    Gallery/Calendar/Chart projections
v2.x  Canvas layout projection and responsive block arrangement
v3    typed declarative actions and custom component descriptions
```

If custom components are introduced, v3 will use typed component descriptions,
known renderers, typed inputs, and allowlisted actions. It will not turn view
configuration into an arbitrary code execution surface.

## 15. Verification plan

The implementation must provide four fixture families:

1. parser and validator fixtures for valid and invalid managed blocks;
2. deterministic query-result fixtures for filters, sorting, grouping, missing
   fields, and stable tie-breaking;
3. Table and Kanban projection fixtures, including `unknown` grouping;
4. stale-lock, malformed-source, limit, partial-failure, and replay fixtures.

Required behavioral checks:

- equal snapshot/query inputs produce equal models and fingerprints;
- unknown values remain distinguishable from empty values;
- invalid operators and unknown fields are rejected;
- every row and editable field has a source reference;
- Kanban moves alter only the intended property range;
- stale source locks produce zero writes;
- multi-file plans are atomic;
- replay does not duplicate a write;
- MCP and CLI serialization matches shared contract fixtures;
- Obsidian renders the same model and exposes its diagnostics.

The first slice is complete only after domain tests, shared contract tests,
MCP/CLI contract tests, and an Obsidian smoke path all pass.

## 16. Delivery sequence

1. Define and test the shared v1 contract.
2. Implement source snapshot, managed block, query, and diagnostic behavior in
   `visual-workspace`.
3. Implement Table and Kanban projections and controlled action planning.
4. Add the Obsidian source adapter and renderer.
5. Add MCP discover/preview/plan integration.
6. Add CLI validation/query/preview commands.
7. Run cross-surface fixtures and the Obsidian smoke path.
8. Document the user-facing Markdown format and migration/rollback behavior.

No later projection or reference-project feature may bypass the v1 contract,
source traceability, or edit-plan boundary.

## 17. Acceptance criteria

This design is ready for implementation when the user approves it and the
implementation plan decomposes the delivery sequence into independently
verifiable slices.

The implementation will be accepted when:

- a user can define a v1 data view in ordinary Markdown;
- the same definition produces deterministic Table and Kanban models;
- every result can be traced back to its source;
- missing and malformed data are explicit;
- controlled edits produce reviewable immutable plans;
- stale or conflicting sources cause no partial writes;
- Plugin, MCP, and CLI agree on the shared contract;
- no arbitrary code execution, vault escape, or private-format compatibility
  has been introduced.
