# Markdown-First Data Views Internalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent LLM Wiki data-view format, import supported semantics from user-provided Components templates, and expose deterministic Table/Kanban workflows through the existing visual-workspace safety boundary.

**Architecture:** Keep the domain core host-neutral. A read-only importer converts `.components`, supported archive members, and ordinary Markdown/frontmatter templates into LLM Wiki definitions and an immutable import plan. The same query/view model is consumed by Obsidian, MCP, and CLI adapters. Renderer technology stays behind an adapter boundary; GPUix is a later spike and is not a dependency of this plan.

**Tech Stack:** TypeScript 7, Node.js 20+, Bun test runner, JSON Schema, existing `@obsidian-llm-wiki/visual-workspace`, existing `@obsidian-llm-wiki/agent-wiki-contracts`, MCP operations, Obsidian plugin TypeScript, `fflate` for bounded ZIP reads.

**Spec:** `docs/superpowers/specs/2026-08-27-components-internalization-design.md`

## Global Constraints

- Markdown, frontmatter, properties, and stable block IDs remain the only source of truth.
- Reference `.components` and ZIP artifacts are import inputs only; LLM Wiki does not write that format or promise runtime compatibility.
- The importer must never execute `viewCode`, `settingsCode`, `runScript`, `dataviewjs`, JSX, shell commands, or network requests.
- Generated definitions use the LLM Wiki `llmwiki:data-view:v1` and dashboard formats, not the reference schema.
- Every imported item retains input identity, SHA-256, source location, and observed/claimed/unsupported status.
- Every editable result resolves to source references and an immutable `VisualEditPlan`.
- Unknown, malformed, unsupported, and ambiguous values remain explicit diagnostics.
- Source paths are vault-relative; absolute machine paths and secrets never enter persisted output.
- Multi-file plans are all-or-nothing and must reject stale source locks before writing.
- Python, MemU, Graphify, Electron, and GPUix are not runtime prerequisites for the first implementation.
- Do not add generated bundles or private vault contents to Git.
- Run focused tests during each task; run the full package/typecheck matrix only at the final verification task.

---

## File and module map

The implementation follows existing boundaries instead of creating a second
runtime:

```text
packages/agent-wiki-contracts/
  src/index.ts                         shared JSON-safe wire types
  schemas/data-view-*.schema.json      versioned schemas
  fixtures/v1/data-view-*.json        parity fixtures
  tests/contracts.test.ts             schema and invariant tests

packages/visual-workspace/
  src/data-view-types.ts              source/query/model/action types
  src/data-view-validation.ts         strict validation
  src/data-view-markdown.ts           managed block parser/serializer
  src/data-view-query.ts              deterministic evaluator
  src/data-view-projections.ts        Table/Kanban model builders
  src/data-view-plans.ts              controlled property-edit plans
  src/template-import-types.ts       neutral import IR
  src/template-import.ts              pure semantic mapping
  src/index.ts                        public exports
  tests/data-view-*.test.ts           focused behavior fixtures
  tests/template-import.test.ts       importer mapping fixtures

mcp-server/
  src/visual-workspace/template-import-reader.ts  JSON/ZIP input adapter
  src/visual-workspace/template-import-ops.ts     discover/preview/import ops
  src/visual-workspace/operations.ts              operation registration
  src/visual-workspace/operations.test.ts         MCP contract tests
  src/visual-workspace/cli.ts                     validation/query/import CLI
  package.json                                    dependency/bin scripts

obsidian-plugin/
  src/data-view/source-provider.ts     vault snapshot adapter
  src/data-view/view-host.ts           renderer host and diagnostics
  src/data-view/main-view.ts           Table/Kanban view surface
  src/main.ts                          view/command registration
  tests/data-view-smoke.test.ts        host boundary behavior

examples/
  data-views/                           sanitized domain examples
  imports/                               sanitized importer fixtures
```

The file names above are implementation targets. A task may add a narrowly
scoped sibling file only when the stated responsibility cannot fit an existing
file without coupling unrelated concerns.

---

## Task 1: Define the shared v1 data-view wire contract

