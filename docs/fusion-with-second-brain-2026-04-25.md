---
date: 2026-04-25
status: draft
owner: Curry
related:
  - upstream: https://github.com/eugeniughelbur/obsidian-second-brain
  - fork: https://github.com/2233admin/obsidian-second-brain
---

# Fusion Plan: obsidian-second-brain -> obsidian-llm-wiki

## Context

Curry forked `eugeniughelbur/obsidian-second-brain` on 2026-04-24 into `2233admin/obsidian-second-brain`. The fork and `obsidian-llm-wiki` are **parallel evolutions of the same concept** (Claude-operated Obsidian vault) with complementary strengths. This doc captures the plan to absorb second-brain's useful pieces into `obsidian-llm-wiki` without breaking v2.0.0.

## Positioning

| Repo | Strength | Weakness |
|---|---|---|
| `obsidian-llm-wiki` (v2.0.0) | **Persona skills** (architect / curator / gardener / historian / teacher / etc. -- 17 Karpathy-style thinking personas), headless MCP server, adapter system (filesystem / obsidian / memU / gitnexus / qmd), compile pipeline, unified query with RRF fusion (new this session) | Only 17 skills, no operational day-to-day commands, no `_CLAUDE.md` entry convention, no scheduled background agent, no bootstrap wizard |
| `obsidian-second-brain` (forked) | **Operational commands** (daily / task / person / project / log / adr / board / capture / decide / export / find / init / recap / review / synthesize / visualize -- 26 concrete workflows), `_CLAUDE.md` identity file, `CRITICAL_FACTS.md` identity loader, 4 user presets, background agent with nightly 5-phase reconcile, bootstrap Python scripts | No MCP server, no adapter abstraction, no persona skills, no RRF search fusion |

**They do not overlap. They complete each other.** Persona skills answer "what thinking mode for this situation"; operational commands answer "how do I execute this specific task". A single request like "save today" can trigger `/vault-daily` (command) which in turn invokes `vault-curator` (persona) for judgment calls.

## Skill and Command Inventory Diff

### Concept-overlapping (merge content, keep llm-wiki naming `vault-*`)

These exist on both sides with overlapping intent but complementary implementation.

| llm-wiki (keep name) | second-brain (merge content from) | Merge direction |
|---|---|---|
| `vault-save.md` (43 lines, MCP batched writes) | `obsidian-save.md` (26 lines, parallel subagents by type) | Add second-brain's parallel subagent pattern (people / projects / tasks / decisions / ideas / content) into llm-wiki's MCP-batched flow. Keep llm-wiki's MCP tool reference. |
| `vault-ingest.md` (91 lines, 5-15 page rewrite philosophy) | `obsidian-ingest.md` (111 lines, more operational steps) | Pull second-brain's step detail; keep llm-wiki's frontmatter convention and parallel entity search. |
| `vault-challenge.md` | `obsidian-challenge.md` | Diff-review, pick stronger phrasing, keep `vault-*` name. |
| `vault-connect.md` | `obsidian-connect.md` | Diff-review, merge. |
| `vault-emerge.md` | `obsidian-emerge.md` | Diff-review, merge. |
| `vault-graduate.md` | `obsidian-graduate.md` | Diff-review, merge. |
| `vault-health.md` | `obsidian-health.md` | Diff-review, merge. |
| `vault-reconcile.md` | `obsidian-reconcile.md` | Diff-review, merge. |
| `vault-world.md` | `obsidian-world.md` | Diff-review, merge. |

### llm-wiki unique (keep as-is, persona layer)

These are thinking personas with no second-brain counterpart; preserve unchanged.

- `vault-architect.md` -- architecture decision persona
- `vault-bridge.md` -- cross-vault bridge
- `vault-curator.md` -- curation discipline persona
- `vault-gardener.md` -- note gardener persona
- `vault-historian.md` -- history keeper persona
- `vault-janitor.md` -- cleanup persona
- `vault-librarian.md` -- retrieval persona
- `vault-teacher.md` -- explanation persona

### second-brain unique (migrate to llm-wiki `skills/` as `vault-*`)

These are operational commands llm-wiki lacks. Migrate with naming conversion `obsidian-X.md` -> `vault-X.md`.

- `obsidian-daily.md` -- daily note with calendar + kanban + conversation context (**tracer-bullet: migrated in this session**)
- `obsidian-task.md` -- kanban task creation with priority inference
- `obsidian-person.md` -- people note management
- `obsidian-project.md` -- project note management
- `obsidian-log.md` -- dev log per session
- `obsidian-adr.md` -- architecture decision record
- `obsidian-board.md` -- kanban board operations
- `obsidian-capture.md` -- fleeting note capture
- `obsidian-decide.md` -- decision recording with context
- `obsidian-export.md` -- vault export for other AI tools
- `obsidian-find.md` -- semantic find
- `obsidian-init.md` -- bootstrap `_CLAUDE.md` into existing vault
- `obsidian-recap.md` -- session recap
- `obsidian-review.md` -- periodic review
- `obsidian-synthesize.md` -- cross-source synthesis
- `obsidian-visualize.md` -- vault canvas generation

### Infrastructure to absorb

Beyond commands, second-brain has infra pieces that map to llm-wiki subdirs:

| From second-brain | To llm-wiki | Notes |
|---|---|---|
| `SKILL.md` (top-level meta-skill, 4 presets: executive / builder / creator / researcher) | `skills/meta-vault.md` or `README.md` integration | Defines vault entry protocol. Adapt MCP tool names to vault-mind MCP surface. |
| `architecture.md` | `docs/architecture-second-brain.md` (archive) | Keep as reference doc. |
| `hooks/obsidian-bg-agent.sh` | `agent/` (already exists in llm-wiki) | llm-wiki already has `agent/` dir. Port bg-agent logic. |
| `scripts/bootstrap_vault.py` | `scripts/` | Port; may conflict with llm-wiki's existing setup. Review. |
| `scripts/vault_health.py` | `scripts/` | Possibly redundant with `vault-health.md` skill. Investigate. |
| `references/claude-md-template.md` | `references/claude-md-template.md` | New dir in llm-wiki; this is the `_CLAUDE.md` template. |
| `references/vault-schema.md` | `references/vault-schema.md` | Vault folder/frontmatter conventions. |
| `references/write-rules.md` | `references/write-rules.md` | Vault write discipline. |
| `install.sh` | Check against llm-wiki `setup.sh` / `setup.ps1` | Do not blindly merge -- llm-wiki has its own install flow. |

### Concepts to adopt (not code)

- **`_CLAUDE.md` at vault root** -- every Claude surface reads this on session start, provides folder map + conventions + propagation rules. **High value, low effort**. Add as a llm-wiki convention.
- **`CRITICAL_FACTS.md`** -- ~120 tokens identity loader (timezone, user name, role). Adopt.
- **4 presets (executive / builder / creator / researcher)** -- different operational modes for different user types. Adopt in bootstrap.
- **Nightly 5-phase reconcile** (close day / reconcile contradictions / cross-source synthesis / heal orphans / rebuild index) -- already partially covered by llm-wiki `vault-reconcile` + `vault-janitor` personas, but the **scheduled nightly trigger** is missing. Adopt via llm-wiki `agent/` scheduler.
- **Bi-temporal facts** (what was true + when learned) -- adopt as frontmatter convention `valid_from` / `known_since`.

## Upstream Strategy

**Recommendation: keep the fork alive as an upstream watch**, not as a development target.

- `2233admin/obsidian-second-brain` stays as a mirror. Only sync from upstream.
- All active development happens in `obsidian-llm-wiki`.
- Every ~month: `git fetch upstream` on the fork, review the diff, cherry-pick valuable changes into llm-wiki.
- This preserves the option to pull future upstream improvements without hard-committing to maintain a fork.

## Execution Phases

### Phase 1a -- Tracer-bullet migration (this session)

- [x] Scan both repos' structure.
- [x] Write this fusion plan doc.
- [x] Migrate `obsidian-daily.md` -> `vault-daily.md` (proof-of-concept, zero conflict).
- [ ] Commit the migration atomically.

### Phase 1b -- Concept-overlap merges (next session)

- Diff-review each of the 9 overlapping skills.
- Merge second-brain content into llm-wiki's version.
- Test via bun test + smoke + manual command invocation.
- Commit per-skill atomically.

### Phase 1c -- Unique commands migration (next session)

- Migrate the 15 second-brain-unique commands to `skills/vault-*.md`.
- Naming conversion `obsidian-X` -> `vault-X`.
- Adapt any MCP tool references to vault-mind MCP surface.
- Commit per-command or in a batch of 5.

### Phase 2 -- Infrastructure adoption

- Adopt `_CLAUDE.md` vault-root convention; update `vault-init.md` / bootstrap.
- Port nightly 5-phase reconcile scheduler into `agent/`.
- Add 4 presets to bootstrap wizard.
- Adopt bi-temporal frontmatter convention.

### Phase 3 -- Cleanup and release

- Remove or archive `obsidian-llm-wiki/skills/` duplicates if any.
- Bump llm-wiki to v2.1.0 or v3.0.0-beta (decide based on breaking changes).
- Update README to credit upstream (`eugeniughelbur/obsidian-second-brain`).
- Close the fusion loop: set the `2233admin/obsidian-second-brain` fork to read-only upstream-watch mode.

## Risk Notes

- **Naming conflicts**: 9 overlapping skills + potentially-overlapping infra pieces (install.sh, scripts/). Resolve by strict rule: `vault-*` is canonical in llm-wiki.
- **MCP tool reference drift**: second-brain uses `mcp-obsidian` tool names (`get_file_contents`, `list_files_in_vault`, etc.); llm-wiki uses `vault.*` MCP tools (`vault.exists`, `vault.create`). Migrated skills must be rewritten to use vault-mind MCP surface.
- **v2.0.0 compatibility**: Any changes that affect the shipped MCP tool surface are breaking. Scoped to skills/ changes this phase is safe; infrastructure phase needs a version bump.
- **Fork maintenance**: Upstream `eugeniughelbur/obsidian-second-brain` may keep evolving. Set a recurring reminder to diff once per month.

## Open Questions

- Adopt `_CLAUDE.md` as required or optional convention? (Probably optional with strong default template.)
- 4 presets -- ship all 4 or start with one (builder) and expand? (Start with one.)
- Nightly reconcile scheduler -- use llm-wiki `agent/` subsystem or external cron / Task Scheduler? (Prefer llm-wiki internal to avoid fragmenting.)
- RRF fusion work (this session, unmerged) -- commit before or after Phase 1a? (Probably before, so tracer-bullet lands on a clean baseline.)
