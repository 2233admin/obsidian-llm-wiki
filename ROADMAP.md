# LLM Wiki Roadmap

This roadmap tracks shipped phases and the next planned release.
Detailed release notes per version live in `CHANGELOG.md`; per-issue
work state lives in `01-Projects/obsidian-llm-wiki/issues/`. Archive
drafts from prior planning rounds are in `docs/archive/task-drafts/`.

## Current priority: product foundation

LLM Wiki is an Obsidian-first product. The Obsidian plugin is the primary
human-facing product and control plane; MCP and CLI are access surfaces; Python
compiler and adapter processes are optional capability workers. The canonical
architecture is recorded in `30-Architecture/llm-wiki-product-spine.md`.

Before adding new MCP tools, adapters, Fleet features, or isolated setup
patches, complete this foundation:

- [ ] Obsidian-first onboarding and vault binding
- [ ] Capability health with actionable remediation
- [ ] TypeScript-owned boundary for Python and external workers
- [ ] Clear ownership between plugin, MCP, CLI, and durable vault state
- [ ] Roadmap and Work-OS issues grouped by product milestone

Feature expansion is paused until these five foundation items are designed and
accepted.

### Draft foundation slice: Project Hub interrupted-work recovery

The current candidate slice makes Project Hub the Obsidian-first path from an
interrupted Project to a cited, immutable next-action plan and a governed
Workflow receipt. S01 (`project-hub-recovery/v1`) is implemented. S02–S08 remain
draft and non-executable until the OpenSpec Phase 0 source-completeness,
authority, naming, issue-split, and Luna-delegation gates are approved.

Dependency order:

```text
S01 complete
  -> S02 resumable context + shared Workflow read model
       -> S03 cited retrieval
            -> S04A read-only candidates/plan
                 -> S06A LLM Wiki Project-context preview
                 -> S04B crash-safe Workflow apply
                 -> S05 output governance
                 -> S06B apply/receipt/refresh
                 -> S07 MCP/CLI parity
                 -> S08 foundation acceptance
```

Planning sources:

- `openspec/changes/project-hub-recovery-loop/`
- `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md`
- `01-Projects/obsidian-llm-wiki/issues/p0-s02-*` through `p0-s08-*`, including
  the S04A/S04B and S06A/S06B splits

The detailed plan is source-bound: it uses the existing LLM Wiki/Ask Mate
Project-context ItemView as the primary UI, extracts Workflow store/read seams
before S02/S04B, keeps generic unified retrieval from becoming Project
authority, freezes every `makeWorkflowOps` caller including the fleet verifier,
and removes the unused Python output router only when claimed TypeScript output
governance lands.

### Current issue taxonomy

| Product area | Current issues |
|---|---|
| Core product / Obsidian UX | `ux-audit-findings`, `plugin-migration-data-loss`, `plugin-main-ts-test-coverage`, `plugin-legacy-assignment-precedence`, `plugin-python-path-batch-cmd`, `plugin-binding-editor-noop-callback`, `plugin-low-hygiene-batch`, `plugin-promote-frontmatter-gate`, `plugin-promote-view-refresh`, `plugin-promote-open-snapshot`, `plugin-promote-obsidian-git-handoff`, `plugin-promote-autodetect-kbmeta` |
| Product infrastructure | `host-install-registration-wheel` |
| Compatibility / search worker | `temporal-graph-index-search-accelerator` |
| Later / experimental | `fleet-agent-discovery-transports`, `gitea-federation-adapter` |

The taxonomy is product-oriented, not file-oriented. A change belongs to the
product area it serves even when its implementation crosses TypeScript,
Python, plugin, or MCP directories.

## Shipped

### Phase: graphify adapter

- **Status**: shipped
- **Goal**: graphify as a 5th `VaultMindAdapter` for multi-format content
  extraction (PDF, images, video, code) feeding the knowledge graph.
- **Done**:
  - [x] `search`, `graph`, `read` capabilities
  - [x] Graceful degrade when graphify CLI absent
  - [x] Tests + docs (`docs/adapters/graphify.md`)

### Phase: second-brain integration (v2.4.0)

- **Status**: shipped
- **Goal**: Port obsidian-second-brain's workflow layer with structured
  note-creation tools and thinking/research slash commands.
- **Done**:
  - [x] 6 MCP tools: `vault.daily`, `vault.person`, `vault.project`,
    `vault.decide`, `vault.meeting`, `vault.ingest`
  - [x] 10 slash commands under `commands/`
  - [x] AI-First discipline (frontmatter + preamble)

### Phase: claude-obsidian port (v2.5.0)

- **Status**: shipped
- **Goal**: Port claude-obsidian's vault bootstrapping and concurrency
  layer.
- **Done**:
  - [x] `vault.init` methodology scaffolding (generic/para/lyt/zettelkasten)
  - [x] 3 slash commands: `/vault-autoresearch`, `/vault-think`, `/vault-expand`
  - [x] Per-file advisory locking (60s TTL) over all writes

### Phase: Settings + Agent Domain + Project Context (v2.8.0-beta.1 → beta.3)

- **Status**: shipped (v2.8.0-beta.3 tagged 2026-07-25)
- **Highlights**:
  - Settings Platform is the shared control plane — Obsidian plugin
    consumes the same compiled contracts as MCP (no plugin-owned copies).
  - Governed Agent Rooms + Project Context with versioned Profile /
    Binding / Thread / Room / Dream Time contracts.
  - Pluggable knowledge adapters (memU, LightRAG, RAG-Anything, Kanban,
    QMD, Hindsight) through namespaced `adapters.*` settings with
    device-local Secret References.
  - Project Tracker projections (GitHub / Gitea / Linear / Plane) stay
    separate from executable tools; Plane uses workspace-provided state
    UUIDs (never inferred).
  - Fleet control plane + governed Work Runs with portable device
    capability advertisements, deterministic assignment locks, local
    leases, explicit handoff tokens, child Work Runs, Usage ledger.
  - Obsidian plugin adds backend-owned views over Profiles / Bindings /
    Rooms / Threads / Dream Time / Consult / Delegation / Project Hub /
    Usage / experts / connectors.
