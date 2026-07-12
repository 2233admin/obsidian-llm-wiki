---
type: issue
entity: project/obsidian-llm-wiki/issue/spec-governance-openspec
state: in_progress
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/spec-governance-openspec
description: 对非平凡改动建立 OpenSpec 变更单，先于实现冻结需求边界
status: active
priority: 1
blocked-by: []
assignee: codex
last-verified: 2026-07-03
---
建立并执行 OpenSpec 变更前置门禁

## Acceptance
每次进入实现前创建 change 并通过 `openspec status`/`openspec validate --strict`。
`docs/DEVELOPMENT.md` 的 Spec workflow 约束在任务执行流程中被执行一次（例如在本 issue 完成前留痕）。

## Subtasks
创建变更单并确认文档/代码边界。
定义预期结果与不做边界。
将 `openspec validate --strict` 的输出输出到 issue 评论或证据文件。

## Output
`openspec` 变更单目录中的 change id 与验证通过记录可追溯。