**Files:**
- Modify: `packages/agent-wiki-contracts/src/index.ts`
- Create: `packages/agent-wiki-contracts/schemas/data-view-definition.schema.json`
- Create: `packages/agent-wiki-contracts/schemas/data-view-model.schema.json`
- Create: `packages/agent-wiki-contracts/schemas/data-view-action-request.schema.json`
- Create: `packages/agent-wiki-contracts/schemas/data-view-import-plan.schema.json`
- Create: `packages/agent-wiki-contracts/fixtures/v1/data-view-import-plan.json`
- Create: `packages/agent-wiki-contracts/fixtures/v1/data-view-definition.json`
- Create: `packages/agent-wiki-contracts/fixtures/v1/data-view-model.json`
- Create: `packages/agent-wiki-contracts/fixtures/v1/data-view-action-request.json`
- Modify: `packages/agent-wiki-contracts/tests/contracts.test.ts`

**Interfaces:**

Produce JSON-safe types with these stable names and fields:

```ts
export type DataViewKind = "table" | "kanban";
export type DataViewScalar = string | number | boolean | null;

export interface DataViewDefinitionV1 {
  schemaVersion: 1;
  id: string;
  title: string;
  view: DataViewKind;
  source: {
    kind: "file" | "folder" | "files";
    path?: string;
    paths?: string[];
  };
  select: Array<{ field: string; label: string }>;
  where?: DataViewPredicateV1;
  groupBy?: string;
  groupOrder?: string[];
  orderBy?: Array<{ field: string; direction: "asc" | "desc" }>;
}

export type DataViewPredicateV1 =
  | { kind: "and" | "or"; predicates: DataViewPredicateV1[] }
  | { kind: "field"; field: string; operator: "equals" | "in" | "exists" | "contains"; value?: DataViewScalar | DataViewScalar[] };

export interface DataViewModelV1 {
  schemaVersion: 1;
  queryId: string;
  view: DataViewKind;
  columns: Array<{ field: string; label: string }>;
  rows: Array<{ id: string; source: { path: string; blockId?: string }; values: Record<string, DataViewValueV1> }>;
  groups: Array<{ id: string; label: string; rowIds: string[] }>;
  diagnostics: Array<{ code: string; severity: "info" | "warning" | "error"; message: string; sourcePath?: string; field?: string }>;
}

export interface DataViewValueV1 {
  state: "known" | "unknown";
  value?: DataViewScalar | DataViewScalar[];
  source: { path: string; field?: string; start?: number; end?: number; blockId?: string };
}

export interface DataViewActionRequestV1 {
  schemaVersion: 1;
  kind: "edit-property" | "move-card";
  queryId: string;
  sourcePath: string;
  field: string;
  value: DataViewScalar | DataViewScalar[];
  actor: string;
}
export interface DataViewImportPlanV1 {
  schemaVersion: 1;
  source: { name: string; sha256: string };
  targetRoot: string;
  files: Array<{
    path: string;
    beforeSha256?: string;
    before?: string;
    after: string;
    afterSha256: string;
  }>;
  selectedItemIds: string[];
  warnings: string[];
  provenance: { actor: string; origin: "import" };
  fingerprint: string;
}

```

- [ ] **Step 1: Add the TypeScript wire types and exact string unions.**

- [ ] **Step 2: Add JSON Schemas that reject unknown root fields, empty IDs,
  invalid source kinds, invalid view kinds, invalid predicate operators, and
  missing `schemaVersion`.**

- [ ] **Step 3: Add one valid Table fixture, one valid Kanban fixture, and one
  action-request fixture using only vault-relative paths.**

- [ ] **Step 4: Extend `contracts.test.ts` to validate every fixture and assert
  that invalid states, absolute paths, and unknown fields fail.**

Run:

```bash
cd packages/agent-wiki-contracts
npm test
npm run build
```

Expected: existing contract tests plus the new data-view cases pass.

- [ ] **Step 5: Commit:**

```bash
git add packages/agent-wiki-contracts
git commit -m "feat: add data-view v1 wire contracts"
```

---

## Task 2: Add source snapshots and managed data-view Markdown

**Files:**
- Create: `packages/visual-workspace/src/data-view-types.ts`
- Create: `packages/visual-workspace/src/data-view-validation.ts`
- Create: `packages/visual-workspace/src/data-view-markdown.ts`
- Modify: `packages/visual-workspace/src/index.ts`
- Create: `packages/visual-workspace/tests/data-view-markdown.test.ts`
- Create: `packages/visual-workspace/tests/data-view-validation.test.ts`
- Create: `packages/visual-workspace/fixtures/data-view.basic.md`
- Create: `packages/visual-workspace/fixtures/data-view.kanban.md`