- **Naming**: LLM Wiki is the canonical product name. `obc` survives only
  as the compatibility name for the Obsidian Broken Link Checker package.

### Phase: Plugin 0.4.0 Beta series (beta.1 → beta.5)

- **Status**: paused pending product foundation (current tag 0.4.0-beta.5, 2026-08-18)
- **Done**:
  - [x] `add-ask-mate-visual-workspace` — Ask Mate, mind maps, governed
    Problem Intake, user-approved Issue/PR contribution (Issue #add-ask-mate-visual-workspace)
  - [x] `internalize-railly-agentfiles` — Railly Agentfiles internalized
    as a governed native capability
  - [x] `project-session-record-mvp` + `project-context-projection-mvp` —
    Project Memory Loop MVP (session-record/v1 fixture importer +
    project-context/v1 deterministic projection)
  - [x] `imvt-session-capture-adapter-delivery` — IMVT session sync
    adapter as legacy/experimental summary import
  - [x] `integrate-agent-workflow-intake` — Claude Code + Codex external
    workflow intake contract
  - [x] `fix-work-os-nested-worktree-duplication` — scanner exclusion
    of machine-local `.orca/worktrees/**`
- **Deferred backlog after foundation**:
  - [ ] `plugin-migration-data-loss` (P1) — legacy settings migration
    transactional guarantee broken
  - [ ] `plugin-main-ts-test-coverage` (P2) — `main.ts` zero coverage
    (root cause of the data-loss bug shipping)
  - [ ] `plugin-promote-view-refresh`, `plugin-promote-frontmatter-gate`,
    `plugin-promote-open-snapshot`,
    `plugin-promote-obsidian-git-handoff`,
    `plugin-promote-autodetect-kbmeta` (P2/P3) — promote flow polish
  - [ ] `host-install-registration-wheel` (P1) — single host-install
    mechanism replacing three drifting setup scripts
  - [ ] `fleet-agent-discovery-transports` (P2) — transport-pluggable
    discovery (NetBird / WireGuard / SSH / orca)
  - [ ] `gitea-federation-adapter` (P3) — gitea issue ↔ work-OS
    federation (Task 9 gap)

## Next

### Phase: Foundation exit → Plugin 0.4.0 GA

- **Goal**: make the Obsidian-first product path coherent before shipping the
  next plugin release.
- **Trigger**: onboarding, capability health, TS/Python boundary, access-surface
  ownership, and Work-OS milestone alignment are accepted.
- **After the trigger**: resume the existing Plugin 0.4.0 GA safety and UX work.
- **Out of scope during foundation**: new adapters, Fleet federation, Gitea
  federation, and graph v2 redesign.
- **Definition of done**:
  - [ ] All P1 plugin todo entries closed
  - [ ] `npm test` green (requires bun shim repair on the host machine)
  - [ ] Tag `0.4.0` GA
  - [ ] CHANGELOG entry + release notes
  - [ ] Plugin update path verified against the migration safety cases

### Phase: v2.9 — Fleet + Project Memory GA

- **Goal**: graduate fleet federation + Project Memory Loop from MVP
  to GA, integrate with the work driver.
- **Trigger**: Plugin 0.4.0 GA shipped + `fleet-agent-discovery-transports`
  transport-pluggable registry landed.
- **Scope** (preliminary):
  - [ ] `gitea-federation-adapter` GA
  - [ ] `temporal-graph-index-search-accelerator` (P2) — rebuildable
    temporal search accelerator
  - [ ] Work-driver integration with Project Memory Loop
  - [ ] `project_context/v1` projection exercised end-to-end through
    MCP + Obsidian plugin
- **Out of scope**: v3 redesign, multi-tenant deployment, new LLM
  provider abstractions.

## Archived planning drafts

The original `TASK*-DRAFT-*.md` documents (Task 7 through Task 14) are
preserved under `docs/archive/task-drafts/`. Each draft informed the
shipped phases above; they are kept for historical context but are no
longer the authoritative work plan. Authoritative work state lives in
`01-Projects/obsidian-llm-wiki/issues/`.

## Tracking cadence

- Issues are created under `01-Projects/obsidian-llm-wiki/issues/`
  with rhizome-compliant work-OS frontmatter.
- `state` axis: `backlog` → `todo` → `in-progress` → `done` (or `canceled`).
  `blocked` is derived from `blocked-by`, never persisted.
- `review` axis: `draft` (candidate) vs `reviewed` (authoritative).
- Project Memory Loop `session-record/v1` and `project-context/v1`
  are the durable evidence + projection contracts.

## Repository hygiene

- Bundles (`mcp-server/bundle.js` etc., `obsidian-plugin/main.js`) are
  not tracked; `npm run rebuild` regenerates them.
- Sample third-party Obsidian vaults live under `docs/samples/components/`
  with their upstream LICENSE preserved. Everything else that lived
  under a top-level `Components/` directory has been removed.
- `.gitignore` covers `vault/`, `Components/`, `__pycache__/`, harness
  runtime state (`.omc/`, `.gstack/`, `.vault-mind/`, etc.), and the
  esbuild bundle artifacts.
