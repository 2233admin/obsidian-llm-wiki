# Changelog

**Version-track unification (2026-07).** This project ran two parallel tag
tracks for a while: the `v2.x` feature track (this changelog) and an
internal `v0.x` "Phase" track used for the mcp-server/compiler build-out
(`v0.1.0` .. `v0.8.0`). `v0.8.0` (2026-06-20) is chronologically the most
recent tag of *either* track -- it landed after `v2.5.1`, so it is placed
below in its real chronological position, not by version-number sort order.
It is a real, already-shipped milestone, not a rollback. **Going forward,
`v2.x` is the sole external release track; no further `v0.x` tags will be
cut.** Internal `package.json`/`pyproject.toml` version fields are not
force-aligned to this changelog's numbering -- treat this file as the
source of truth for what shipped when.

## Unreleased -- targeting v2.6.0

### Highlights

- **Shared Settings Platform.** A host-neutral registry, five-scope effective
  snapshot, expected-revision mutation, redaction, validation, migration plan,
  and Doctor contract now serve MCP, Python, and Obsidian. Secret values stay
  outside Settings; only Secret References and presence health cross the
  boundary.
- **Agent model binding.** Obsidian now configures inherited, local
  OpenAI-compatible/Ollama, or cloud Agent models through `models.agent.*`.
  Local mode strips cloud credentials; cloud mode resolves a device-local
  Secret Reference only for the Agent/Compiler child process.
- **Canonical Project Context.** Stable `project/<slug>` identity now joins
  Work-OS, knowledge, Work Runs, settings, bindings, and external projections.
  Project Hub is a read-only composition over those owners and reports real
  Settings snapshot health.
- **Reversible migrations.** Legacy Obsidian runtime fields migrate into the
  user-device scope with preimage recovery, while Project layout migration is
  preview-first, hash-guarded, backed up, and restorable.
- **Single-device and multi-device Work Runs.** Local joins validate the active
  lease; portable handoff uses a short-lived out-of-band capability whose raw
  value never enters shared vault or Git state. The two-vault acceptance
  harness and the real local ↔ 5090 handoff passed for the pre-Agent-binding
  baseline `89cf831ed4615270c56edd2784928a29e52e1789`. The beta candidate is not
  accepted until the same gate is repeated at its new product commit.
- **Fleet Mode MVP** (`fleet/`) -- Scout/Worker/Verify ships + Hub
  orchestration + review gates + context trimming/session management for
  multi-agent LLM Wiki work. Code-complete; the `tests/fleet_tests/` CI
  collision that kept it red on `main` is fixed this release. Its design
  docs (`TASK*-DRAFT*.md`) remain draft-stage by contrast -- see Docs below.
- **LLM Wiki link diagnostics (`obc` compatibility package).** OBC means only
  Obsidian Broken Link Checker: link extraction, CLI,
  VaultIndex + Resolver, Fix Planner, apply-safe writer, orphan-page
  detection, stale-note detection, and unit tests. It is not the product name
  or settings owner.
- **Work-OS Task 8-11.** Budget gate + spend tracking (11B), canvas view
  (10A), digest (10B), promote plugin/canvas/CLI (10C), MCP `project_*`
  tool unification, 11G briefing loop-trigger.
- **HackerNews connector** ingest; **Gitea Actions** pages-branch
  publishing.
- `docs/adr/lmvk-0001-distribution-topology.md` (editing leg + distribution
  topology decisions) and this release's execution/close-out spec.

### CI / quality

- Fixed the `tests/fleet/` vs top-level `fleet/` package name collision
  (pytest rootdir shadowing broke `import fleet` on every run) --
  renamed to `tests/fleet_tests/`, plus fixed three latent test bugs that
  had never actually executed before collection started succeeding.
- `ruff check compiler/` reached zero violations (was previously red).
- `compiler/tests/` (789 tests plus 15 subtests) now actually run in CI -- both `ci.yml`
  and `release.yml`'s quality gate -- after being wired up but never
  invoked.

### Docs honesty pass

- Added Settings/Obsidian guidance, legacy plugin and Project migration
  procedures, the current capability inventory, and the reproducible fleet
  acceptance sequence. The earlier accepted 5090 evidence remains a baseline;
  beta release notes are updated only after the new product commit repeats it.
- `TASK14-DRAFT-multi-platform-compile.md` had drifted into an
  internally-inconsistent DRAFT/APPROVED status framing; corrected to
  state plainly: design-approved, 0 lines of code, not built.
- `HANDOFF.md`'s Task 12 entry is clarified against the `v0.8.0` tag: the
  shipped `8ab11e5` "Context Core Phase 1-3" (rhizome contracts, 3-tier
  ontology, holons graph) is a different, already-completed body of work
  from the still-unbuilt TASK12-DRAFT "Context Core" retrieval-policy
  proposal that happens to share the same name.

## v0.8.0 -- 2026-06-20

Internal Phase-track release (see version-track unification note above).
Chronologically the newest tag at time of writing, landing after v2.5.1.

