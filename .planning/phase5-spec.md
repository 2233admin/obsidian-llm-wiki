# Phase 5: Agent Scheduler -- Task Spec

## Goal
自治 agent 根据 vault 状态决定行动，白天响应 + 夜间主动。

## Context
- Repo: `D:/projects/vault-mind/`
- MCP server: `mcp-server/src/index.ts` (TypeScript, stdio transport)
- Compiler: `compiler/compile.py` (Python 3.11+)
- Phase 1-4 已完成，agent.* MCP methods 目前是 stub (见 index.ts `dispatchAgent`)

## Deliverables

### 1. `compiler/scheduler.py` -- 状态机
- States: IDLE -> EVALUATE -> ACTION -> REPORT -> IDLE
- While loop，每次 tick 评估 vault 状态
- 白天模式: file change -> 标记 dirty，不主动编译
- 夜间模式: 全量 evaluate + 执行所有待办
- 可通过 `--mode day|night|auto` 控制
- auto 模式按时间判断 (22:00-06:00 = night)

### 2. `compiler/evaluate.py` -- 决策逻辑
- 输入: vault 状态 (dirty count, days since emerge, orphan count, contradictions)
- 输出: 按优先级排序的 action 列表
- 优先级: dirty_compile > emerge_patterns > reconcile_contradictions > prune_orphans > challenge_stale
- 每个 action 有 type, target, reason, priority 字段
- 阈值从 vault-mind.yaml 读取，有 sensible defaults

### 3. MCP method 接通 (修改 `mcp-server/src/index.ts`)
- `agent.status()`: 返回 dirty_count, days_since_emerge, unresolved_contradictions, orphan_count, scheduler_state, mode
- `agent.trigger(action)`: 手动触发指定 action (compile/emerge/reconcile/prune/challenge)
- `agent.schedule(task, cron)`: stub (返回 not_implemented，Phase 6 才做)
- `agent.history(limit)`: 返回最近 N 次 action log (从 vault log.md 读取)

### 4. 接通方式
- index.ts 里的 `dispatchAgent` 替换为真实实现
- agent.trigger 调 evaluate.py + 对应 action 的 Python subprocess
- agent.status 调 evaluate.py --status

## Constraints
- Python 文件放 `compiler/` 目录
- Python: ruff lint, line-length=100
- TypeScript: strict mode, ESM
- 不加新 npm 依赖
- evaluate.py 零外部依赖（只用标准库 + 已有的 kb_meta.py）
- 日志追加到 vault 的 `log.md`

## Tests
- evaluate.py: 单元测试验证优先级排序逻辑
- scheduler.py: 至少测试 mode=day 不主动编译

## Definition of Done
- `tsc --noEmit` 零错误
- `ruff check compiler/` 全绿
- agent.status MCP method 返回真实数据
- agent.trigger compile 能触发 compile.py
