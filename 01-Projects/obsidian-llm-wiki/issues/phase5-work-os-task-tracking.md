---
type: issue
entity: project/obsidian-llm-wiki/issue/phase5-work-os-task-tracking
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/phase5-work-os-task-tracking
description: 将浅集成工作项模型接入并完善 issue 生命周期及自动提交
status: active
priority: 3
blocked-by:
  - project/obsidian-llm-wiki/issue/phase4-context-core-packaging
assignee: codex
last-verified: 2026-07-03
---
把 KnowledgeTask 接入 vault 的任务跟踪路径，形成编译/复查/毕业的一体流程。

## Acceptance
`compiler/task.py`（或相应替换入口）支持 `knowledge-task` 模型与状态更新。
`compiler/gitops.py` 支持任务完成时原子提交策略并可回归测试。
`tests/test_task.py` 覆盖 create/update/close 状态与依赖阻塞语义。
