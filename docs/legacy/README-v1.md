# obsidian-llm-wiki

> **A faithful reference implementation of [Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).**
> Plain markdown, no embeddings at small scale, headless-first MCP, native to any Obsidian vault.

Not a RAG system. Not a vector database. A **compounding knowledge base** that your LLM maintains itself — the three operations Karpathy defined (Ingest / Query / Lint), wired to your Obsidian vault via MCP.

> If you love Karpathy's gist but don't want to run Postgres+pgvector (gbrain) or give up Obsidian's UI, this is for you.

---

## Quick Start

```bash
git clone https://github.com/2233admin/obsidian-llm-wiki.git
cd obsidian-llm-wiki
bash setup.sh                     # prompts for your vault path
# Restart Claude Code so the MCP registration takes effect.
```

`setup.sh` will:
1. Check Node ≥ 20, Python ≥ 3.11, Claude Code CLI
2. Build the MCP server (`npm install` + `tsc`)
3. Install Python deps for the compiler
4. Copy `vault-mind.example.yaml` → `vault-mind.yaml` and ask for your vault path
5. Register the MCP server to `~/.claude.json` (user scope) with `VAULT_MIND_VAULT_PATH` env
6. Install the `/vault-*` skills into `~/.claude/skills/`

Project-scope `.mcp.json` is also committed — so if you open Claude Code in this
directory without running `setup.sh`, the MCP server still activates automatically
(using `vault-mind.yaml` you've created locally).

> No database required. No embeddings required. Obsidian is **optional** — filesystem fallback always works.

---

## Faithful to Karpathy

| Karpathy's gist says | How obsidian-llm-wiki implements it |
| :--- | :--- |
| Three operations: **Ingest / Query / Lint** | `recipe.run` (Ingest), `vault.search` (Query), `vault.health` + `/vault-reconcile` (Lint) |
| `index.md` + `log.md` as the catalog + chronicle | `.omc/wiki/index.md` + `.omc/wiki/log.md`, auto-maintained |
| "No embedding-based RAG infrastructure at moderate scale" | Filesystem adapter uses ripgrep only. Embeddings/memU/pgvector are **optional** adapters you can ignore |
| Obsidian as the browsing IDE | Native `ObsidianAdapter` over WebSocket — two-way sync without the Local REST API plugin |
| `CLAUDE.md` / `AGENTS.md` as vault schema | Respected as-is, not overridden |
| `qmd` as a search backend (recommended in gist) | `adapters/qmd.ts` coming in v1.1 as an optional plug-in |

---

## Core Capabilities

- **Unified Query**: Search across filesystem, memU (optional), and GitNexus (optional) through a single MCP call.
- **Knowledge Compilation**: Chunk, tag, and cross-link raw notes into concept graphs — no vector DB required.
- **10 Source Collectors**: Gmail, Feishu, X/Twitter, NapCat/QQ, WeChat, AstrBot, WeFlow, Linear, Circleback, Voile — markdown dumps into your vault, incremental with cursor state.
- **Skill-Driven Workflows** (Claude Code):
  - `/vault-health`: audit orphans, broken links, staleness
  - `/vault-reconcile`: resolve knowledge conflicts and contradictions
  - `/vault-save`: intelligently save conversation context to the right folders
  - `/vault-challenge`: let the vault argue back using your own recorded history

---

## Architecture

```text
[ Agent Layer ] <--> [ Claude Code Skills ]
       |
[ MCP Server  ] <--> [ Unified Query Layer ]
       |                      |
[ Adapters    ] <--> [ Filesystem | Obsidian | memU | GitNexus ]
       |
[ Compiler    ] <--> [ Chunking | LLM Tagging | Link Discovery ]
       |
[ Collectors  ] <--> [ Gmail | Feishu | X | Linear | 6 more ]
```

- **Filesystem adapter** is a **global invariant** — always available, pure-file fallback for any operation.
- **Obsidian adapter** is an add-on for live vault sync when Obsidian is running.
- All higher adapters (memU / GitNexus / qmd) are **optional**.

---

## How it compares

The Karpathy LLM Wiki space got crowded fast in April 2026. Here's where obsidian-llm-wiki sits:

| | obsidian-llm-wiki | [gbrain](https://github.com/garrytan/gbrain) | [qmd](https://github.com/tobi/qmd) | Other Karpathy forks (kytmanov / NiharShrotri / julianoczkowski / yhay81) |
| :--- | :---: | :---: | :---: | :---: |
| Karpathy LLM Wiki three-ops pattern | ✅ full | partial | search-only | varies |
| No embeddings required at small scale | ✅ | ❌ (pgvector) | ✅ (BM25) | mixed |
| Storage | plain markdown | Postgres + files | files + index | files |
| Runs headless (no Obsidian) | ✅ (filesystem fallback) | ✅ | ✅ | usually needs Obsidian |
| Obsidian-native (live two-way sync) | ✅ | ❌ | ❌ | some |
| MCP server | ✅ | ✅ | ✅ | some |
| Multi-source collectors | **10** (Gmail/Feishu/X/QQ/WeChat/Linear/...) | Calendar + email | none | none |
| Chinese ecosystem sources | ✅ (NapCat/WeChat/Feishu/AstrBot) | ❌ | ❌ | ❌ |
| Setup | `bash setup.sh` | Docker + Postgres | `qmd init` | varies |

**Positioning**: gbrain is the "heavy" implementation of Karpathy's pattern (durable Postgres, "dream cycles," 37 operations). obsidian-llm-wiki is the "original orthodoxy" — small scale, no embeddings, plain markdown, runs on a laptop, Obsidian-native. They serve different users.

---

## Configuration

Edit `vault-mind.yaml` (copy of `vault-mind.example.yaml`, git-ignored):

```yaml
vault_path: "/absolute/path/to/your/obsidian/vault"

adapters:
  filesystem:
    enabled: true
  obsidian:
    enabled: false   # set true when Obsidian is open with the WS bridge
  memu:
    enabled: false   # requires memU PostgreSQL + Python venv
  gitnexus:
    enabled: false   # requires gitnexus CLI on PATH
```

Alternatively, skip the yaml and set `VAULT_MIND_VAULT_PATH` env var (what
`setup.sh` does for user-scope registration).

See `docs/config.md` for the full schema.

---

## Contributing

Contributions welcome — small PRs especially. The project is GPL-3.0.

**Dev setup:**
```bash
git clone https://github.com/2233admin/obsidian-llm-wiki.git
cd obsidian-llm-wiki
bash setup.sh                                  # if you want the MCP installed
cd mcp-server
npm install
npm run build
npm test                                       # 64+ tests, should all pass
```

**Quick sanity probe after build:**
```bash
python scripts/mcp_smoketest.py      # initialize + tools/list + vault.search
python scripts/mcp_probe.py          # deeper probe: vault.list, search variants
```
Both spawn the MCP server via stdio and exit after a few seconds. If your bash
profile exits 1 on non-tty stdin (an unrelated environment bug some users hit),
use these Python wrappers.

**PR conventions:**
- Keep commits atomic. One concern per commit.
- Conventional commit prefixes: `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`
- Tests required for new vault.* operations (see `mcp-server/src/**/*.test.ts`).
- New collectors need a `recipes/<name>-to-vault.md` recipe + `recipes/collectors/<name>-collector.ts` + health check.
- Don't commit `vault-mind.yaml` (it's git-ignored for a reason — personal paths).

**What we need help with:**
- Concept-graph compiler (`compiler/link_discovery.py`, `compiler/concept_graph.py`) — currently aspirational, see roadmap
- `qmd` adapter (Shopify's on-device search) — see Karpathy's gist recommendation
- More collectors, especially non-Chinese chat ecosystems (Slack, Discord, Telegram)
- Dogfood reports — actually use it on your vault and file issues about friction

**Known env gotchas (contributor-hostile bugs we've hit):**
- Windows Git Bash may alias `cat` → `bat`. If `cat file > other_file` writes ANSI color codes into `other_file`, your config gets corrupted invisibly. Hex-dump suspicious files.
- Some shell profiles exit 1 on non-tty stdin, breaking `node script.mjs < input.json` style tests. Use the Python probe scripts as workaround.
- Windows WinGet reparse-point shims are 0-byte symlinks that bash can't exec. Use Scoop or direct installs for `node`, `python`, `gh`.

---

## Status

- **v1.0.0** shipped 2026-04-08 (headless-first MCP architecture, 64 tests green)
- **Current focus**: Track C — make the Compiler layer actually generate concept graphs and link suggestions (not just diagrams). See [roadmap](#roadmap).
- **Not production-ready for enterprises.** This is a personal-scale knowledge OS, designed for single-user vaults of ~100-10k markdown files.

## Roadmap

Public roadmap tracks live in `progress.txt`. Strategic direction documented at
`~/.claude/plans/breezy-stargazing-chipmunk.md` (local to maintainer).

- **Q2 2026**: link_discovery + concept_graph (Compiler made actual)
- **Q2-Q3 2026**: three collectors activated with cron (Gmail first)
- **Q3 2026**: qmd adapter (ally strategy — Shopify's `tobi/qmd` as optional search backend)

---

## License
GPL-3.0

Inspired by [Andrej Karpathy's LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) (April 2026).
