# LLMwiki User Guide

> 🌐 **Languages**: English (this page) · [简体中文](GUIDE.zh-CN.md)

This guide walks through install, first query, demo compiler loop, AI-output filing, projects, sources, and Canvas diagrams.

## Install

Claude Code plugin path:

```text
/plugin marketplace add 2233admin/obsidian-llm-wiki
/plugin install llmwiki@obsidian-llm-wiki
```

The plugin includes the MCP server, bundled skills, and Canvas diagram support. Start Claude Code inside your vault, or set `VAULT_MIND_VAULT_PATH` to an absolute path.

Other hosts use setup:

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git ~/obsidian-llm-wiki-src
cd ~/obsidian-llm-wiki-src
bash ./setup --host codex
```

Windows PowerShell:

```powershell
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git "$HOME\obsidian-llm-wiki-src"
cd "$HOME\obsidian-llm-wiki-src"
.\setup.ps1 -VaultHost codex
```

Supported setup hosts:

```bash
bash ./setup --host claude
bash ./setup --host codex
bash ./setup --host opencode
bash ./setup --host gemini
```

Setup installs into the legacy-compatible `vault-wiki` directory and prints a `vault-mind` MCP config snippet. Full details are in [INSTALL.md](INSTALL.md).

## First Agent Session

Point `VAULT_MIND_VAULT_PATH` at a real Markdown vault and restart the agent host.

Ask:

```text
List a few recent notes in my vault using LLMwiki MCP tools.
```

If this returns note paths, the filesystem adapter can read the vault.

Then ask a cited question:

```text
What have I written about <topic I actually know>? Search the vault, read the top matches, and cite file paths.
```

For graph context:

```text
Explain [[name-of-one-of-your-notes]] in graph context. Use backlinks and outbound links.
```

For cleanup planning:

```text
Find notes nothing else links to and broken wikilinks. Return a dry-run cleanup plan.
```

For diagrams:

```text
Create an Obsidian Canvas map for this project architecture. Keep the source of truth as a .canvas file.
```

The `vault-diagram` skill keeps diagrams editable as JSON Canvas files.

## Demo Compiler Loop

Run this before touching a production vault:

```bash
python compiler/compile.py examples/collab-vault/research-compiler --tier haiku --dry-run
python scripts/knowledge_health.py --vault examples/collab-vault --json
python scripts/llmwiki_doctor.py --vault examples/collab-vault --json
```

The compiler dry-run uses stub extraction, so it does not require an API key. Inspect:

| What | Path |
| --- | --- |
| Source material | `examples/collab-vault/research-compiler/raw/team-memory-os.md` |
| Compiled summary | `examples/collab-vault/research-compiler/wiki/summaries/team-memory-os.md` |
| Filed AI draft | `examples/collab-vault/00-Inbox/AI-Output/codex/project-setup-proposal.md` |
| Reviewed memory | `examples/collab-vault/20-Decisions/2026-05-16-gitea-reviewed-vault.md` |

The operating loop is:

```text
raw/ -> wiki/ -> query -> 00-Inbox/AI-Output/ -> reviewed/promoted
```

## AI-Output Filing

Useful agent analysis should be saved under:

```text
{vault}/00-Inbox/AI-Output/{role}/YYYY-MM-DD-{slug}.md
```

Each saved draft has provenance frontmatter:

```yaml
---
generated-by: vault-architect
generated-at: 2026-04-21T14:32:00.000Z
agent: claude
parent-query: "refactor authentication module"
source-nodes:
  - "[[auth-architecture]]"
  - "[[session-tokens]]"
status: draft
scope: project
quarantine-state: new
---
```

Keep drafts in quarantine until reviewed. Promote durable conclusions into reviewed team paths such as `20-Decisions/`, `30-Architecture/`, and `40-Runbooks/`.

## Local Projects

Use `project.*` tools when you want Linear-style task state inside the vault. Issues, comments, dependencies, and views live under:

```text
10-Projects/<project>/docket/
```

Good first flow:

```text
Initialize a project named alpha, create an issue, add a comment, and export a project board. Keep all writes dry-run first.
```

Project visual exports can create:

- `10-Projects/<project>/views/project-map.canvas`
- `10-Projects/<project>/views/issues.base`

## Source Registry

Use `source.register` before promising an external link is captured. It records a source note and preflight plan without scraping private data or downloading media.

Durable source paths:

```text
_llmwiki/source-registry.json
00-Inbox/Sources/<platform>/<source>.md
10-Projects/<project>/sources/<platform>/<source>.md
```

Use `source.list` and `source.get` to inspect registered sources.

## Optional Capture Skills

`chubbyskills` handles broader local capture and transcription flows such as Bilibili, Douyin, podcasts, WeChat, Xiaohongshu, X/Twitter, and YouTube. LLMwiki handles retrieval, citation, memory, and review.

`x-to-obsidian` supports X/Twitter capture through Obsidian Web Clipper workflows.

## Troubleshooting

If the MCP server starts but search returns nothing, check that `VAULT_MIND_VAULT_PATH` is absolute and points to a directory with `.md` files.

If `mcp-server/bundle.js` is missing in a source checkout, run:

```bash
cd mcp-server
npm install
npm run rebuild
```

If semantic recall is off, that is expected unless you configured Ollama or `VAULT_MIND_EMBED_URL`; keyword recall still works.
