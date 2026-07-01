# LLMwiki Vault Product Layer Plan

<!-- /autoplan restore point: 10-Projects/llmwiki-vault/autoplan-restore-20260701-2020.md -->

## Objective

Build `llmwiki-vault`: an audit-grade, Obsidian-compatible research memory that agents can initialize, ingest into, query, summarize, and lint without losing source provenance.

The wedge is not "a nicer folder tree." The wedge is the daily hero loop:

```text
capture source -> write registry/evidence -> update hot cache -> ask/search with citations -> lint auditability
```

Everything in the MVP must support that loop.

## Problem

The current LLMwiki system has strong internal primitives:

- Source Registry and Evidence Note conventions.
- Clear `Platform != Provider` separation.
- Provider pipeline concepts for `OPENCLI`, `OPENTABS`, `BBX`, `MEDIA_TRANSCRIBE`, and related tools.
- Validation expectations around `tools/list`, `vault.search`, `query.unified`, dry-run behavior, CI, and secret checks.

The missing layer is user-facing product shape. A user can understand the internals, but there is no one-command vault scaffold, stable file schema, hot cache, wiki health check, or Obsidian visual workflow that makes the system easy to start and maintain.

## Product Bet

Frame this as "audit-grade second brain," not a clone of Claude plus Obsidian.

Claude/Obsidian-style workflows win through immediacy: drop notes, ask questions, keep writing. LLMwiki should win when source provenance matters: every answer can cite registry entries, evidence notes, artifacts, providers, and known limitations.

## Hero Journeys

### Journey 1: Research A Repo

1. User runs `init llmwiki vault <path>`.
2. User asks to ingest a GitHub repo or project evidence.
3. Existing LLMwiki ingest writes a source note, evidence note, and artifacts.
4. `wiki/hot.md` updates with the repo summary and unresolved questions.
5. User asks a question and receives links to source/evidence notes.
6. `lint llmwiki` verifies registry/evidence integrity.

Acceptance:

- Time to first cited answer: under 5 minutes for a local or web source.
- The answer links at least one `sources/*.md` note and one `evidence/*.md` note.
- Lint exits clean for integrity errors.

### Journey 2: Browser Or Media Capture

1. User provides a URL, browser tab, PDF, video, or local file.
2. `llmwiki-ingest` owns platform classification and provider pipeline selection.
3. Vault layer records the output contract and updates human/agent surfaces.
4. Unsupported or auth-required sources become explicit blocked states, not silent failures.

Acceptance:

- Auth-required sources are marked `blocked_auth`.
- Unsupported sources are marked `unsupported`.
- Partial artifacts are marked `partial` with visible missing pieces.

### Journey 3: Maintain The Vault

1. User runs `lint llmwiki`.
2. Blocking integrity errors, freshness warnings, and best-practice info are separated.
3. User runs `update hot cache` and `create llmwiki views`.
4. Generated files include regeneration markers and never become the canonical data source.

Acceptance:

- Broken evidence links are blocking errors.
- Stale hot cache is a warning in normal lint and an error in release-check mode.
- Canvas/Bases outputs are optional generated views with Markdown fallbacks.

## MVP Scope

### 1. Vault Scaffold

Create a `llmwiki-vault` scaffold workflow that can generate:

```text
vault/
  .raw/
    web/
    media/
    pdf/
    repos/
    local/
  sources/
    index.md
    <source-id>.md
  evidence/
    <evidence-id>.md
  wiki/
    index.md
    hot.md
    log.md
    overview.md
    entities/
    concepts/
    projects/
    questions/
    meta/
  views/
    dashboard.md
    dashboard.base
    source-map.md
    source-map.canvas
    docket.md
  templates/
    source.md
    evidence-note.md
    project.md
    question.md
```

### 2. Canonical Schema

Use one source note per registry entry under `sources/`, with flat YAML frontmatter. `sources/index.md` is a generated rollup, not the canonical record.

Required `sources/<source-id>.md` frontmatter:

```yaml
id:
platform:
source_kind:
raw_url:
canonical_url:
provider:
pipeline:
status:
artifact_paths:
evidence_notes:
fetched_at:
limitations:
schema_version: 1
```

Allowed `status` values:

```text
new, supported, partial, blocked_auth, unsupported, stale, conflict, archived
```

Required `evidence/<evidence-id>.md` frontmatter:

```yaml
id:
source_id:
provider:
artifact_paths:
captured_at:
generated_by:
limitations:
schema_version: 1
```

