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

## Knowledge roles, one MCP surface

Each `/vault-*` command is a knowledge-work role over the same 40-operation MCP tool set. They are jobs in the pipeline, not product mascots.

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