**Interfaces:**

Use the existing `Sha256Digest`, `SourceRange`, `VisualSourceReference`,
`canonicalJson`, `sha256Text`, and strict validation patterns.

```ts
export interface DataViewSourceBlock {
  path: string;
  sha256: Sha256Digest;
  title: string;
  frontmatter: Record<string, unknown>;
  blocks: readonly DataViewSourceBlockEntry[];
}

export interface DataViewSourceBlockEntry {
  id?: string;
  text: string;
  range: SourceRange;
}

export interface ManagedDataViewSection {
  definition: DataViewDefinitionV1;
  start: number;
  end: number;
  raw: string;
  eol: "\n" | "\r\n" | "\r";
}

export function parseManagedDataViewSection(source: string): ManagedDataViewSection;
export function serializeManagedDataViewSection(definition: DataViewDefinitionV1, eol?: ManagedDataViewSection["eol"]): string;
export function replaceManagedDataViewSection(source: string, definition: DataViewDefinitionV1): string;
export function validateDataViewDefinition(value: unknown): DataViewDefinitionV1;
```

- [ ] **Step 1: Write failing tests for one valid managed block, duplicate
  blocks, malformed JSON, unknown fields, invalid paths, and wrong markers.**

- [ ] **Step 2: Run the focused tests and verify the new parser/validator
  failures identify the missing functions or invalid contract.**

Run:

```bash
cd packages/visual-workspace
bun test tests/data-view-markdown.test.ts tests/data-view-validation.test.ts
```

Expected: FAIL for the new behavior only.

- [ ] **Step 3: Implement strict parsing with the markers
  `llmwiki:data-view:v1` and `/llmwiki:data-view:v1`, preserving all bytes
  outside the managed range. Use canonical JSON serialization and reject
  absolute paths or secret-bearing strings.**

- [ ] **Step 4: Implement validation for source scope, select fields, predicate
  trees, sort directions, group order, and the Table/Kanban view constraint.**

- [ ] **Step 5: Run the focused tests and the package typecheck.**

```bash
bun test tests/data-view-markdown.test.ts tests/data-view-validation.test.ts
npm run typecheck
```

Expected: PASS with no changes to existing mind-map behavior.

- [ ] **Step 6: Commit:**

```bash
git add packages/visual-workspace
 git commit -m "feat: add managed Markdown data-view definitions"
```

---

## Task 3: Implement deterministic source-aware query evaluation

**Files:**
- Create: `packages/visual-workspace/src/data-view-query.ts`
- Modify: `packages/visual-workspace/src/data-view-types.ts`
- Create: `packages/visual-workspace/tests/data-view-query.test.ts`
- Create: `packages/visual-workspace/fixtures/data-view.sources.json`

**Interfaces:**

```ts
export interface DataViewQueryInput {
  definition: DataViewDefinitionV1;
  sources: readonly DataViewSourceBlock[];
}

export interface DataViewQueryResult {
  model: DataViewModelV1;
  fingerprint: Sha256Digest;
}

export function executeDataViewQuery(input: DataViewQueryInput): DataViewQueryResult;
```

The evaluator must:

- filter only within the supplied source scope;
- resolve title, path, frontmatter, and supplied block fields;
- support nested `and`/`or`, `equals`, `in`, `exists`, and `contains`;
- preserve `unknown` for missing or unsupported values;
- sort equal values by vault-relative source path;
- use explicit group order, then stable lexical ordering;
- attach source path, field, and range to every known value;
- return source diagnostics without discarding unrelated valid sources;
- reject an invalid definition before evaluating any source.

- [ ] **Step 1: Add failing tests for filter precedence, unknown fields,
  duplicate sort values, explicit group order, unknown Kanban column, and a
  malformed source alongside valid sources.**

- [ ] **Step 2: Run the focused query test and confirm deterministic failures.**

```bash
cd packages/visual-workspace
bun test tests/data-view-query.test.ts
```

Expected: FAIL for the new evaluator behavior only.

- [ ] **Step 3: Implement scalar normalization and source-field resolution.**

