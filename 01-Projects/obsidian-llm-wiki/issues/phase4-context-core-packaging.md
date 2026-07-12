---
type: issue
entity: project/obsidian-llm-wiki/issue/phase4-context-core-packaging
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/phase4-context-core-packaging
description: 落地 context-core 打包与 manifest/provenance，形成可持久发布产物
status: active
priority: 2
blocked-by:
  - project/obsidian-llm-wiki/issue/phase3-holon-extraction-causal
assignee: codex
last-verified: 2026-07-03
---
完成 Pass 2~4 的打包阶段，产出 context-core 可加载数据。

## Acceptance
`compiler/context_core.py` 能写出 `manifest.json`、`ontology.json`、`holons/`、`causal-graph.json` 与 `provenance.json`。
`tests/test_context_core.py` 覆盖 manifest 字段完整性、版本号、签名/哈希、统计信息。
`compile` 可在上下文核心模式下输出并通过 dry-run 与非干预验收。