This differs from the older single `source-registry.md` precedent because fenced YAML blocks are poor for Obsidian Properties, Bases, and graph queries.

### 3. Versioned Ingest Output Contract

`llmwiki-ingest` remains the owner of platform detection, provider choice, pipeline planning, registry writing, and evidence note writing.

`llmwiki-vault` consumes a versioned output contract:

```yaml
contract: llmwiki.ingest.output
version: 1
required_outputs:
  - sources/<source-id>.md
  - evidence/<evidence-id>.md
  - artifact path or explicit missing-artifact reason
search_expectations:
  - source id is discoverable by vault.search or query.unified when available
  - evidence id is discoverable by vault.search or query.unified when available
```

Golden fixtures must cover supported, partial, blocked-auth, unsupported, duplicate canonical URL, and conflict states.

### 4. Surface Ownership

| Surface | Job | Generated From |
|---|---|---|
| `wiki/index.md` | Human home and navigation | sources, evidence, projects, questions |
| `wiki/hot.md` | Short agent context cache | recent sources, active projects, unresolved questions |
| `wiki/overview.md` | Human-readable product/topic summary | curated project/topic notes |
| `wiki/log.md` | Append-only activity log | scaffold, ingest, lint, view generation events |
| `views/dashboard.md` | Markdown-first dashboard | source/evidence frontmatter |
| `views/dashboard.base` | Optional Obsidian Bases enhancement | same frontmatter only |
| `views/source-map.md` | Accessible source map table | source/evidence links |
| `views/source-map.canvas` | Optional bounded visual map | same source map data |
| `views/docket.md` | Project/task rollup | project and question notes |

Generated views must include a regeneration marker and must not contain hidden canonical state.

### 5. Hot Cache

`wiki/hot.md` must include:

```yaml
generated_at:
source_window:
max_items:
stale_after:
source_links:
schema_version: 1
```

Rules:

- Default `max_items`: 20.
- Default `stale_after`: 24 hours.
- It is a summary only; answers must cite linked source or evidence notes.
- Update triggers: after successful ingest, after manual `update hot cache`, and during release-check.
- Writes are atomic: render temp file, validate links, then replace.
- Stale cache is a warning for normal lint and a blocking error for release-check.

### 6. Wiki Lint

| Level | Meaning | Examples |
|---|---|---|
| Error | Blocks release and non-zero exit | missing source note, broken evidence link, path escapes vault, missing artifact without reason |
| Warning | Non-blocking but visible | stale hot cache, unsupported source, missing optional view |
| Info | Best-practice guidance | sparse overview, low view coverage, no Canvas output |

Checks:

- source note exists for every evidence note;
- evidence note links to existing artifact paths or explicit missing-artifact reason;
- canonical URL is present where applicable;
- provider and pipeline are recorded;
- required frontmatter fields exist;
- hot cache freshness policy is enforced;
- index and view links resolve;
- `vault.search` and `query.unified` can find representative entries where available;
- no generated file stores secrets, cookies, private headers, or tokens.

### 7. Obsidian Views

Markdown is canonical. Obsidian-specific outputs are enhancements.

Core Markdown outputs:

- `wiki/index.md`
- `views/dashboard.md`
- `views/source-map.md`
- `views/docket.md`

Optional Obsidian-enhanced outputs:

- `views/dashboard.base`
- `views/source-map.canvas`
- Graph grouping notes
- Kanban-compatible docket formatting

Canvas constraints:

- generate by project or topic, not whole vault;
- max 50 nodes by default;
- stable color legend;
- companion Markdown table required;
- never the only navigation path.

### 8. User Commands

| User phrase | Command shape | Writes | Dry run |
|---|---|---|---|
| `init llmwiki vault` | `llmwiki vault init <path> [--dry-run]` | scaffold files | print planned files |
| `ingest this into llmwiki` | route to `llmwiki-ingest` | source/evidence/artifacts | provider plan only |
| `update hot cache` | `llmwiki vault hot <path>` | `wiki/hot.md` | print candidate summary |
| `lint llmwiki` | `llmwiki vault lint <path> [--release]` | none | same checks |
| `show source registry` | `llmwiki vault sources <path>` | none | n/a |
| `create llmwiki views` | `llmwiki vault views <path>` | `views/*` | print planned files |
| `release-check llmwiki` | route to `llmwiki-release-check` | logs/artifacts as existing workflow allows | n/a |

Exit codes:

- `0`: clean or warnings only.
- `1`: lint errors or failed validation.
- `2`: invalid arguments or path safety rejection.
- `3`: provider/auth required but unavailable.

