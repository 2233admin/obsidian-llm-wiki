---
type: issue
entity: project/obsidian-llm-wiki/issue/phase6-mcp-holon-ops
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/phase6-mcp-holon-ops
description: 新增 MCP 派生工具，支持 Holon 查询、因果查询与溯源链查询
status: active
priority: 2
blocked-by:
  - project/obsidian-llm-wiki/issue/phase4-context-core-packaging
assignee: codex
last-verified: 2026-07-03
---
补齐 MCP 运行时能力，与编译产物打通前端查询。

## Acceptance
新增工具（或补齐）支持 `vault.holon`、`graph.causes`、`graph.caused_by`、`graph.causal_chain`、`graph.contradict_check`、`fact.provenance`、`context.export`。
`mcp-server` 的 TS 测试覆盖工具参数、dry-run 与错误码行为。
`node mcp-server/bundle.js` 可返回至少一条 `vault.holon` 查询成功路径的 JSON-RPC 测试证据。
