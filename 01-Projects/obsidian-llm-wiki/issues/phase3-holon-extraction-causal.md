---
type: issue
entity: project/obsidian-llm-wiki/issue/phase3-holon-extraction-causal
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/phase3-holon-extraction-causal
description: 扩展 extractor 与 concept_graph，产出因果 holon 与矛盾检测
status: active
priority: 2
blocked-by:
  - project/obsidian-llm-wiki/issue/phase2-domain-ontology-bootstrap
assignee: codex
last-verified: 2026-07-03
---
把现有关系抽取升级为因果结构化 Holon 事实，并做冲突检测。

## Acceptance
`compiler/extractor.py` 输出 `entity_type` 与 `facts[]`，relation 被限定在 meta ontology。
`compiler/concept_graph.py` 输出 causal graph 与 `_contradictions.md`，并支持矛盾边检测 causes/prevents。
`tests/test_extractor.py` 与 `tests/test_concept_graph.py` 覆盖负向约束与矛盾检测。
