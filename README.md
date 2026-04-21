# LLM Wiki Bridge

**Your markdown vault, compiled into a 6-persona MCP team for Claude Code, Codex, OpenCode, and Gemini CLI. Headless-first. Cites, doesn't guess.**

> 📖 **Guide**: [English](docs/GUIDE.md) · [简体中文](docs/GUIDE.zh-CN.md) | 🌐 **Wiki**: [Home](https://github.com/2233admin/obsidian-llm-wiki/wiki) · [Architecture](https://github.com/2233admin/obsidian-llm-wiki/wiki/Architecture) · [Rationale](https://github.com/2233admin/obsidian-llm-wiki/wiki/Rationale) · [FAQ](https://github.com/2233admin/obsidian-llm-wiki/wiki/FAQ)

![demo](docs/gif/demo.gif)

You have 500 markdown notes. You forget half of them. Your AI agent cannot read them -- it paraphrases from its context window and fabricates citations. Every morning you spend 20 minutes re-finding what you already knew.

LLM Wiki Bridge is a headless-first MCP server that compiles your vault -- wikilinks, aliases, tags, frontmatter -- into a concept graph your agent calls directly. The agent does not guess. It calls `vault.search`, reads the cited notes with `vault.read`, and answers with evidence. No Obsidian required at runtime; the filesystem adapter is always the floor.

Inspired by [Andrej Karpathy's LLM Wiki](https://github.com/karpathy/llm-wiki) concept. Orthodox implementation: markdown as the source of truth, compile the structure, expose via MCP.

---

## Quick start (30 seconds)

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git ~/obsidian-llm-wiki-src
cd ~/obsidian-llm-wiki-src && ./setup                # --host claude | codex | opencode | gemini
```

Windows (PowerShell):

```powershell
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git "$HOME\obsidian-llm-wiki-src"
cd "$HOME\obsidian-llm-wiki-src"; .\setup.ps1
```

Setup copies a 1.6 MB curated skill bundle into your host's skills directory (not the whole 64 MB repo). The printed `.mcp.json` snippet plus the `CLAUDE.md` persona block is everything else you need. Restart your agent host afterward so the MCP registration takes effect.

---

## Works with

Any MCP-compatible host:

| Host | Command | Status |
|---|---|---|
| Claude Code | `./setup --host claude` | tested |
| Codex CLI | `./setup --host codex` | tested |
| OpenCode | `./setup --host opencode` | tested |
| Gemini CLI | `./setup --host gemini` | tested |

Anything else speaking stdio MCP transport should work; the `setup` script just copies skills into the right directory for the named hosts.

---

## Try it: example prompts

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

## Six personas, one MCP surface

Each persona is an opinionated prompt over the same 40-operation MCP tool set.

| Name | What it does | Primary MCP tools |
|---|---|---|
| vault-librarian | reads, searches, cites from the vault | `vault.search`, `vault.read`, `vault.list` |
| vault-architect | compiles concept graph, suggests refactors | `vault.graph`, `vault.backlinks`, `compile.run` |
| vault-curator | finds orphans, dead links, duplicates, stale notes | `vault.lint`, `vault.searchByTag`, `vault.search` |
| vault-teacher | explains a note in context of its neighbors | `vault.backlinks`, `vault.read`, `vault.graph` |
| vault-historian | answers what you were thinking on date X | `vault.searchByFrontmatter`, `vault.stat`, `vault.search` |
| vault-janitor | proposes cleanups, dry-run by default | `vault.lint`, `vault.delete` (dry), `vault.rename` (dry) |

---

## How it works (30-second tour)

Your markdown files -- with wikilinks `[[like this]]`, aliases, frontmatter tags, and mtime -- are the source of truth. The compiler runs once and produces a concept graph (nodes = notes, edges = links and semantic relationships). The MCP server exposes this graph as tools: `vault.search`, `vault.backlinks`, `vault.graph`, and 40+ more.

When Claude Code (or any MCP-compatible agent) runs `/vault-librarian`, it calls `vault.search` and `vault.read` directly. The agent gets citations -- not guesses.

- No embeddings required at small scale. Optional pgvector-backed semantic search via the `memU` adapter.
- No database. Filesystem-only by default; a compiled graph is cached as plain JSON alongside the vault.
- No Obsidian required at runtime. The `filesystem` adapter is always available. Obsidian is an optional adapter if you want live plugin-API features via a WebSocket bridge.

---

## Deep dives

The wiki has the long-form answers. These seven pages are the accumulation asset -- read them in any order.

| Page | Answers |
|---|---|
| [**Rationale**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Rationale) | Why this exists. Why not just grep, not just an Obsidian plugin, not just a vector DB, not just a long-context LLM. Honest about product drift. |
| [**Architecture**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Architecture) | Four-layer system diagram. Request lifecycle (8 steps, `/vault-librarian` to cited answer). Extension points. |
| [**Adapter-Spec**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Adapter-Spec) | Adapter contract, capability matrix, fan-out and ranking, failure modes, recipe for a fifth adapter. |
| [**Compile-Pipeline**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Compile-Pipeline) | What each stage produces, where the graph lives on disk, performance reference points. |
| [**Persona-Design**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Persona-Design) | Six user-facing personas vs seventeen underlying skills. The design discipline that keeps them from collapsing into one generic agent. |
| [**Security-Model**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Security-Model) | Dry-run default, protected paths, preflight gates, bearer-token transport, what this explicitly does not secure. |
| [**Recipes**](https://github.com/2233admin/obsidian-llm-wiki/wiki/Recipes) | Content collectors (Feishu, Gmail, Linear, X, WeChat, and more) that land external sources into the vault. |
| [**FAQ**](https://github.com/2233admin/obsidian-llm-wiki/wiki/FAQ) | Does it need Obsidian running? How big a vault? Why dry-run? First-draft answers; will iterate as real questions surface. |

---

## Install (if quick-start did not work)

See [docs/INSTALL.md](docs/INSTALL.md).

---

## Open questions / honest limits

- It does not understand code in your notes -- it indexes text, wikilinks, and structure. For AST-level code reasoning, enable the optional `gitnexus` adapter.
- It does not sync bidirectionally with Obsidian in real time -- the WebSocket adapter requires Obsidian to be running.
- It does not replace a vector database for semantic similarity at scale -- enable the optional `memU` adapter if you need that.
- The positioning between this repo (headless MCP) and its sibling `obsidian-vault-bridge` (Obsidian plugin) is being refined. See the [Rationale](https://github.com/2233admin/obsidian-llm-wiki/wiki/Rationale) page for the drift discussion.

---

## License

MIT. Fork it. Improve it. Make it yours.
