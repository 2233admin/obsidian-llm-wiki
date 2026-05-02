# Changelog

## [Unreleased]

### Added

- **RRF hybrid fusion in `query.unified`** -- replaces weighted-score merge with
  Reciprocal Rank Fusion (Cormack et al. 2009). Each adapter returns its top-N
  ranked; merged score = sum over sources (weight / (k + rank)), k=60. Eliminates
  score-magnitude bias between adapters (filesystem 0.1-1.0 vs memu 0.001-0.05
  no longer penalises weak sources). Same tool surface and parameters -- no
  breaking change for callers.
- **`rrf.ts` module** -- `fuseRRF()` + `RankedBundle` interface + `RRF_K` constant.
  Pure function, no I/O. Includes within-bundle dedup guard (Cormack uniqueness
  assumption), deterministic path-ascending tie-break, and `rrfSources` metadata
  annotation on merged results.
- **Integration tests for `unifiedQuery`** (`unified-query.test.ts`) -- two tests
  using inline fake adapters: single-adapter rank preservation and cross-source
  accumulation. Regression surface for future fusion algorithm changes.

### Fixed

- **Per-adapter result cap** in `unifiedQuery` and `unifiedQueryByVector` --
  previous formula `ceil(totalMax * 1.5 / N)` capped each adapter at ~19 results
  at N=4, preventing weak-source rank-20+ results from entering the fusion pool
  (defeating RRF's entire purpose). New floor: `Math.max(totalMax, ceil(...))` so
  each adapter always gets at least `totalMax` rows regardless of N.
- **Within-bundle deduplication** -- if an adapter returns the same path at
  multiple ranks (grep multi-line match, memu multi-chunk page), only the
  first (highest-rank) occurrence contributes to RRF. Prevents score inflation.
- **Deterministic tie-break** -- equal RRF scores now resolve by path ascending
  (`localeCompare`) instead of Map insertion order (which was
  `Promise.allSettled` completion race, non-deterministic across runs).
- **Tool descriptions** for `query.unified`, `query.search`, `query.semantic`,
  `query.vector` updated to name RRF and clarify that `weights` scales rank
  contribution, not raw score magnitude.

## v2.0.0 -- 2026-04-21

Name change + architecture consolidation. `vault-mind` → **LLM Wiki Bridge**
(slug `obsidian-llm-wiki`). Brand-first surfaces renamed; internal config
keys and binary names keep `vault-mind` for continuity.

### Breaking changes (v1 → v2)

- **MCP tool surface governed by AI-Output sediment convention.** New
  frontmatter fields `review-status`, `scope`, `quarantine-state`,
  `history[]` on sweep-managed notes. Plain notes untouched. Migration
  is additive — running the sweep against a v1 vault annotates over
  time, no destructive rewrites.
- **`loadConfig` precedence flipped to `env > ./yaml > ../yaml`.** v1
  silently let a parent-dir yaml shadow `VAULT_MIND_VAULT_PATH` which
  could redirect a vault without warning. If you were relying on that
  (probably not), set a local `./vault-mind.yaml` instead.
- **Default adapter list now includes `vaultbrain`** at runtime. The
  pglite vector extension path bug that previously crashed startup
  with this default is fixed by externalising `@electric-sql/pglite`
  from the esbuild bundle.
- **Bundle ships from `mcp-server/bundle.js`** (shrunk 1.54 MB → 963 KB
  after pglite externalisation). Install path unchanged; users who
  bundled the artifact themselves must rerun `npm run rebuild`.

### Features

- **7 persona skills** — `vault-architect`, `vault-curator`,
  `vault-gardener`, `vault-historian`, `vault-janitor`,
  `vault-librarian`, `vault-teacher`. Loadable as Claude Code skills
  via `~/.claude/skills/`.
- **AI-Output sediment pipeline** — `vault.writeAIOutput` +
  `vault.sweepAIOutput` ops for agent-authored notes with review
  gating, scope + quarantine-state governance, per-sweep history
  audit trail, axis sub-key, trend log.
- **Step 2.5 input gate** — free-form input validation with warning
  emission (downgraded from throw) to preserve agent UX while
  surfacing schema drift.
- **Bilingual user guide** — `docs/GUIDE.md` + `docs/GUIDE.zh-CN.md`
  with language switch on README.
- **Auto-generated tools reference** — `docs/mcp-tools-reference.md`
  regenerated from `operations.ts` at build time, drift-guarded by
  test.
- **End-to-end stdio smoke test** — spawns the shipped bundle,
  exercises JSON-RPC framing, tool-name bridge, config loader.
  Includes a pglite regression guard.
- **Paste-install UX** — `setup` (bash) / `setup.ps1` (PowerShell)
  scripts emit the MCP-server registration command.
- **Graph viewer** — static `viewer/index.html` renders
  `kb_meta.json` as an interactive concept graph. Demo data at
  `viewer/sample-graph.json`.
- **Headless MCP architecture** — filesystem / memU / gitnexus /
  obsidian / qmd / vaultbrain adapters; runs without Obsidian open.

### Fixes

- Bundled pglite vector-extension path resolution (5ee746a).
- realpath traversal guard hardened (71b0492).
- `_md_parse` shared module extracted; old duplicate parsers removed.
- generate-tools-doc drift test added (fbd6ed0).

### Deferred

See `docs/ICEBOX.md` for the full list — 2026-04-20 persona+MCP
audit findings (11 still open), bridge v2 architecture in separate
repo, screenshots for guide, sweep.log rotation.

## v1.0.0 -- 2026-04-08

首次公开发布。vault-mind 是 Knowledge OS for Claude Code + Obsidian，采用四层架构：MCP server + unified query adapters + auto-compile pipeline + Claude 驱动的 agent scheduler。

### Phase 1 -- Foundation
- eee222b feat: Phase 1 scaffold + code migration + adapter interface
- 80f8b42 feat: MCP server index.ts + CI + lint fixes

### Phase 2-3 -- Compiler & MCP Methods
- 64a4bb8 feat(compiler): auto-orchestration pipeline with chunking, extraction, and contradiction detection
- c89ddea feat(mcp): complete vault.* methods + adapter registry
- b3b056f chore: session handoff -- P1-P3 done, next P4 unified query

### Phase 4 -- Unified Query & Compile Triggers
- dfa1106 feat(phase4): unified query + compile triggers + memu/gitnexus adapters
- de7c7fc docs: update progress -- Phase 4 complete, MVP done

### Phase 5 -- Agent Scheduler
- ebef6ef feat(phase5): agent scheduler + evaluate + MCP wiring

### Phase 6 -- Distribution & Skills
- 713d051 feat(phase6): distribution + skills (Gemini + Claude fixes)

### Documentation & Philosophy
- eacba53 docs: 设计哲学 -- 矛盾论+实践论+群众路线
- af48d4a docs: 完整设计哲学 -- 马克思政治经济学 + 毛泽东三论

### Release
- 2db30b2 docs: vault-mind design spec + GSD planning artifacts
- 9139a2b docs: all phases complete -- v1.0 ready

### Post-v1.0 polish (included in the tagged release)
- b5f21a0 chore: gitignore harness runtime state
- 498e3b7 fix(mcp): thread detected config path into agent evaluate.py
- f451d12 ci: cache npm install and align branch to main
