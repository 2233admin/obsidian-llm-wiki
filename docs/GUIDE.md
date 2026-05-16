# LLMwiki — User Guide

> 🌐 **Languages**: English (this page) · [简体中文](GUIDE.zh-CN.md)

A practical walk-through: install, compile raw research, ask cited questions, and file useful AI output for review.

If you hit a wall, jump to [Troubleshooting](#troubleshooting) or open [an issue](https://github.com/2233admin/obsidian-llm-wiki/issues).

---

## What this gives you

You are here because your team already lost knowledge once.

Not because nobody wrote it down. They did. The problem is that notes, repo findings, and agent answers have no state: no source, no reviewer, no promotion path.

**LLMwiki** turns that into a simple loop:

```
capture -> compile -> ask -> file -> review -> promote
```

Raw notes become compiled summaries and concepts. Useful agent answers become quarantined drafts. Only reviewed conclusions become durable team memory.

It is not an AI companion. It is a knowledge compiler for team vaults: `raw/` becomes `wiki/`, cited answers land in `00-Inbox/AI-Output/`, and durable memory is promoted through review.

It works with **Claude Code, Codex, OpenCode, and Gemini CLI**. Obsidian is optional — the filesystem adapter handles everything without it.

---

## 30-second install

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git ~/obsidian-llm-wiki-src
cd ~/obsidian-llm-wiki-src && ./setup
```

**Windows PowerShell:**

```powershell
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git "$HOME\obsidian-llm-wiki-src"
cd "$HOME\obsidian-llm-wiki-src"; .\setup.ps1
```

**Pick a host explicitly:**

```bash
./setup --host claude     # default
./setup --host codex
./setup --host opencode
./setup --host gemini
```

After setup prints two paste-in snippets (a `.mcp.json` entry + a `CLAUDE.md` role block), restart your agent host.

Full install details, per-host paths, manual install, and uninstall are in [INSTALL.md](INSTALL.md).

---

## First success path

Run this before touching your real vault. It proves the product loop with the bundled demo vault.

The current compiler runs per topic directory. In this demo, `examples/collab-vault/research-compiler/` has its own `raw/` and `wiki/`:

```bash
python compiler/compile.py examples/collab-vault/research-compiler --tier haiku --dry-run
python scripts/knowledge_health.py --vault examples/collab-vault --json
python scripts/llmwiki_doctor.py --vault examples/collab-vault --json
```

The dry-run compiler uses stub extraction, so this does not need an API key. `knowledge_health.py` checks whether raw sources, compiled wiki artifacts, AI-Output, and promoted memory still line up. `llmwiki_doctor.py` checks runtime, policy, lint, and governance.

Open these files side by side:

| What to inspect | Path |
|---|---|
| Source material | `examples/collab-vault/research-compiler/raw/team-memory-os.md` |
| Compiled summary | `examples/collab-vault/research-compiler/wiki/summaries/team-memory-os.md` |
| Filed AI draft | `examples/collab-vault/00-Inbox/AI-Output/codex/project-setup-proposal.md` |
| Reviewed memory | `examples/collab-vault/20-Decisions/2026-05-16-gitea-reviewed-vault.md` |

That is the loop:

```
raw/ -> wiki/ -> query -> 00-Inbox/AI-Output/ -> reviewed/promoted
```

See [RESEARCH_COMPILER_LOOP.md](RESEARCH_COMPILER_LOOP.md) for the full operating procedure and technical model.

---

## First agent session

After install, point `VAULT_PATH` at a real markdown vault and restart your agent host.

### 1. Sanity check — list one role

In Claude Code (or your agent host), type:

```
/vault-librarian how many notes are in my vault
```

You should see a count and a handful of recent note paths. If this works, MCP is wired and your vault is indexed.

### 2. Ask a real question

```
/vault-librarian what have I written about <topic you actually know>
```

The librarian searches, reads top matches, and gives you an answer with citations. If it says "no results found", try a broader topic — the librarian cites only, never fabricates.

### 3. See what's orphaned

```
/vault-curator find notes that nothing else links to
```

Curator runs `vault.lint` and shows orphans + broken links. Great first cleanup pass.

### 4. Understand a concept in context

```
/vault-teacher explain [[name-of-one-of-your-notes]]
```

Teacher pulls the note, finds its backlinks and outbound links, and explains where it fits in your graph.

### 5. Check what you wrote last month

```
/vault-historian what was I thinking about in March
```

Historian searches by frontmatter dates + mtime, groups by theme.

That is the agent side of the loop: query with citations, file useful output, then review what deserves to become team memory.

---

## Knowledge roles

| Role | Best for | Reads | Writes |
|---|---|---|---|
| **vault-librarian** | "What do I know about X?" — source-cited answers | ✅ | — |
| **vault-architect** | Concept graph compile + refactor suggestions | ✅ | proposes only |
| **vault-curator** | Health report: orphans, broken links, duplicates | ✅ | — |
| **vault-teacher** | Explain a note in graph context | ✅ | — |
| **vault-historian** | "What was I thinking on date X" | ✅ | — |
| **vault-janitor** | Cleanup plan with dry-run review | ✅ | dry-run by default |
| **vault-gardener** | Seed an empty vault + run health passes | ✅ | dry-run by default |

**All write operations default to dry-run.** You see the plan before anything touches disk.

Detailed role constraints live in `skills/vault-*.md` once installed.

---

## AI-Output filing

Every meaningful role analysis can be saved under:

```
{vault}/00-Inbox/AI-Output/{role}/YYYY-MM-DD-{slug}.md
```

Each saved analysis has provenance frontmatter:

```yaml
---
generated-by: vault-architect
generated-at: 2026-04-21T14:32:00.000Z
agent: claude-opus-4-7
parent-query: "refactor authentication module"
source-nodes:
  - "[[auth-architecture]]"
  - "[[session-tokens]]"
status: draft
scope: project
quarantine-state: new
---
```

### Why this matters

Without this, useful agent work evaporates when your session ends. With it, the vault keeps candidate outputs with citations and review state. Next time you ask `/vault-librarian what did the architect role say about auth`, it can find the filed draft.

### Lifecycle markers

- `draft` (auto, on write) — fresh output, not reviewed
- `reviewed` — you manually flipped it after confirming it's useful
- `stale` — gardener auto-flipped after N days with no backlinks from your own notes
- `superseded` — newer analysis covers the same source notes (gardener proposes, you confirm)
- `quarantine-state: promoted` — durable knowledge was moved or rewritten into a reviewed team path

### How to review

Open `00-Inbox/AI-Output/{role}/` in your editor. Flip `status: draft` → `reviewed` in the frontmatter of anything you want to keep. Promote durable conclusions by moving or rewriting them into `20-Decisions/`, `30-Architecture/`, or `40-Runbooks/` through review. Do nothing for the rest — the gardener will report stale candidates after the role-specific timeout.

Full details: [ai-output-convention.md](ai-output-convention.md).

---

## Optional Obsidian graph check

After you have real AI-Output notes, open one in Obsidian and turn on Local Graph at depth `2`. You should see the draft linked to its `source-nodes` and review tags. This is only a visual check; the product invariant is still the filesystem state:

```
source note -> cited AI-Output draft -> reviewed durable note
```

---

## Vault structure

You do **not** need to restructure your vault. LLMwiki works with whatever you already have.

It only creates one new directory when a role writes an analysis:

```
your-vault/
├── (your existing notes, untouched)
└── 00-Inbox/
    └── AI-Output/
        ├── vault-architect/
        ├── vault-gardener/
        └── ...
```

If you don't want AI-Output in your root, set `VAULT_PATH` in `.mcp.json` to a sub-folder of your actual vault. The MCP server treats `VAULT_PATH` as the root — it won't write outside it.

---

## Common prompts cheat sheet

| You want | Say |
|---|---|
| A fact-based answer | `/vault-librarian <question>` |
| A cleanup pass | `/vault-curator what's broken` |
| A note explained | `/vault-teacher explain [[note-name]]` |
| A time window | `/vault-historian what was I thinking in <month>` |
| A restructure idea | `/vault-architect suggest refactors` |
| Safe cleanup execution | `/vault-janitor clean up orphans, dry run first` |
| Seed a fresh vault | `/vault-gardener help me set up notes about <topic>` |

---

## Troubleshooting

### Role command doesn't respond

Restart your agent host. MCP registration is picked up at startup. If it still doesn't work, check the host's MCP logs for `obsidian-llm-wiki: server running (stdio ...)`.

### `vault.search` returns nothing but your vault has files

`VAULT_PATH` in your `.mcp.json` is probably wrong or relative. Must be an absolute path to a directory that contains `.md` files.

### Agent writes to the wrong place

Check `VAULT_PATH` again. The MCP server refuses to write outside that path — if writes are landing somewhere unexpected, your path is unexpected.

### I don't want AI-Output in my vault

Two options: (a) set `VAULT_PATH` to a dedicated scratch directory, or (b) after use, move useful AI-Output files into proper topic folders and delete the rest.

### The `node` command errors with "stdin is not a tty"

On Git Bash (Windows), `node` is aliased to `winpty node.exe`. Use `node.exe` directly in non-interactive scripts. Not relevant for running the MCP server — your agent host invokes node correctly.

### My `generated-at` timestamps are wrong

The server uses UTC. Your local wall clock may differ by a timezone. Everything inside the vault stays in UTC for consistency.

### Install-specific issues

Detailed install/uninstall troubleshooting is in [INSTALL.md § Troubleshooting](INSTALL.md#troubleshooting).

---

## FAQ

### Do I need Obsidian?

No. The filesystem adapter works without it. Obsidian adds live sync when combined with the `obsidian-vault-bridge` plugin, but that's optional.

### Does this use embeddings / a vector DB?

No. Search is keyword + wikilink graph based. You can optionally plug the `memU` adapter (pgvector) if you need semantic search at very large scale, but it's off by default.

### What if my vault has 10,000+ notes?

The compile step builds an in-memory graph; at 10k notes expect ~30-60s on first run. Subsequent queries are fast. For true scale (100k+), the optional pgvector adapter exists.

### How do I update?

`cd ~/obsidian-llm-wiki-src && git pull && ./setup` — setup re-copies the latest bundle.

### Is it safe to run against my real vault?

Yes. All mutating operations default to `dryRun: true`. The server refuses paths outside `VAULT_PATH` and rejects `.obsidian/`, `.trash/`, `.git/`, `node_modules/` by design. AI-Output writes go into one scoped directory you can delete wholesale.

### Can I use my own models?

The roles don't care about the model — they're prompts over MCP tools. Whatever agent host you use (Claude Code / Codex / etc.) decides the model.

### Where do the MCP tools live?

Generated reference: [mcp-tools-reference.md](mcp-tools-reference.md). 38 tools across 5 namespaces. Drift-guarded by a CI test.

---

## Related reading

- [INSTALL.md](INSTALL.md) — per-host install, manual install, uninstall
- [ai-output-convention.md](ai-output-convention.md) — sediment system schema & lifecycle
- [WHY_NOT_JUST_GREP.md](WHY_NOT_JUST_GREP.md) — why this beats raw grep
- [mcp-tools-reference.md](mcp-tools-reference.md) — full tool catalog
- [philosophy.md](philosophy.md) — design principles

---

GPL-3.0 licensed. See [LICENSE](../LICENSE).