- [ ] **Step 4: Implement predicate evaluation with explicit unknown behavior;
  never coerce missing values to empty strings or false.**

- [ ] **Step 5: Implement stable filtering, sorting, grouping, diagnostics, and
  the result fingerprint using `canonicalDigest`.**

- [ ] **Step 6: Run focused tests and typecheck.**

```bash
bun test tests/data-view-query.test.ts
npm run typecheck
```

Expected: PASS, with identical fingerprints for repeated identical inputs.

- [ ] **Step 7: Commit:**

```bash
git add packages/visual-workspace
 git commit -m "feat: add deterministic data-view query evaluation"
```

---

## Task 4: Add Table/Kanban projections and controlled actions

**Files:**
- Create: `packages/visual-workspace/src/data-view-projections.ts`
- Create: `packages/visual-workspace/src/data-view-plans.ts`
- Modify: `packages/visual-workspace/src/index.ts`
- Create: `packages/visual-workspace/tests/data-view-projections.test.ts`
- Create: `packages/visual-workspace/tests/data-view-plans.test.ts`

**Interfaces:**

```ts
export interface DataViewProjectionInput {
  result: DataViewQueryResult;
  view: "table" | "kanban";
}

export function projectDataView(input: DataViewProjectionInput): DataViewModelV1;

export interface DataViewPlanInput {
  definition: DataViewDefinitionV1;
  result: DataViewQueryResult;
  action: DataViewActionRequestV1;
  sourceMarkdown: string;
}

export function createDataViewEditPlan(input: DataViewPlanInput): VisualEditPlan;
```

Projection rules:

- Table uses select order and preserves row/source references.
- Kanban requires `groupBy`; missing values use a fixed `unknown` group.
- Renderer state such as hidden columns is not persisted.
- Card movement becomes a property edit on the group field.
- An action targeting an unknown field, unknown row, or missing source range is
  rejected rather than guessed.
- The plan provenance records the query ID, action kind, actor, and source
  reference.

- [ ] **Step 1: Add failing projection tests for Table columns, Kanban group
  order, unknown group, empty result, and diagnostics preservation.**

- [ ] **Step 2: Add failing plan tests proving a property edit changes only the
  intended frontmatter/property range and preserves all unrelated bytes.**

- [ ] **Step 3: Run both focused test files and verify failures.**

```bash
cd packages/visual-workspace
bun test tests/data-view-projections.test.ts tests/data-view-plans.test.ts
```

- [ ] **Step 4: Implement projections and plan creation by composing the
  existing canonical digest, source-lock, and immutable-plan primitives.**

- [ ] **Step 5: Add conflict and replay cases: a stale source lock rejects the
  plan; reusing a plan fingerprint cannot create a second mutation.**

- [ ] **Step 6: Run focused tests, all visual-workspace tests, and build.**

```bash
bun test tests/data-view-projections.test.ts tests/data-view-plans.test.ts tests/
npm run typecheck
npm run build
```

Expected: PASS; existing mind-map and plan tests remain green.

- [ ] **Step 7: Commit:**

```bash
git add packages/visual-workspace
 git commit -m "feat: add Table and Kanban projections with edit plans"
```

---

## Task 5: Define the neutral reference-template import IR

**Files:**
- Create: `packages/visual-workspace/src/template-import-types.ts`
- Create: `packages/visual-workspace/src/template-import.ts`
- Modify: `packages/visual-workspace/src/index.ts`
- Create: `packages/visual-workspace/tests/template-import.test.ts`
- Create: `packages/visual-workspace/fixtures/template-import/components-dashboard.json`
- Create: `packages/visual-workspace/fixtures/template-import/markdown-template.md`

**Interfaces:**

```ts
export interface ReferenceTemplateArtifact {
  sourceName: string;
  sourceSha256: Sha256Digest;
  root: unknown;
}

export type ImportedTemplateStatus = "mapped" | "unsupported" | "ambiguous";

export interface ImportedTemplateItem {
  id: string;
  kind: "dashboard" | "view" | "metric" | "template" | "action" | "asset";
  status: ImportedTemplateStatus;
  sourcePath: string;
  sourcePointer: string;
  output?: unknown;
  reason?: string;
  evidence: Array<{ kind: "source" | "sample" | "public-doc"; value: string }>;
}

export interface TemplateImportModel {
  schemaVersion: 1;
  source: { name: string; sha256: Sha256Digest };
  items: ImportedTemplateItem[];
  diagnostics: Array<{ code: string; severity: "info" | "warning" | "error"; message: string; sourcePointer?: string }>;
}

export function mapReferenceTemplate(artifact: ReferenceTemplateArtifact): TemplateImportModel;
```