Terminal summaries must report `created`, `updated`, `skipped`, `warnings`, and `errors`.

## Non-Goals

- Do not replace `llmwiki-ingest`, `llmwiki-provider`, or `llmwiki-release-check`.
- Do not add a database before the file workflow is stable.
- Do not make a graph database or Graphiti adapter canonical state; graph search is a derived, rebuildable index only.
- Do not depend on proprietary Obsidian plugins for core data integrity.
- Do not store secrets, cookies, private headers, or tokens in markdown, logs, registry files, or generated views.
- Do not clone `claude-obsidian` wholesale; benchmark its product completeness and keep LLMwiki's audit-grade provenance advantage.
- Defer Canvas/Bases/Graph polish and Kanban niceties until the Markdown-first loop works.

## Alternatives Considered

| Approach | Pros | Cons | Decision |
|---|---|---|---|
| Product profile over existing skills only | Smallest change, little new surface | Still no scaffold, schema, hot cache, or lint product contract | Reject for MVP |
| Obsidian template pack only | Fast to demo, familiar to users | Weak automation and audit validation | Reject as standalone |
| CLI-only vault scaffold | Clear executable shape, testable | Could ignore agent routing and ingest skills | Accept as implementation vehicle |
| Hot-cache-first mode | Directly improves agent utility | Not enough without schema and lint | Include in MVP |
| Graphiti-style temporal graph index | Strong temporal memory, entity/relationship retrieval, provenance-aware agent search | Adds graph backend, LLM extraction, and operational failure modes before file workflow stable | Accept as post-MVP derived search accelerator |
| Full visual Obsidian product | Closest to polished competitor feel | Too broad and plugin-dependent | Defer phase 2 |

Recommendation: CLI/scaffold plus hot cache plus lint, backed by existing ingest skills.

## Architecture

```text
User / Agent Phrase
        |
        v
llmwiki-vault command/router
        |
        +--> init scaffold ----------------------+
        |                                       |
        +--> llmwiki-ingest output contract ----+--> sources/*.md
        |                                       +--> evidence/*.md
        |                                       +--> artifacts
        |
        +--> hot cache generator ---------------> wiki/hot.md
        |
        +--> lint ------------------------------> integrity report
        |
        +--> view generator --------------------> views/*.md + optional .base/.canvas
```

Boundary rule: provider/platform logic stays in `llmwiki-ingest` and `llmwiki-provider`; vault layer consumes outputs and validates file-level contracts.

## Failure Modes Registry

| Failure | Severity | Handling |
|---|---|---|
| Path escapes target vault through `..`, symlink, junction, or absolute artifact path | Critical | canonicalize path, reject, exit 2 |
| Existing vault partially scaffolded | High | idempotent init, no clobber, report created/updated/skipped |
| Old schema version | High | migration check, explicit upgrade output, fixture coverage |
| Duplicate canonical URL | Medium | mark `conflict`, link both source notes, warn |
| Auth-required source | Medium | mark `blocked_auth`, do not fake completion |
| Search provider unavailable | Medium | warn in normal lint, release-check may fail if search validation required |
| Graph index unavailable or stale | Medium | degrade to file/search index in normal mode; release-check may fail when graph profile enabled |
| Graph result without source/evidence provenance | High | reject result as answer evidence; require source/evidence IDs in graph hits |
| Hot cache stale | Medium | warning normally, release error |
| Canvas too dense | Medium | cap nodes, emit Markdown companion |
| Generated view drift | Medium | regeneration marker plus lint warning |
| Lint false positives | Medium | split error/warn/info, fixture tests |

## Test Plan

### Fixtures

- empty vault;
- existing-good vault;
- existing-partial vault;
- old-schema vault;
- supported source;
- partial source;
- blocked-auth source;
- unsupported source;
- duplicate canonical URL;
- conflicting evidence;
- broken artifact path;
- symlink/junction/path traversal fixture.

### Coverage Diagram

```text
NEW DATA FLOWS
  init <path>
    -> canonicalize target
    -> render scaffold
    -> no-clobber write
    -> summary

  ingest output contract
    -> validate source note
    -> validate evidence note
    -> validate artifacts
    -> index/search expectations

  hot cache
    -> read recent source/evidence/project notes
    -> summarize
    -> validate links
    -> atomic replace

  lint
    -> parse frontmatter
    -> resolve links/artifacts
    -> classify error/warn/info
    -> exit code

  views
    -> read canonical markdown/frontmatter
    -> generate markdown dashboard/source map
    -> optionally generate Bases/Canvas
```