- **feat(phase8):** graph export, vault write-back, persistent memory,
  BM25 search. 7 new MCP tools (58 -> 65 total, 10 -> 12 namespaces):
  `graph.export` (BFS causal subgraph -> Mermaid/Canvas/DOT), `vault.write`,
  `vault.annotate`, `memory.set`/`get`/`list`/`forget`; `holon.search`
  gains a `mode` param (substring/bm25/hybrid).
- **feat(holons):** Phase 7 -- HyperEdge support.
- **feat(mcp):** Phase 6 -- holon/causal/provenance MCP tools.
- **feat:** Phase 4+5 -- compile CLI, JSON serializer, task tracking,
  orphan-branch CI.
- **feat(compiler):** Context Core Phase 1-3 -- rhizome frontmatter
  contracts, 3-tier ontology, holons concept graph (71/71 tests). This is
  the compiler-side "Context Core" work, distinct from the still-unbuilt
  TASK12-DRAFT "Context Core" retrieval-policy proposal (see HANDOFF.md).
- **feat:** NotebookLM recipe; Claude Code plugin + self-hosted
  marketplace.
- **fix:** resolved several pre-existing CI failures + a ruff-broken
  re-export; robust `find|xargs` in place of a glob that didn't expand
  reliably in CI.

## v2.5.1 -- 2026-06-10

- **fix:** replace literal NUL bytes in `vault.graph` edgeMap keys with
  their backslash-u0000 escape sequence -- ripgrep was treating `index.ts` as a
  binary file because of the raw NUL bytes.
- **fix:** close v2.5.0 P3 gaps -- lock coverage + fs-transport parity +
  lock tests.

## v2.5.0 -- 2026-06-10

feat: claude-obsidian port. Inspired by
github.com/AgriciDaniel/claude-obsidian.

- `vault.init` methodology scaffold, dual-mode (generic/PARA/LYT/
  zettelkasten, `dryRun` default) plus a legacy topic mode.
- Per-file advisory locking (`O_EXCL`, 60s TTL) wrapping 11 mutating
  write paths.
- 3 new commands: `/vault-autoresearch` (3-round loop), `/vault-think`
  (10-principle framework), `/vault-expand` (source -> 8-15 wiki pages).
- Regenerated `docs/mcp-tools-reference.md` (50 ops).

## v2.4.0 -- 2026-06-10

feat: second-brain integration. Inspired by
github.com/eugeniughelbur/obsidian-second-brain (2350 stars).

- 6 structured note tools: `vault.daily`/`person`/`project`/`decide`/
  `meeting`/`ingest`.
- 10 thinking-mode slash commands: `/vault-synthesize`, `/reconcile`,
  `/emerge`, `/research`, `/challenge`, `/connect`, `/panel`, `/recap`,
  `/graduate`, `/learn`.
- `GraphifyAdapter` wired into the MCP server.

## v2.3.0 -- 2026-05-31

feat: Supermemory + PageIndex integration.

- Temporal fact tracking via a frontmatter convention; fact-extraction
  pipeline from memU; user-context injection (~50ms).
- PageIndex-style Tree Index for section-aware retrieval; section boost
  in RRF fusion. 100% hit rate on eval tests (vaultbrain-smoke).
- `feat(compiler)`: HTML export with CDN interactivity (WIP, #13).
- VaultBrain fixes: PGLite hybrid search, `pg_trgm`, CJK support;
  `vault.externalSearch` fix.
- Perf: regex/LRU cache, RRF heap merge, WAL append-only log, git-diff
  incremental compile, CI parallelization, asyncio concurrent LLM
  extraction, orjson (10x speedup).
- chore: ship compiled `bundle.js` for distribution; image optimization.

## v2.2.0 -- 2026-05-17

LLM Wiki is now positioned around one product loop: scattered research and
agent output become cited, reviewable, promoted team memory.

### Highlights

- **Reviewed team memory compiler story.** README and guides now open with
  the problem of knowledge with no source, reviewer, or promotion path.
- **Five-minute first success path.** Users can run the bundled
  `examples/collab-vault` demo before wiring an agent host:
  compiler dry-run, knowledge health, and doctor.
- **Research compiler loop.** New docs describe
  `raw/ -> wiki/ -> query -> AI-Output -> reviewed/promoted` as the core
  operating model.
- **Collaborative vault governance.** Added example team vault layout,
  collaboration policy, CODEOWNERS templates, PR templates, and Gitea/GitHub
  lint workflows.
- **Health and release verification tools.** Added `llmwiki_doctor.py`,
  `knowledge_health.py`, `vault_collab_lint.py`, `mcp_sync_probe.py`, and
  `verify_release_install.py`.
- **Brand cleanup.** Public docs now use **LLM Wiki** and avoid the old
  "LLM Wiki Bridge" surface.

### Notes

- No new required service dependency.
- The first-success compiler demo uses `--dry-run` stub extraction and does
  not need an API key.
- The demo vault warning `git-missing` is expected because
  `examples/collab-vault` is not its own Git worktree.

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
