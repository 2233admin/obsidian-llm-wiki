---
type: issue
entity: project/obsidian-llm-wiki/issue/phase2-domain-ontology-bootstrap
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/phase2-domain-ontology-bootstrap
description: 建立 Domain Ontology 构建链路与内置 meta ontology，并补齐 ontology 校验
status: active
priority: 2
blocked-by:
  - project/obsidian-llm-wiki/issue/pass0-contract-layer
assignee: codex
last-verified: 2026-07-03
---
完成 Meta-Ontology 与 Domain Ontology 的最小可运行实现。

## Acceptance
`compiler/meta_ontology.py` 暴露关系、实体基类、信任等级、kind 白名单。
`compiler/ontology.py` 支持 load/validate/generate/get_allowed_relations 并在 validate 失败时返回错误清单。
生成并落盘 `KB/ontology.yaml` 的初版后通过 `tests/test_ontology.py`。

## Subtasks
完成 `compiler/meta_ontology.py` 常量定义（关系、实体基类、trust 级别、kind 集合）。
完成 `compiler/ontology.py` 的加载与校验流程，并覆盖实体关系约束。
补充 `tests/test_ontology.py` 的正/负向例。
在样例 vault 里生成初版 `KB/ontology.yaml` 并保留 `reviewed: false`。
