# CLAUDE.md — LLM Wiki

## What This Is

Obsidian LLM Wiki is an Obsidian-first product. The Obsidian plugin is the
primary human-facing product and control plane. Shared TypeScript domains own
product semantics; the MCP server and CLI are agent and automation access
surfaces; Python compiler and adapter processes are optional capability workers.

核心命题: **让本地知识可被人和 Agent 可靠地使用。**

## Stack

- TypeScript + @modelcontextprotocol/sdk (stdio transport)
- Obsidian plugin + shared TypeScript domain packages
- Python compiler / `kb_meta.py` / optional adapter workers
- esbuild bundler

## Architecture

```
Obsidian user ─→ Obsidian Plugin ─┬─ Settings / Project / Knowledge / Memory
                                  ├─ onboarding + capability health
                                  └─ Shared TypeScript Domain

Agent ────────→ MCP Server ──────┘
Automation ────→ CLI ─────────────┘

Shared TypeScript capability boundary
  ├─ filesystem / Obsidian / external adapters
  ├─ Python compiler and kb_meta workers (optional)
  ├─ MemU / graph workers (optional)
  └─ durable vault Markdown + Work-OS truth
```

## Key Invariants

1. **Obsidian is the primary human product** — MCP and CLI do not own the user lifecycle
2. **Shared TypeScript domains own semantics** — transports format access; they do not redefine product truth
3. **Optional capabilities degrade explicitly** — missing Python or adapters produce health states and remediation, not opaque startup failure
4. **Markdown and Work-OS are durable truth** — boards, caches, and runtime output are derived or operational state
5. **Voice input passes intake normalization** — raw transcription never becomes implementation truth directly

## Repo Layout

- `mcp-server/src/` — MCP server + adapters
- `compiler/` — Python 编译管线 (kb_meta.py, compile.py, chunker, extractor)
- `skills/` — 8 vault skills (save/world/challenge/emerge/connect/graduate/ingest/bridge)
- `hooks/` — cron hooks (nightly/weekly/bg-agent)
- `connector.js` — llm-wiki MCP (轻量前端, vault.* CRUD)

## Branches

- `main` — LLM Wiki integrated product mainline (MCP, compiler, Obsidian control plane, Settings, Agent domain, and Fleet)
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

Default intake is BMAD-lite:

```text
raw voice → normalized intent → product brief → architecture / UX boundary
→ Work-OS issue → implementation plan → code → verification evidence
```

Normalize voice transcription against `CONTEXT.md`; ask one focused question
when an uncertain product or module name changes scope or architecture. Do not
turn raw voice directly into code or an implementation issue. Use
`docs/AGENT_WORKFLOW_INTEGRATION.md` for the artifact mapping and review gates.

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

## Agent skills

### Issue tracker

Executable work is tracked as local Markdown issues under
`01-Projects/<project>/issues/`; see `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default labels defined in `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. Read the root `CONTEXT.md` and relevant
ADRs under `docs/adr/`; see `docs/agents/domain.md`.