Mapping rules:

- `multi` maps to a dashboard composition item.
- list/column/tab/grid map to typed layout nodes.
- mobile/laptop coordinates map to responsive profiles.
- `dynamicDataView` maps typed properties, source selection, predicates, sort,
  group, and view kind when the semantics are supported.
- count/progress/chart/time map to metric or visualization proposals.
- template references map to LLM Wiki template proposals.
- open-file, registered-command, and URL actions map only to typed allowlisted
  action proposals.
- custom code, `runScript`, and `dataviewjs` map to quarantined unsupported
  items; their contents are never returned as executable output.
- ambiguous references and unsupported operators become diagnostics, never
  silent drops.

- [ ] **Step 1: Add failing mapping tests for a composed dashboard, a Table
  view, a Kanban view, a count metric, a template reference, a safe open-file
  action, and a custom-code quarantine item.**

- [ ] **Step 2: Run the importer unit test and verify all mappings fail before
  implementation.**

```bash
cd packages/visual-workspace
bun test tests/template-import.test.ts
```

- [ ] **Step 3: Implement the neutral IR and pure mapping functions.**

- [ ] **Step 4: Ensure output IDs are deterministic from source hash and source
  pointer, not random UUIDs.**

- [ ] **Step 5: Ensure output contains no executable code, absolute paths,
  tokens, or copied reference runtime payloads.**

- [ ] **Step 6: Run importer tests and visual-workspace typecheck/build.**

```bash
bun test tests/template-import.test.ts
npm run typecheck
npm run build
```

- [ ] **Step 7: Commit:**

```bash
git add packages/visual-workspace
 git commit -m "feat: map reference templates into neutral import IR"
```

---

## Task 6: Add bounded JSON and ZIP input readers

**Files:**
- Modify: `mcp-server/package.json`
- Modify: `mcp-server/package-lock.json`
- Create: `mcp-server/src/visual-workspace/template-import-reader.ts`
- Create: `mcp-server/src/visual-workspace/template-import-reader.test.ts`
- Create: `mcp-server/src/visual-workspace/fixtures/template-import/sample.components`
- Create: `mcp-server/src/visual-workspace/fixtures/template-import/sample.zip`

**Interfaces:**

```ts
export interface TemplateImportInput {
  kind: "components-json" | "zip";
  path: string;
}

export interface ReadTemplateArtifactResult {
  sourceName: string;
  sourceSha256: Sha256Digest;
  entries: Array<{ path: string; kind: "components-json" | "markdown" | "asset" | "other"; content?: string }>;
  diagnostics: Array<{ code: string; severity: "warning" | "error"; message: string; entryPath?: string }>;
}

export function readTemplateArtifact(input: TemplateImportInput): ReadTemplateArtifactResult;
```

Use `fflate` only for bounded ZIP decompression. Enforce:

- maximum input archive size;
- maximum entry count;
- maximum decompressed entry size;
- path normalization and vault-escape rejection;
- JSON parsing only for `.components` files;
- Markdown/frontmatter extraction without evaluating code blocks;
- no extraction to the user's vault during read/preview.

- [ ] **Step 1: Add `fflate` as a direct runtime dependency and write failing
  tests for a JSON file, a ZIP with nested entries, path traversal, oversized
  entries, malformed JSON, and executable-code entries.**

- [ ] **Step 2: Run the focused reader tests and verify failures.**

```bash
cd mcp-server
bun test src/visual-workspace/template-import-reader.test.ts
```

- [ ] **Step 3: Implement bounded ZIP reading in memory and deterministic source
  hashing.**

- [ ] **Step 4: Normalize entry paths, reject `..`, absolute paths, and links,
  and classify executable-looking content as data requiring quarantine.**

- [ ] **Step 5: Run focused tests and MCP typecheck.**

