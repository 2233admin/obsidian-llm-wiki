---
type: issue
entity: project/obsidian-llm-wiki/issue/integration-test-matrix
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/integration-test-matrix
description: 补齐单元测试与 MCP/CLI 集成验证闭环，确保每层可独立回归
status: active
priority: 2
blocked-by:
  - project/obsidian-llm-wiki/issue/pass0-contract-layer
assignee: codex
last-verified: 2026-07-03
---
补齐并联动测试体系，覆盖 compiler、work-os、MCP 三层。

## Acceptance
保留 `tests/test_contract.py`、`tests/test_extractor.py`、`tests/test_ontology.py`、`tests/test_context_core.py` 的覆盖。
补齐/修正 `tests/test_tasks.py`、`tests/fleet/test_fleet.py` 在上下文核心流程下可通过。
增加 MCP 工具路径 JSON-RPC 冒烟脚本，覆盖主要新工具返回结构。
给 `tests` 增加最小绿色门槛定义：每次改动需通过至少 `pytest tests/` + `npm run build`（或等效替代）。 
