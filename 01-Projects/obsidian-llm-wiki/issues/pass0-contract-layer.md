---
type: issue
entity: project/obsidian-llm-wiki/issue/pass0-contract-layer
state: in-progress
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/pass0-contract-layer
description: 实施 PASS0 合约校验与预提交门禁，覆盖 frontmatter 与 frozen/decision 规则
status: active
priority: 1
blocked-by:
  - project/obsidian-llm-wiki/issue/spec-governance-openspec
assignee: codex
last-verified: 2026-07-03
---
实现 Pass 0 验证链路并接入提交前门禁。

## Acceptance
`compiler/rhizome/contract.py` 和 `compiler/rhizome/check.py` 能识别 id 规则、frontmatter 缺失、links 不存在和 decision/frozen 不变更。
`tests/test_contract.py` 新增/完善覆盖上述规则并通过。
pre-commit 钩子触发 Pass 0 时有错误阻断提交。

## Subtasks
完成 `compiler/rhizome/contract.py` 的 id/field 约束映射（id、status、kind、supersedes、entity_type）。
完成 `compiler/rhizome/check.py` 错误与告警分离策略：ERROR 阻断、WARN 告知。
完成 `compiler/rhizome/sources.py` 与 INDEX.md 自发现路径回归，支持知识源索引。
建立 `.lefthook.yml`/pre-commit 组合执行 Pass 0。

## Notes
依赖: `spec-governance-openspec`。
