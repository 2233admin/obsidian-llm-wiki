# CLAUDE.md — LLM Wiki

## What This Is

LLM Wiki for AI agents. 四层架构:
1. **MCP Server** (TypeScript, stdio) — 统一接口
2. **Adapter Registry** — filesystem(default) / obsidian(WS) / memU(pgvector) / gitnexus(graph)
3. **KB Compiler** (Python, zero-dep) — raw/ → wiki/ 单向编译
4. **Agent Scheduler** — compile/emerge/reconcile/prune/challenge 自动调度

核心命题: **知识不编译就是垃圾。**

## Stack

- TypeScript + @modelcontextprotocol/sdk (stdio transport)
- Python 3.11+ (kb_meta.py / compile.py, zero-dep)
- ripgrep subprocess (filesystem adapter search)
- esbuild bundler

## Architecture

```
Claude Code ─stdio→ MCP Server ─┬─ vault.* (CRUD + search + graph)
                                 ├─ compile.* (status/run/diff/abort)
                                 ├─ query.* (unified/search/explain)
                                 └─ agent.* (status/trigger/schedule)
                                      │
                          AdapterRegistry
                          ├─ filesystem (default, always on)
                          ├─ obsidian (WS → vault-bridge)
                          ├─ memU (subprocess → pgvector)
                          └─ gitnexus (subprocess → graph)
```

## Key Invariants

1. **Filesystem fallback is global invariant** — Obsidian 不开也能用
2. **编译是单向的** — raw/ → compile.py → wiki/，不反向污染源
3. **adapter 失败不阻塞** — Promise.allSettled 隔离，静默降级
4. **dryRun=true 默认** — 所有写操作

## Repo Layout

- `mcp-server/src/` — MCP server + adapters
- `compiler/` — Python 编译管线 (kb_meta.py, compile.py, chunker, extractor)
- `skills/` — 8 vault skills (save/world/challenge/emerge/connect/graduate/ingest/bridge)
- `hooks/` — cron hooks (nightly/weekly/bg-agent)
- `connector.js` — llm-wiki MCP (轻量前端, vault.* CRUD)

## Branches

- `main` — vault-mind headless MCP (v1.0.0 shipped 2026-04-08)
- `legacy-v0.1.0-obsidian-plugin` — 归档

## Known Issues

- connector.js 和 MCP server 有 15 个 vault.* tool 完全重叠 — 待去重
- main/master 分支策略未定 (master = obsidian-vault-bridge 在同仓库)

## Run

```bash
# MCP server (TypeScript)
cd mcp-server && npm run dev

# KB 编译 (Python)
python compiler/compile.py <path-to-vault>/KB/<topic> --tier haiku

# kb_meta CLI
python compiler/kb_meta.py diff <path-to-vault> KB/<topic>
```

## Test

```bash
cd mcp-server && npm test    # adapter tests
cd compiler && python -m pytest tests/
```

## Agent Workflow Integration

Before Claude Code adapts an external repository, toolchain, skill pack, or workflow runtime into obsidian-llm-wiki, read `docs/AGENT_WORKFLOW_INTEGRATION.md`.

Key constraints:

- register durable external inputs through `source.register` only when Phase 1 supports the Source Input (`url` or `vaultPath`);
- keep local clone paths, repo paths, file paths, directory paths, and pasted text out of `source.register` until those input types are implemented;
- write unreviewed analysis under `00-Inbox/AI-Output/<agent>/` or `10-Projects/<project>/agents/<agent>/`;
- track executable obsidian-llm-wiki work under `01-Projects/<project>/issues/`, never `10-Projects/<project>/docket/**`;
- promote durable team truth only through reviewed Decisions, Architecture, Runbooks, or Project Hub links.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