### Required Tests

- Scaffold generation writes only under target vault.
- Dry-run emits planned files and writes nothing.
- Init is idempotent on existing-good vault.
- Init repairs existing-partial vault without clobbering user content.
- Old schema fixture gets explicit migration output.
- Path canonicalization rejects `..`, symlink/junction escape, absolute external artifact path, and broken artifact link.
- Lint classifies errors, warnings, and info correctly.
- Hot cache respects TTL, max items, source links, and atomic write.
- Views are regenerated from canonical markdown/frontmatter only.
- Search verification runs when `vault.search` or `query.unified` is available and degrades explicitly when unavailable.
- Graph-index PoC rebuilds from normalized vault records only and returns source/evidence IDs for every hit.
- Secret scan covers generated markdown, logs, views, and registry notes.

## Release Validation

Required release-check gates:

- `tools/list` includes relevant vault/ingest/search tools where MCP tools exist.
- Scaffold fixture tests pass.
- Lint fixture tests pass.
- Path safety tests pass on Windows and Linux-style path cases.
- Dry-run test confirms no writes.
- Search verification passes or records unavailable provider with explicit status.
- Graph-enabled release profile verifies graph freshness, provenance-bearing hits, and graceful backend-unavailable behavior.
- Secret scan finds no tokens, cookies, private headers, or credentials in generated files.
- Generated artifact snapshots match expected markdown/frontmatter shape.

## NOT In Scope For MVP

- Polished Canvas/Bases/Graph styling beyond basic generated outputs.
- Whole-vault Canvas maps.
- A database-backed registry.
- Required Graphiti or graph database runtime for normal vault use.
- Replacing ingest/provider/release-check workflows.
- Hosted playground or public SaaS.
- Rich visual design mockups.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | Narrow MVP to hero loop: init, ingest contract, source/evidence schema, hot cache, lint | Auto-decided | Completeness + pragmatic scope | This directly answers the product wedge and avoids shipping a broad but inert folder tree | Full Obsidian visual product in MVP |
| 2 | CEO | Position as audit-grade second brain | Auto-decided | Explicit over clever | It differentiates LLMwiki from Claude/Obsidian immediacy while preserving provenance advantage | Generic "Obsidian product layer" framing |
| 3 | Eng | Choose one source note per registry entry plus generated index | Taste surfaced | DRY + Obsidian compatibility | Frontmatter notes work better with Properties, Bases, links, and per-source status | Single fenced-YAML `source-registry.md` as canonical |
| 4 | Eng | Define versioned ingest output contract | Auto-decided | Boundary repair | Prevents schema drift between ingest/provider and vault/lint layers | Vault duplicating provider logic |
| 5 | Design | Make Markdown canonical and Obsidian views optional enhancements | Auto-decided | Accessibility + portability | Canvas/Bases are useful but should never be the only UI or source of truth | Plugin-dependent primary state |
| 6 | DX | Define command shapes, exit codes, dry-run, and summaries | Auto-decided | Developer empathy | Friendly phrases need executable behavior for automation and debugging | Phrase-only command surface |
| 7 | Eng | Add temporal graph as derived search accelerator, not canonical state | User-directed | Auditability + retrieval power | Graphiti-style memory is useful, but only after source/evidence truth stays Markdown-first and rebuildable | Graph database as required canonical registry |

## Implementation Tasks

- [ ] **T1 (P1, human: ~3h / CC: ~25min) — Schema** — Implement source/evidence note templates with flat frontmatter and schema version.
  - Surfaced by: CEO, Design, Eng — registry architecture blocks lint and views.
  - Files: `10-Projects/llmwiki-vault/`, future vault skill/tool files.
  - Verify: fixture parse test for source and evidence notes.

- [ ] **T2 (P1, human: ~3h / CC: ~25min) — Ingest Contract** — Define and test `llmwiki.ingest.output` v1.
  - Surfaced by: Eng — vault layer must not duplicate provider logic.
  - Files: contract docs, fixture outputs, lint tests.
  - Verify: supported/partial/blocked-auth/unsupported fixtures.

- [ ] **T3 (P1, human: ~4h / CC: ~35min) — Scaffold + Path Safety** — Build idempotent scaffold with dry-run and path canonicalization.
  - Surfaced by: Eng — path escapes and partial vaults are likely failure modes.
  - Files: scaffold command/tool, tests.
  - Verify: empty/existing/partial/old-schema and traversal fixtures.