```bash
bun test src/visual-workspace/template-import-reader.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit:**

```bash
git add mcp-server/package.json mcp-server/package-lock.json mcp-server/src/visual-workspace
git commit -m "feat: add bounded template artifact readers"
```

---

## Task 7: Generate reviewable import plans

**Files:**
- Create: `mcp-server/src/visual-workspace/template-import-ops.ts`
- Create: `mcp-server/src/visual-workspace/template-import-ops.test.ts`
- Modify: `mcp-server/src/visual-workspace/operations.ts`
- Modify: `mcp-server/src/index.ts`

**Interfaces:**

Register these operations through the existing operation model:

```text
visual.template.inspect
  input: { path, kind }
  output: source identity, entry inventory, diagnostics

visual.template.preview
  input: { path, kind, entryPath? }
  output: TemplateImportModel plus generated definitions and diagnostics

visual.template.plan
  input: { path, kind, selectedItemIds, targetRoot, actor }
  output: DataViewImportPlanV1 with before/after files, provenance, source locks

visual.template.apply
  input: { plan, presentedFingerprint, actor, transitionToken }
  output: applied paths, plan fingerprint, replayed, receipt path
```

`inspect`, `preview`, and `plan` never write files. `visual.template.apply` is
the only mutating operation: it validates the complete import plan, confirms
every target path is inside the vault, checks every before hash, writes all
files atomically under per-target locks, and records a replay-safe receipt.
Failure of any target check produces zero writes.

`visual.template.plan` must not write files. It produces new LLM Wiki
Markdown definitions under a validated vault-relative target root and records
unsupported items in the plan warnings.

- [ ] **Step 1: Add failing MCP operation tests for inspect, preview, plan, and
  apply; assert that only apply is marked mutating and that plan output includes
  source hash, selected item IDs, target paths, and unsupported diagnostics.**

- [ ] **Step 2: Add tests proving absolute/outside-vault targets, stale before
  hashes, partial target failures, and mismatched fingerprints are rejected with
  zero writes.**

- [ ] **Step 3: Implement inspect, preview, and plan by composing the reader,
  pure mapper, and `DataViewImportPlanV1` contract.**

- [ ] **Step 4: Implement apply with per-target locks, complete preflight,
  atomic multi-file persistence, and replay-safe receipts modeled on the
  existing visual map apply path.**

- [ ] **Step 5: Generate new-format Markdown only in the plan preview; never
  copy the original `.components` JSON into the target.**

- [ ] **Step 5: Run focused MCP tests and regenerate tool documentation if the
  operation registry changes.**

```bash
cd mcp-server
bun test src/visual-workspace/template-import-ops.test.ts src/visual-workspace/operations.test.ts
npm run generate-tools-doc
```

Expected: PASS for the focused operation tests; generated tool docs match the
registry.

- [ ] **Step 6: Commit:**

```bash
git add mcp-server/src/visual-workspace mcp-server/src/index.ts docs/mcp-tools-reference.md
 git commit -m "feat: expose reviewable template import plans"
```

---

## Task 8: Add CLI validation, preview, and import commands

**Files:**
- Create: `mcp-server/src/visual-workspace/cli.ts`
- Create: `mcp-server/src/visual-workspace/cli.test.ts`
- Modify: `mcp-server/package.json`
- Modify: `mcp-server/src/index.ts` only if shared entry wiring is required

**Interfaces:**

```text
llmwiki-view validate --vault <path> --input <path> --kind components-json|zip
llmwiki-view preview --vault <path> --input <path> --kind components-json|zip --json
llmwiki-view plan --vault <path> --input <path> --kind components-json|zip --target <path> --actor <id> --json
llmwiki-view apply --vault <path> --plan <path> --actor <id> --token <value> --json
```

Rules:

- `validate` exits non-zero on parser errors and zero on supported input with
  warnings.
- `preview` never writes and emits deterministic JSON when `--json` is set.
- `plan` never writes and emits the same plan fingerprint as the MCP operation
  for the same input and actor.
- output contains no absolute machine paths or source code payloads.
- `apply` is the only mutating CLI command; it requires a previously written
  plan file, an actor, a transition token, and complete preflight before any
  target changes.

- [ ] **Step 1: Add failing argv/exit-code tests for valid input, malformed
  input, unsupported-only input, invalid target, plan JSON output, and apply
  preflight/replay behavior.**

- [ ] **Step 2: Implement argument parsing by following the existing
  `agent-domain/cli.ts` style and dispatch through the same operation handlers.**

- [ ] **Step 3: Add the `llmwiki-view` bin and a focused package script without
  changing existing MCP or session-archiver bins.**

- [ ] **Step 4: Run CLI tests, typecheck, and a real preview against the
  sanitized fixture.**

```bash
cd mcp-server
bun test src/visual-workspace/cli.test.ts
npm run typecheck
node dist/visual-workspace/cli.js preview --vault "$PWD" --input src/visual-workspace/fixtures/template-import/sample.components --kind components-json --json
```

Expected: deterministic JSON preview, no file writes.

- [ ] **Step 5: Commit:**

```bash
git add mcp-server/package.json mcp-server/src/visual-workspace
 git commit -m "feat: add data-view template import CLI"
