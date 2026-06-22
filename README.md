<p align="center">
  <img src="docs/assets/banner.svg" alt="LLMwiki — raw research compiled into a reviewed team wiki" width="100%">
</p>

# LLMwiki

**LLMwiki turns a team's raw research folder into a reviewed, queryable, self-improving Obsidian wiki. Headless-first. Cites, doesn't guess.**

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-stdio-orange.svg)](https://modelcontextprotocol.io)
[![Wiki](https://img.shields.io/badge/wiki-deep_dives-D97757.svg)](https://github.com/2233admin/obsidian-llm-wiki/wiki)

**Language**: English (this page) · [简体中文](docs/zh-CN/) — **Guide**: [English](docs/GUIDE.md) · [简体中文](docs/GUIDE.zh-CN.md) — **Wiki**: [Home](https://github.com/2233admin/obsidian-llm-wiki/wiki) · [Architecture](https://github.com/2233admin/obsidian-llm-wiki/wiki/Architecture) · [Rationale](https://github.com/2233admin/obsidian-llm-wiki/wiki/Rationale) · [FAQ](https://github.com/2233admin/obsidian-llm-wiki/wiki/FAQ)

![demo](docs/gif/demo.gif)

You are reading this because your team has already lost knowledge.

Not because nobody wrote it down. They did: papers, meeting notes, repo findings, screenshots, agent answers. The problem is worse: the knowledge has no state. No source. No reviewer. No promotion path. No way to tell a draft from team truth.

LLMwiki gives that mess a compiler pass:

```
capture -> compile -> ask -> file -> review -> promote
```

Put source material in `raw/`. Compile it into `wiki/` summaries, concept pages, backlinks, and contradiction reports. Ask agents cited questions. File useful answers into `00-Inbox/AI-Output/`. Promote only reviewed knowledge into decisions, architecture, and runbooks.

It is not an AI companion. It is a reviewed team memory compiler. Obsidian is the IDE, Git/Gitea review is the ledger, and MCP/CLI tools are the execution surface.

Inspired by [Andrej Karpathy's LLM Wiki](https://github.com/karpathy/llm-wiki). Markdown is the source of truth; the compiler turns structure into a graph; MCP exposes it.

---

## Quick start (10 seconds, Claude Code)

Inside any Claude Code session:

```
/plugin marketplace add 2233admin/obsidian-llm-wiki
/plugin install llmwiki@obsidian-llm-wiki
```

That's it. No clone, no build, no config file to edit. The plugin ships the MCP server (runs from the plugin directory, Node 20+), all `/llmwiki:vault-*` knowledge-work roles, and the thinking/research commands. Start Claude Code inside your vault and the server finds it automatically (cwd is the vault); otherwise set `VAULT_MIND_VAULT_PATH` or drop a `vault-mind.yaml`.

### Other hosts (Codex / OpenCode / Gemini)

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git
cd obsidian-llm-wiki && ./setup                      # --host codex | opencode | gemini
```

Windows: `.\setup.ps1`. The script copies the skill bundle into your host's skills directory and prints the `.mcp.json` snippet to paste into your agent config. [docs/INSTALL.md](docs/INSTALL.md) has per-host paths and the manual recipe.

---

## See the loop (5 minutes)

You can verify the compiler loop before wiring any agent host. This demo is local, report-only, and the compiler dry-run uses stub extraction, so it does not need an API key.

```bash
python compiler/compile.py examples/collab-vault/research-compiler --tier haiku --dry-run
python scripts/knowledge_health.py --vault examples/collab-vault --json
python scripts/llmwiki_doctor.py --vault examples/collab-vault --json
```

Then inspect the before/after:

| Step | Path |
|---|---|
| Raw source | `examples/collab-vault/research-compiler/raw/team-memory-os.md` |
| Compiled summary | `examples/collab-vault/research-compiler/wiki/summaries/team-memory-os.md` |
| Compiled concept | `examples/collab-vault/research-compiler/wiki/concepts/team-memory-os.md` |
| Filed AI output | `examples/collab-vault/00-Inbox/AI-Output/codex/project-setup-proposal.md` |
| Reviewed memory | `examples/collab-vault/20-Decisions/2026-05-16-gitea-reviewed-vault.md` |

That is the product: raw material becomes cited, inspectable, reviewable team memory.

---

## Works with

Any MCP-compatible host:

| Host | Command | Status |
|---|---|---|
| Claude Code | `./setup --host claude` | primary target, fully exercised |
| Codex CLI | `./setup --host codex` | path configured, smoke-tested |
| OpenCode | `./setup --host opencode` | path configured, smoke-tested |
| Gemini CLI | `./setup --host gemini` | path configured, smoke-tested |

Anything else speaking stdio MCP transport should work — the `setup` script only copies skills into the right directory and prints the `.mcp.json` snippet. If your host reads MCP config from somewhere else, paste the snippet there by hand.

---

## Example prompts

Cold start -- no vault context:

```
/vault-librarian what do I know about attention heads
```

Warm start -- specify a note you have:

```
/vault-librarian explain [[retrieval-augmented-generation]] in the context of my other notes on LLMs
```

Format-specific -- you want a list, not prose:

```
/vault-historian what decisions did I make about training data between January and March 2026
```

Iterate -- refine an answer:

```
/vault-curator find all orphan notes and stale notes in my vault that have not been updated in 90 days
```

---

## Compile, Query, Govern

| Loop | What happens | Durable path |
|---|---|---|
| Compile | Drop source material into `raw/`; run the compiler to produce summaries, concepts, backlinks, and contradiction reports. | `wiki/` |
| Query | Agents answer from cited vault notes and file useful drafts back into the inbox. | `00-Inbox/AI-Output/<agent>/` |
| Govern | Humans review, promote, supersede, or discard candidate knowledge. Shared team memory moves through PR review. | `20-Decisions/`, `30-Architecture/`, `40-Runbooks/` |

See [docs/RESEARCH_COMPILER_LOOP.md](docs/RESEARCH_COMPILER_LOOP.md) for the standard operating loop.

---

---

## Local Linear-style project management

LLMwiki now includes a local-first project management layer under `project.*`, inspired by `the-orrery/docket`, `the-orrery/rhizome`, and `the-orrery/seed`. It stores issues, comments, dependencies, generated Kanban boards, and project docs as Markdown inside the vault. Agents can create and update work items through MCP, while humans can review the resulting files and Git diffs.

The default layout lives under `10-Projects/<project>/docket/`. Issues use docket-compatible `ISSUE-N.md` frontmatter with `status` + `state_type`, dependencies use `blocked_by`, and the generated board is readable by the `kanban` adapter. See [docs/LOCAL_PROJECTS.md](docs/LOCAL_PROJECTS.md).

## Local NotebookLM-style ingest with ChubbySkills

LLMwiki can now treat [chubbyguan/chubbyskills](https://github.com/chubbyguan/chubbyskills) as an optional local ingest pack. ChubbySkills handles platform capture and transcription for Douyin, Bilibili, Xiaohongshu, WeChat, X/Twitter, podcasts, YouTube, and more; LLMwiki handles the local vault layer: search, citations, graph, Markdown memory, AI-Output review, and promotion.

Install LLMwiki normally, then use `/chubbyskills` to plan which upstream capture skills to install and how to point them at the same vault. This makes the product shape closer to a local NotebookLM over your own saved feeds, without bundling heavy media dependencies into the MCP server. See [docs/CHUBBYSKILLS.md](docs/CHUBBYSKILLS.md).
LLMwiki's MCP core deliberately supports two local ingest entrypoints instead of one scraper per platform:

| Entrypoint | Handles | Contract |
|---|---|---|
| `OPENCLI` | Web pages, articles, OpenCLI + BBX/browser-assisted captures, X/Weibo/Zhihu/WeChat/Xiaohongshu-style text surfaces. | Produce Markdown in the vault with source URL and capture metadata. |
| `MEDIA_TRANSCRIBE` | Audio/video parsing, download, subtitles, transcription, YouTube/Bilibili/Douyin/TikTok/Xiaohongshu/podcast-style media surfaces. | Produce transcript Markdown in the vault with media provenance. |

Use `ingest.link.preflight` before promising capture. It classifies the URL, routes it to `OPENCLI` or the media/transcribe toolchain, reports whether the provider is configured, and returns the honest next action. LLMwiki only claims ingest success after Markdown lands in the vault and can be found by `vault.search` or `query.unified`. See [docs/INGEST.md](docs/INGEST.md). OpenTabs remains optional; the default install path should work with OpenCLI plus BBX/browser bridge.


## Source Registry Phase 1 {#source-registry-phase-1}

Use `source.register` when a URL or existing vault note should become a long-lived source before any heavy ingest runs. URL registration runs `ingest.link.preflight` and writes two vault-local artifacts only:

- `_llmwiki/source-registry.json` stores the machine index.
- `00-Inbox/Sources/<platform>/<source>.md` stores the human-readable Source Note.
- `10-Projects/<project>/sources/<platform>/<source>.md` is used when `project` is provided.

Phase 1 supports `inputType=url` and `inputType=vaultPath`. Reserved input types such as `filePath`, `directoryPath`, `repoPath`, and `text` are rejected until a later ingest-run layer exists. Use `source.list` and `source.get` to inspect registered sources.

## X/Twitter to Obsidian capture

LLMwiki now ships an optional `/x-to-obsidian` skill adapted from [hemoouren/X-to-Obsidian-SKill](https://github.com/hemoouren/X-to-Obsidian-SKill/tree/main). It finds high-signal X/Twitter posts, saves them through the official Obsidian Web Clipper, and then lets LLMwiki search and govern the clipped Markdown notes.

This lives in the skill layer, not the MCP server: browser automation and logged-in X access stay local, while `vault.search`, `query.unified`, `vault.writeAIOutput`, and `memory.handoff.write` handle the reviewable vault workflow after notes land. See [docs/X_TO_OBSIDIAN.md](docs/X_TO_OBSIDIAN.md).

## Markdown memory + Kanban boards (Phase 1)

LLMwiki now has two memory layers:

| Layer | Path | Use |
|---|---|---|
| Lightweight KV | `_ai_memory.json` | Existing `memory.set/get/list/forget` API. Fast private key-value state, unchanged. |
| Markdown memory | vault notes | Visible, searchable handoff state that survives agent sessions and can be reviewed like any other note. |

Markdown memory is actor-scoped. `VAULT_MIND_ACTOR` selects the actor; if unset it falls back to `agent`.

| Scope | Directory |
|---|---|
| Project memory | `10-Projects/<project>/agents/<actor>/memory/` |
| Fallback memory | `00-Inbox/Agent-Memory/<actor>/` |

The MCP surface adds `memory.passport.get`, `memory.passport.upsert`, `memory.handoff.latest`, `memory.handoff.write`, `memory.session.save`, and `memory.session.list`. `passport.md`, `handoff.md`, and timestamped `sessions/*.md` are normal Markdown, so `vault.search` and `query.unified` can find them.

The `kanban` adapter is read-only in Phase 1. It indexes Obsidian Kanban plugin boards stored as Markdown with `kanban-plugin: board`, emits board summaries plus card results, and preserves lane, checked, archived, and block-id metadata. The default adapter list includes `kanban`; if you override adapters manually, include it explicitly:

```bash
VAULT_MIND_ADAPTERS=filesystem,kanban
VAULT_MIND_KANBAN_GLOB='**/*.md'
```

## Knowledge roles, one MCP surface

Each `/vault-*` command is a knowledge-work role over the same MCP tool set. They are jobs in the pipeline, not product mascots.

| Name | What it does | Primary MCP tools |
|---|---|---|
| vault-librarian | reads, searches, cites from the vault | `vault.search`, `vault.read`, `vault.list` |
| vault-architect | compiles concept graph, suggests refactors | `vault.graph`, `vault.backlinks`, `compile.run` |
| vault-curator | finds orphans, dead links, duplicates, stale notes | `vault.lint`, `vault.searchByTag`, `vault.search` |
| vault-teacher | explains a note in context of its neighbors | `vault.backlinks`, `vault.read`, `vault.graph` |
| vault-historian | answers what you were thinking on date X | `vault.searchByFrontmatter`, `vault.stat`, `vault.search` |
| vault-janitor | proposes cleanups, dry-run by default | `vault.lint`, `vault.delete` (dry), `vault.rename` (dry) |

---

## Structured notes (v2.4.0)

Six tools that create AI-First notes with full frontmatter, wikilinks, and a "For future Claude" preamble — safe by default (`dryRun: true`).

| Tool | Creates | Key fields |
|---|---|---|
| `vault.daily` | `Daily/YYYY-MM-DD.md` | mood, energy, summary, tags |
| `vault.person` | `People/{name}.md` | role, company, relationship |
| `vault.project` | `Projects/{name}.md` | status, team (wikilinked), summary |
| `vault.decide` | `Decisions/YYYY-MM-DD--{slug}.md` | context, decision, rationale, consequences |
| `vault.meeting` | `Meetings/YYYY-MM-DD--{slug}.md` | attendees, decisions, action items |
| `vault.ingest` | `00-Inbox/{slug}.md` | content, source URL, type, preamble |

Every note gets `ai-first: true` in frontmatter and a two-sentence preamble so a future Claude can decide relevance in seconds without reading the full note.

`vault.init` (v2.5.0) scaffolds a methodology layout — `generic`, `para`, `lyt`, or `zettelkasten` — into an empty or existing vault, safe by default (`dryRun: true`). All write operations are now covered by per-file advisory locking with a 60s TTL, so multiple agents can write to the same vault concurrently without clobbering each other. Inspired by [claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian).

---

## Thinking and research commands (v2.4.0)

Thirteen slash commands in `commands/` for use in any Claude Code, Codex CLI, Gemini CLI, or OpenCode session. They run reasoning over the vault using the MCP tools above — no LLM logic lives in the server.

| Command | What it does |
|---|---|
| `/vault-synthesize` | Scan recent notes for unnamed cross-source patterns; write synthesis notes |
| `/vault-reconcile` | Find semantic contradictions across vault notes; auto-resolve or flag ambiguous ones |
| `/vault-emerge` | Identify topics gaining momentum in the last 14 days |
| `/vault-research` | Web research dossier (Wikipedia, HN, arXiv, etc.) saved to `Research/` |
| `/vault-challenge` | Devil's advocate: surface weak claims and counter-evidence in a note |
| `/vault-connect` | Map unexpected connections between concepts, people, and projects |
| `/vault-panel` | Multi-perspective take: generate 3–5 stakeholder views with tensions |
| `/vault-recap` | Period review (week/month/quarter) from vault activity |
| `/vault-graduate` | Graduation decision on an idea: ship / invest more / archive |
| `/vault-learn` | Extract transferable principles from an experience and save to `Knowledge/` |
| `/vault-autoresearch` | Three-round autonomous research loop: question, investigate, refine, write up |
| `/vault-think` | Apply a 10-principle thinking framework to a topic or note |
| `/vault-expand` | Expand a single source into 8–15 interlinked wiki pages |

Inspired by [obsidian-second-brain](https://github.com/eugeniughelbur/obsidian-second-brain) and [claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian). vault-mind provides the infrastructure; these commands provide the workflow patterns that sit on top.

---

## How it works (30-second tour)

Your markdown files -- with wikilinks `[[like this]]`, aliases, frontmatter tags, and mtime -- are the source of truth. The compiler turns raw topic folders into a concept graph (nodes = notes, edges = links and semantic relationships), summaries, and concept pages. The MCP server exposes this graph as tools: `vault.search`, `vault.backlinks`, `vault.graph`, and 40+ more.

When Claude Code (or any MCP-compatible agent) runs `/vault-librarian`, it calls `vault.search` and `vault.read` directly. The agent gets citations -- not guesses.

- No embeddings required at small scale. Optional pgvector-backed semantic search via the `memU` adapter.
- No database. Filesystem-only by default; a compiled graph is cached as plain JSON alongside the vault.
- No Obsidian required at runtime. The `filesystem` adapter is always available. Obsidian is an optional adapter if you want live plugin-API features via a WebSocket bridge.
- No code intelligence required at small scale. Optional project-wide knowledge graph (code + docs + PDFs + images) via the `graphify` adapter (`uv tool install graphifyy`).

---

## Deep dives

The wiki has the long-form answers. Read them in any order.

| Page | Answers |
|---|---|
| [**Rationale**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Rationale) | Why this exists. Why not just grep, not just an Obsidian plugin, not just a vector DB, not just a long-context LLM. Covers the product drift. |
| [**Architecture**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Architecture) | Four-layer system diagram. Request lifecycle (8 steps, `/vault-librarian` to cited answer). Extension points. |
| [**Adapter-Spec**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Adapter-Spec) | Adapter contract, capability matrix, fan-out and ranking, failure modes, recipe for a fifth adapter. |
| [**Compile-Pipeline**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Compile-Pipeline) | What each stage produces, where the graph lives on disk, performance reference points. |
| [**Research Compiler Loop**](docs/RESEARCH_COMPILER_LOOP.md) | The product loop: raw materials, compiled wiki, cited Q&A, AI-Output filing, review, promotion. |
| [**Persona-Design**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Persona-Design) | User-facing knowledge roles vs underlying skills. The design discipline that keeps them from collapsing into one generic agent. |
| [**Security-Model**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Security-Model) | Dry-run default, protected paths, preflight gates, bearer-token transport, what this explicitly does not secure. |
| [**Recipes**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Recipes) | Content collectors and local knowledge feeders (Feishu, Gmail, Linear, X, WeChat, Dreamtime, and more) that land external sources into the vault. |
| [**FAQ**](https://github.com/2233admin/obsidian-llm-wiki/wiki/FAQ) | Does it need Obsidian running? How big a vault? Why dry-run? First-draft answers, expands as questions come in. |

---
---

## License

GPL-3.0. See [LICENSE](LICENSE).