- [ ] **T4 (P1, human: ~3h / CC: ~25min) — Lint Severity Model** — Implement error/warn/info lint output and exit codes.
  - Surfaced by: Design, Eng — noisy lint damages UX, weak lint damages auditability.
  - Files: lint command/tool, tests.
  - Verify: fixture suite with expected severities.

- [ ] **T5 (P2, human: ~2h / CC: ~15min) — Hot Cache** — Generate `wiki/hot.md` with TTL, source links, max items, and atomic writes.
  - Surfaced by: CEO, Design, Eng — agents need recent context without stale authority.
  - Files: hot-cache generator, fixtures.
  - Verify: stale behavior, link validation, summary-only rule.

- [ ] **T6 (P2, human: ~2h / CC: ~15min) — Markdown Views** — Generate `views/dashboard.md` and `views/source-map.md` from frontmatter.
  - Surfaced by: Design — Markdown must be canonical accessible UI.
  - Files: view generator, fixtures.
  - Verify: no hidden canonical state in generated views.

- [ ] **T7 (P3, human: ~2h / CC: ~15min) — Optional Obsidian Enhancements** — Generate bounded `.base` and `.canvas` files.
  - Surfaced by: Design — useful after Markdown-first flow works.
  - Files: optional view generator.
  - Verify: node cap, legend, Markdown companion.

- [ ] **T8 (P2, human: ~4h / CC: ~40min) — Temporal Graph Index PoC** — Build optional Graphiti-style adapter that indexes normalized vault records as episodes, entities, and temporal facts.
  - Surfaced by: User, Eng — temporal knowledge graph retrieval can accelerate agent memory without replacing Markdown truth.
  - Files: graph-index adapter docs/code, lazycodex fixture records, search integration tests.
  - Verify: rebuild from `vault.build_index_snapshot()` only, source/evidence provenance on every hit, graceful backend-unavailable behavior, telemetry disabled or documented; queries by source ID, evidence ID, entity `lazycodex`, and relation/topic `llmwiki memory` return provenance-bearing hits.

## Review Scores

- CEO: 5/10 -> 8/10 after narrowing to hero loop and audit-grade positioning.
- Design: 4/10 -> 8/10 after surface ownership, Markdown-first views, states, and lint severity.
- Eng: 5/10 -> 8/10 after ingest contract, registry decision, hot-cache semantics, path safety, and test fixtures.
- DX: 4/10 -> 8/10 after command shapes, exit codes, dry-run behavior, and terminal summaries.

## User Challenges

### Challenge 1: Registry Shape

Original plan left this open: one `source-registry.md` vs one file per source.

Review recommendation: use one source note per registry entry plus generated index.

Why: Obsidian Properties/Bases, graph links, per-source status, conflict handling, and queryability all work better with one note per source. This is the main taste decision that affects implementation shape.

Cost if wrong: More files and slightly more filesystem churn. If the vault grows huge, indexing needs care.

### Challenge 2: MVP Scope

Original plan included scaffold, schemas, hot cache, ingest integration, lint, Obsidian views, command routing, release checks, dashboards, Canvas, Bases, Graph config, and docket views.

Review recommendation: MVP is the hero loop only; enhanced views are phase 2.

Why: A broad Obsidian product can look impressive while agents still do not use it naturally. The first proof must be time-to-first-cited-answer and audit lint.

Cost if wrong: Some visual polish lands later.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---:|---|---|
| CEO Review | `/autoplan` | Scope & strategy | 1 | issues_open | Product wedge and MVP scope revised; 2 user challenges remain |
| Design Review | `/autoplan` | UI/UX gaps | 1 | issues_open | IA/view contracts tightened; optional views deferred |
| Eng Review | `/autoplan` | Architecture & tests | 1 | issues_open | Ingest contract, registry decision, hot-cache semantics, path safety added |
| DX Review | `/autoplan` | Developer experience | 1 | issues_open | Command shape, dry-run, exit codes, and summaries added |

- **CROSS-MODEL:** Strategy, design, and engineering voices independently flagged the same issue: the plan needed a narrower hero loop plus a stricter source/evidence contract.
- **VERDICT:** Revised plan is implementation-ready after the user accepts or rejects the two user challenges above.

**UNRESOLVED DECISIONS:**
- Challenge 1: accept one source note per source as canonical registry shape, or keep single `source-registry.md` canonical.
- Challenge 2: accept narrowed MVP hero loop, or keep visual Obsidian views in MVP.