```

---

## Task 9: Add Obsidian source adapter and Table/Kanban host surface

**Files:**
- Create: `obsidian-plugin/src/data-view/source-provider.ts`
- Create: `obsidian-plugin/src/data-view/view-host.ts`
- Create: `obsidian-plugin/src/data-view/main-view.ts`
- Create: `obsidian-plugin/tests/data-view-smoke.test.ts`
- Modify: `obsidian-plugin/src/main.ts`
- Modify: `obsidian-plugin/package.json` only if shared package wiring requires it

**Interfaces:**

```ts
export interface ObsidianDataViewSourceProvider {
  readSources(scope: DataViewDefinitionV1["source"]): Promise<readonly DataViewSourceBlock[]>;
  readSource(path: string): Promise<DataViewSourceBlock>;
}

export interface DataViewHost {
  render(model: DataViewModelV1): void;
  showDiagnostics(diagnostics: DataViewModelV1["diagnostics"]): void;
  requestAction(action: DataViewActionRequestV1): Promise<void>;
}
```

Host rules:

- Build snapshots from Obsidian vault and metadata cache; do not let the core
  call Obsidian APIs.
- Keep query execution and projections in `visual-workspace`.
- Open source notes from source references.
- Render unknown values and diagnostics visibly.
- Convert inline edits and card moves into plan previews.
- Apply only after explicit confirmation using the existing plugin write path.
- Do not introduce a second settings schema or a direct file write in a view.

- [ ] **Step 1: Add failing smoke tests for source scope resolution, unknown
  property display, Table rendering, Kanban grouping, and apply confirmation.**

- [ ] **Step 2: Implement the source provider using Obsidian vault reads and
  metadata cache values mapped into `DataViewSourceBlock`.**

- [ ] **Step 3: Implement the host view with separate read, preview, confirm,
  and apply states.**

- [ ] **Step 4: Register the view and command in `main.ts` without changing
  existing Ask Mate or Promote flows.**

- [ ] **Step 5: Run the focused plugin smoke tests and plugin typecheck.**

```bash
cd obsidian-plugin
npm test
npm run typecheck
```

Expected: existing plugin tests plus the data-view smoke path pass.

- [ ] **Step 6: Commit:**

```bash
git add obsidian-plugin/src/data-view obsidian-plugin/src/main.ts obsidian-plugin/tests obsidian-plugin/package.json
 git commit -m "feat: render Markdown data views in Obsidian"
