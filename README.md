# LLM Wiki Bridge

Your markdown vault, compiled into a 6-persona team for any agent.

![demo](docs/gif/demo.gif)

Your vault has 500 notes. You forget half of them. Your AI agent cannot read them. Every morning you spend 20 minutes re-finding what you already knew.

LLM Wiki Bridge solves this. It compiles your markdown vault -- wikilinks, aliases, tags, frontmatter -- into an MCP server your agent calls directly. The agent does not guess. It searches, reads, and cites with full vault context.

---

## Quick start (30 seconds)

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git ~/obsidian-llm-wiki-src
cd ~/obsidian-llm-wiki-src && ./setup                # --host claude | codex | opencode | gemini
```

Setup copies a 1.6 MB curated bundle into your host's skills directory (not the whole 64 MB repo). The printed `.mcp.json` snippet plus the `CLAUDE.md` persona block is everything else you need. Restart your agent host afterward so the MCP registration takes effect.

Prefer PowerShell on Windows:

```powershell
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git "$HOME\obsidian-llm-wiki-src"
cd "$HOME\obsidian-llm-wiki-src"; .\setup.ps1
```

---

## Who this is for

- The researcher with 2,000 notes who cannot remember what they wrote last month
- The developer who wants an agent that actually reads their documentation before writing code
- The team that uses Obsidian for meeting notes, design docs, and specs -- and wants AI to stay honest

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

## 6 personas

| Name | What it does | Primary MCP tools |
|---|---|---|
| vault-librarian | reads, searches, cites from the vault | vault.search, vault.read, vault.list |
| vault-architect | compiles concept graph, suggests refactors | vault.graph, vault.backlinks, compile.run |
| vault-curator | finds orphans, dead links, duplicates, stale notes | vault.lint, vault.searchByTag, vault.search |
| vault-teacher | explains a note in context of its neighbors | vault.backlinks, vault.read, vault.graph |
| vault-historian | answers what you were thinking on date X | vault.searchByFrontmatter, vault.stat, vault.search |
| vault-janitor | proposes cleanups, dry-run by default | vault.lint, vault.delete (dry), vault.rename (dry) |

---

## How it works (30-second tour)

Your markdown files -- with wikilinks `[[like this]]`, aliases, frontmatter tags, and mtime -- are the source of truth. The compiler runs once and produces a concept graph (nodes = notes, edges = links and semantic relationships). The MCP server exposes this graph as tools: `vault.search`, `vault.backlinks`, `vault.graph`, and 40+ more.

When Claude Code (or any MCP-compatible agent) runs `/vault-librarian`, it calls `vault.search` and `vault.read` directly. The agent gets citations -- not guesses.

No embeddings required at small scale. No database. No Obsidian required at runtime (filesystem adapter is always available).

---

## Install (if quick-start did not work)

See [docs/INSTALL.md](docs/INSTALL.md).

---

## Open questions / honest limits

- It does not understand code in your notes -- it indexes text, wikilinks, and structure
- It does not sync bidirectionally with Obsidian in real time (WebSocket adapter requires Obsidian to be running)
- It does not replace a vector database for semantic similarity at scale -- use the optional memU adapter if you need that

---

## License

MIT. Fork it. Improve it. Make it yours.
