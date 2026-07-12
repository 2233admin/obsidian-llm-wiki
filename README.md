<p align="center">
  <img src="docs/assets/banner.svg" alt="LLMwiki - raw research compiled into reviewed team wiki" width="100%">
</p>

# LLMwiki

**LLMwiki turns a team's raw research folder into reviewed, queryable, self-improving Obsidian wiki. Headless-first. Cites, does not guess.**

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-stdio-orange.svg)](https://modelcontextprotocol.io)
[![Wiki](https://img.shields.io/badge/wiki-deep_dives-D97757.svg)](https://github.com/2233admin/obsidian-llm-wiki/wiki)

**Language**: English (this page) · [简体中文](docs/zh-CN/)

**Guide**: [English](docs/GUIDE.md) · [简体中文](docs/GUIDE.zh-CN.md) · [Install](docs/INSTALL.md)

![demo](docs/gif/demo.gif)

Teams do write things down: papers, meeting notes, repo findings, screenshots, and agent answers. The hard part is state: sources, reviewers, promotion paths, and a clear line between draft output and team truth.

LLMwiki gives that material a compiler pass:

```text
capture -> compile -> ask -> file -> review -> promote
```

Put source material in `raw/`. Compile it into `wiki/` summaries, concept pages, backlinks, and contradiction reports. Ask agents cited questions. File useful answers into `00-Inbox/AI-Output/`. Promote only reviewed knowledge into decisions, architecture notes, and runbooks.

Obsidian is the IDE, Git/Gitea review is the ledger, and MCP/CLI tools are the execution surface. Markdown remains the source of truth. Inspired by [Andrej Karpathy's LLM Wiki](https://github.com/karpathy/llm-wiki).

## Quick Start

Claude Code users should install the plugin. No clone, build, or manual `.mcp.json` edit is required:

```text
/plugin marketplace add 2233admin/obsidian-llm-wiki
/plugin install llmwiki@obsidian-llm-wiki
```

The plugin ships the MCP server, bundled skills, and Canvas diagram support. Start Claude Code inside your vault, or set `VAULT_MIND_VAULT_PATH` to an absolute vault path.

For Codex, OpenCode, Gemini, or legacy-compatible local installs:

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git
cd obsidian-llm-wiki
bash ./setup --host codex
```

Windows:

```powershell
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git
cd obsidian-llm-wiki
.\setup.ps1 -VaultHost codex
```

The setup path installs the legacy-compatible `vault-wiki` skill bundle and prints a `vault-mind` MCP config snippet. See [docs/INSTALL.md](docs/INSTALL.md).

## What Ships

The setup and release asset list is centralized in `packaging/llmwiki-distribution.json`; `scripts/check-distribution.mjs` verifies the manifest against plugin metadata, skills, MCP bundle files, and docs.

| Area | Surface |
| --- | --- |
| Vault operations | `vault.*`, `query.*`, graph, lint, backlinks, cited answers |
| Memory | `memory.*`, handoffs, passports, sessions, conversation decisions |
| Projects | `project.*`, local issues, comments, dependencies, Kanban/Canvas/Bases exports |
| Sources | `source.*`, Source Registry, URL preflight, evidence notes |
| Context | `context.*`, wakeup, recall, deep search |
| Skills | `chubbyskills`, `x-to-obsidian`, `vault-diagram` |

The MCP server keeps the compatibility name `vault-mind`; public docs and plugin metadata use **LLMwiki** / `llmwiki`.

## Try The Loop

Run the bundled demo before touching a real vault:

```bash
python compiler/compile.py examples/collab-vault/research-compiler --tier haiku --dry-run
python scripts/knowledge_health.py --vault examples/collab-vault --json
python scripts/llmwiki_doctor.py --vault examples/collab-vault --json
```

Inspect the path from raw source to reviewed memory:

| Step | Path |
| --- | --- |
| Raw source | `examples/collab-vault/research-compiler/raw/team-memory-os.md` |
| Compiled summary | `examples/collab-vault/research-compiler/wiki/summaries/team-memory-os.md` |
| Compiled concept | `examples/collab-vault/research-compiler/wiki/concepts/team-memory-os.md` |
| Filed AI output | `examples/collab-vault/00-Inbox/AI-Output/codex/project-setup-proposal.md` |
| Reviewed memory | `examples/collab-vault/20-Decisions/2026-05-16-gitea-reviewed-vault.md` |

## Example Prompts

```text
What do I know about attention heads? Search my vault, read the strongest matching notes, and cite file paths.
```

```text
Explain [[retrieval-augmented-generation]] in the context of related notes. Use backlinks and outbound links.
```

```text
Find orphan notes and stale notes that have not been updated in 90 days. Return a dry-run cleanup plan.
```

```text
Create an Obsidian Canvas map for this project architecture. Keep the source of truth as a .canvas file.
```

## Recall

Keyword recall works with zero setup. The first `context.recall` or `query.answer` call lazily indexes notes using local Postgres full-text and trigram search; no embeddings daemon is required.

Semantic recall is optional. Run [Ollama](https://ollama.com) and `ollama pull bge-m3`, or point `VAULT_MIND_EMBED_URL` at an OpenAI-compatible embedding endpoint. Keyword recall keeps working either way.

## Visual Layer

LLMwiki includes Canvas and project visualization support without requiring Obsidian to be running:

- `project.canvas.export` writes `10-Projects/<project>/views/project-map.canvas`.
- `project.base.export` writes `10-Projects/<project>/views/issues.base`.
- `vault-diagram` helps agents maintain editable JSON Canvas diagrams from vault context, Mermaid snippets, and architecture prompts.

Archify assets are included as the diagram rendering adapter and are installed through both plugin and setup paths.

## Source Registry

Use `source.register` when a URL or vault note becomes a durable source. URL registration writes:

- `_llmwiki/source-registry.json`
- `00-Inbox/Sources/<platform>/<source>.md`
- `10-Projects/<project>/sources/<platform>/<source>.md` when `project` is provided

Use `ingest.link.preflight` before promising capture. LLMwiki only claims ingest success after Markdown lands in the vault and can be found by `vault.search` or `query.unified`.

## License

GPL-3.0. See [LICENSE](LICENSE).