```

---

## Task 10: Add shared MCP/Plugin parity fixtures and domain examples

**Files:**
- Create: `packages/visual-workspace/fixtures/data-view.parity.json`
- Create: `packages/visual-workspace/tests/data-view-parity.test.ts`
- Create: `mcp-server/src/visual-workspace/data-view-parity.test.ts`
- Create: `examples/data-views/project-board.md`
- Create: `examples/data-views/journal-calendar.md`
- Create: `examples/data-views/inventory-board.md`
- Modify: `packages/visual-workspace/README.md`
- Modify: `docs/GUIDE.md` only for verified user-facing commands

Examples must be sanitized and independently authored. They may demonstrate
project, journal, and inventory workflows observed in the supplied templates,
but must not contain private vault content or copied custom scripts.

- [ ] **Step 1: Add one shared source/query fixture and expected Table/Kanban
  model fixture.**

- [ ] **Step 2: Add parity tests proving domain core, MCP serialization, and
  plugin adapter consume the same model shape and diagnostics.**

- [ ] **Step 3: Add domain examples with ordinary Markdown/frontmatter and
  managed `llmwiki:data-view:v1` blocks.**

- [ ] **Step 4: Document import, preview, unsupported-code quarantine, and
  explicit apply behavior.**

- [ ] **Step 5: Run the focused parity tests and inspect generated examples for
  machine paths, tokens, copied reference code, and misleading compatibility
  claims.**

- [ ] **Step 6: Commit:**

```bash
git add packages/visual-workspace/fixtures packages/visual-workspace/tests mcp-server/src/visual-workspace examples packages/visual-workspace/README.md docs/GUIDE.md
git commit -m "docs: add data-view parity examples and guidance"
```

---

## Task 11: Full verification and renderer-boundary gate

**Files:**
- No source changes unless verification exposes a defect.
- Review: all files changed by Tasks 1–10.
- Review: `docs/superpowers/specs/2026-08-27-components-internalization-design.md`.

- [ ] **Step 1: Run visual-workspace contract tests, typecheck, and build.**

```bash
cd packages/visual-workspace
npm test
npm run typecheck
npm run build
```

- [ ] **Step 2: Run agent-wiki-contracts tests and build.**

```bash
cd packages/agent-wiki-contracts
npm test
npm run build
```

- [ ] **Step 3: Run MCP typecheck, focused visual/template tests, and tool-doc
  generation test.**

```bash
cd mcp-server
npm run typecheck
bun test src/visual-workspace/operations.test.ts src/visual-workspace/template-import-reader.test.ts src/visual-workspace/template-import-ops.test.ts src/visual-workspace/cli.test.ts
```

- [ ] **Step 4: Run plugin typecheck, tests, and bundle-boundary verification.**

```bash
cd obsidian-plugin
npm run typecheck
npm test
npm run verify:bundle-boundary
```

- [ ] **Step 5: Perform the real smoke path against a sanitized fixture:**

```text
inspect input
  → preview supported Table/Kanban definitions
  → review unsupported custom/script items
  → create import plan
  → confirm target and actor
  → apply through host boundary
  → read generated Markdown
  → rerun import and verify deterministic replay/no duplicate write
```

- [ ] **Step 6: Run the security review checklist:**

```text
no eval / Function / JSX execution
no dataviewjs or runScript execution
no absolute paths or secrets in output
no writes during inspect or preview
stale locks reject all writes
unsupported mappings remain visible
reference format is never written
renderer dependencies do not enter contracts
```

- [ ] **Step 7: Run the existing repository verification commands recorded in
  `HANDOFF.md`, distinguishing pre-existing golden-file failures from new
  regressions. Do not call the work complete while a new failure remains.**

- [ ] **Step 8: Update the design/spec status and handoff with actual evidence,
  then commit the verification record.**

```bash
git add docs/superpowers/specs/2026-08-27-components-internalization-design.md HANDOFF.md ROADMAP.md
git commit -m "chore: verify Markdown data-view internalization"
```

---

## Deferred GPUix spike

GPUix is intentionally not part of Tasks 1–11. The official project describes
it as React bindings for Zed's GPUI, with native Metal, DirectX, Vulkan, and
browser WebGPU paths; it is a renderer/runtime candidate, not a knowledge or
vault model. Its current package setup uses `@gpuix/react` and
`@gpuix/native`, Bun, and native targets including Windows x64.

A later spike is allowed only after the core and existing host path are stable:

```text
fixed DataViewModel fixture
    ↓
GPUix Table / Kanban / graph renderer
    ↓
measure startup, memory, scrolling, input, focus, accessibility, packaging
```

The spike must not change the v1 data-view contract. GPUix may become an
optional renderer adapter only if it passes the desktop smoke and performance
gates. No GPUix dependency belongs in `agent-wiki-contracts` or the domain core.

## Final acceptance gate

The internalization is complete only when all of these are true:

- supplied `.components` or ZIP inputs can be inspected without execution;
- supported semantics import into the LLM Wiki format through a reviewable plan;
- unsupported and ambiguous semantics remain visible and quarantined;
- generated definitions are usable in Table/Kanban flows;
- source values and edits retain provenance and source ranges;
- stale or conflicting sources produce zero partial writes;
- MCP, CLI, and Obsidian use the same domain model;
- the original reference format is never written;
- no arbitrary code execution or vault escape was introduced;
- renderer choice remains replaceable and does not leak into the contracts.
