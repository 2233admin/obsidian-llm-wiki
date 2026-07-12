---
type: issue
entity: project/obsidian-llm-wiki/issue/quality-gates-and-conventions
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/quality-gates-and-conventions
description: 落地关键约定与质量闸口，确保 context-core 结果可回放和可追责
status: active
priority: 3
blocked-by: []
assignee: codex
last-verified: 2026-07-03
---
把开发约定从文档转为可运行检查点。

## Acceptance
ID 规范 (`domain/slug` 小写 kebab) 被 `contract` 与 `test_contract` 强制。
`decision` 与 `frozen` 不可被非 supersedes 路径修改。
Context-core 版本打tag 命名约束 `context-core-vYYYYMMDD-HHMM` 与 compile 步骤串联。
信任等级常量与排序规则统一来源且有回归测试。
