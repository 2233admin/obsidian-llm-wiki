---
type: issue
entity: project/obsidian-llm-wiki/issue/adr-validation-and-integration-flow
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/adr-validation-and-integration-flow
status: active
priority: 4
blocked-by:
  - project/obsidian-llm-wiki/issue/quality-gates-and-conventions
assignee: codex
last-verified: 2026-07-03
---
逐条复核 DEVELOPMENT.md 中 ADR 与编译策略是否已落地，并补齐缺失执行项。

## Acceptance
完成 max_depth / cumulative_confidence / path confidence 停止条件的实现与测试。
完成 wikilink 共现先验权重融合公式在检索与关系打分中的接入。
完成 context-core 分支 `orphan` 发布流或等效替代方案并留存文档/脚本。
更新 docs/DEVELOPMENT.md 中 ADR 记录与实装状态一致。
