# LLM Wiki Bridge — User Guide

> 🌐 **Languages**: English (this page) · [简体中文](GUIDE.zh-CN.md)

A friendly walk-through: install, first useful prompt, what each persona does, and how the AI keeps its own work.

If you hit a wall, jump to [Troubleshooting](#troubleshooting) or open [an issue](https://github.com/2233admin/obsidian-llm-wiki/issues).

---

## What this gives you

Your markdown vault already has hundreds of notes. Your AI agent cannot read them. Every morning you spend time re-finding what you already knew.

**LLM Wiki Bridge** turns your vault into a 6-persona virtual team that your AI agent can call directly. You paste a prompt like `/vault-librarian what do I know about attention heads` and the agent searches your real notes, reads them, and cites paths — it does not guess.

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

After setup prints two paste-in snippets (a `.mcp.json` entry + a `CLAUDE.md` persona block), restart your agent host.

Full install details, per-host paths, manual install, and uninstall are in [INSTALL.md](INSTALL.md).

---

## Your first useful session (5 minutes)

Assume your vault has any `.md` files at all.

### 1. Sanity check — list one persona

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

That's the loop. Five personas, five different questions, all grounded in your actual notes.

---

## The 7 personas

| Persona | Best for | Reads | Writes |
|---|---|---|---|
| **vault-librarian** | "What do I know about X?" — source-cited answers | ✅ | — |
| **vault-architect** | Concept graph compile + refactor suggestions | ✅ | proposes only |
| **vault-curator** | Health report: orphans, broken links, duplicates | ✅ | — |
| **vault-teacher** | Explain a note in graph context | ✅ | — |
| **vault-historian** | "What was I thinking on date X" | ✅ | — |
| **vault-janitor** | Cleanup plan with dry-run review | ✅ | dry-run by default |
| **vault-gardener** | Seed an empty vault + run health passes | ✅ | dry-run by default |

**All write operations default to dry-run.** You see the plan before anything touches disk.

Detailed persona constraints live in `skills/vault-*.md` once installed.

---

## AI-Output sediment (the feature that compounds)

Every meaningful persona analysis is automatically saved under:

```
{vault}/00-Inbox/AI-Output/{persona}/YYYY-MM-DD-{slug}.md
```

Each saved analysis has a 6-field frontmatter:

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
---
```

### Why this matters

Without this, every persona output evaporates when your session ends. With it, your vault sediments **both** your notes **and** the AI collaboration history. Next time you ask `/vault-librarian what did the architect say about auth`, it can find it.

### The 3 statuses

- `draft` (auto, on write) — fresh output, not reviewed
- `reviewed` — you manually flipped it after confirming it's useful
- `stale` — gardener auto-flipped after N days with no backlinks from your own notes
- `superseded` — newer analysis covers the same source notes (gardener proposes, you confirm)

### How to review

Open `00-Inbox/AI-Output/{persona}/` in your editor. Flip `status: draft` → `reviewed` in the frontmatter of anything you want to keep. Do nothing for the rest — the gardener will mark stale ones automatically after the per-persona timeout (architect=45d, gardener=30d, historian=180d, others=60d).

Full details: [ai-output-convention.md](ai-output-convention.md).

---

## Hand-test path (see the sediment in your graph)

The payoff for the sediment system lands best when you see it in Obsidian's Local Graph: a `#user-confirmed` cluster that visually connects an AI-Output note to the `source-nodes` it cites. Five minutes, one real write, one graph view.

### 1. Install

Follow the [30-second install](#30-second-install). You need the MCP server running and `VAULT_PATH` pointing at a real vault.

### 2. Write one human-confirmed AI-Output

From your agent host, call `vault.writeAIOutput` once with a real `parentQuery`, at least one wikilink in `sourceNodes`, and `reviewStatus: "user-confirmed"`:

```
vault.writeAIOutput({
  persona: "vault-librarian",
  parentQuery: "what do I know about attention heads",
  sourceNodes: ["[[an-actual-note-in-your-vault]]"],
  agent: "claude-opus-4-7",
  body: "<your librarian's answer, 2-3 paragraphs>",
  reviewStatus: "user-confirmed",
  dryRun: false
})
```

The server writes `00-Inbox/AI-Output/vault-librarian/YYYY-MM-DD-<slug>.md` with a `#user-confirmed` tag at the body end.

<!-- TODO: screenshot of the written AI-Output note with tag visible -->

### 3. Open the note in Obsidian

Point your Obsidian vault at `VAULT_PATH`. Navigate to `00-Inbox/AI-Output/vault-librarian/` and open the new note. You should see the frontmatter, your body, and a trailing `#user-confirmed` tag that Obsidian treats as a real tag.

### 4. Turn on Local Graph (depth 2)

Inside the note: **View → Open local graph** (or Cmd/Ctrl-P → "Open local graph"). In the graph panel's filter settings, set **Depth** to `2` or `3`. You should see:

- the AI-Output note at the center
- each wikilink from `sourceNodes` as a neighbor node
- the `#user-confirmed` tag node, clustering this output with any other human-signed outputs in your vault

<!-- TODO: screenshot of local graph with depth=2 showing tag cluster -->

This visual cluster is the sediment↔citation invariant made concrete: every human-confirmed output is one tag-hop from every source note it cites, and one tag-hop from every other human-confirmed output.

### 5. Round-trip through sweep

Strip the `#user-confirmed` tag from the body and save. Run `vault.sweepAIOutput({ dry_run: false })` once. Re-open the note — a new `history` entry should appear with `axis: status`, confirming the sweep detected the status-axis change. This closes the loop: graph-level human signal → filesystem state → audit trail.

If step 4's local graph does not show the tag cluster, check that `#user-confirmed` is on its own line at the body end (not inside frontmatter — that was the pre-Step-2.6 behavior).

---

## Vault structure

You do **not** need to restructure your vault. LLM Wiki Bridge works with whatever you already have.

It only creates one new directory when a persona writes an analysis:

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

### Persona doesn't respond

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

The personas don't care about the model — they're prompts. Whatever agent host you use (Claude Code / Codex / etc.) decides the model.

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

MIT licensed. Fork it, improve it, make it yours.
