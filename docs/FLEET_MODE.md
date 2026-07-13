# Fleet Mode PRD — LLM Wiki Multi-Agent Orchestration

> **Status**: Draft
> **Date**: 2026-07-01
> **Author**: agent/opus
> **Version**: 0.1.0

---

## 1. Problem Statement

### 1.1 Current Pain Points

| Problem | Symptom | Root Cause |
|---------|---------|------------|
| **Agent 自嗨** | Agent 跑着跑着不知道去哪了 | 没有边界、没有评审点 |
| **上下文耗尽** | 单 session 跑大量任务时上下文爆炸 | 单 agent 架构 |
| **碎片化输出** | 产出分散、不一致 | 缺乏协调层 |
| **过度工程** | 完整瀑布太重 | 评审点缺失 |
| **建模负担** | 瀑布+评审心智负担重 | 缺乏轻量模式 |

### 1.2 为什么需要舰队模式

```
X 上吹的              实际问题
─────────────────────────────────────────────
并行 Agent           →  没有编队，跑着跑着散架
LOOP 自驱            →  没有边界，跑着跑着越界
快速迭代             →  没有评审，质量失控
```

**舰队模式的核心价值：**
- 有编队，不散架
- 有边界，不越界
- 有评审点，不自嗨
- 轻量级，不累死

---

## 2. Design Principles

### 2.1 核心原则

| # | 原则 | 说明 |
|---|------|------|
| 1 | **单一职责** | 每个 Agent 只做一件事 |
| 2 | **显式边界** | 输入/输出/限制必须清晰 |
| 3 | **评审点控制** | 关键节点人工介入 |
| 4 | **上下文隔离** | 每个 Agent 独立上下文 |
| 5 | **状态可见** | 整个舰队状态可观测 |
| 6 | **可恢复** | 单点失败不影响全局 |

### 2.2 评审点设计

```
Sprint Start
    ↓
[Review Point 0] ← 你评审：Sprint 目标 + 范围
    ↓
Scout 执行
    ↓
[Review Point 1] ← 你评审：问题清单 + significance
    ↓
Worker 执行
    ↓
[Review Point 2] ← 你评审：产出 + 是否越界
    ↓
Verify 执行
    ↓
[Review Point 3] ← 你决定：上线 / 修改 / 放弃
    ↓
Sprint End
```

### 2.3 建模只需要这几样

```
1. 输入是什么    (明确数据源)
2. 输出是什么    (明确交付物)
3. 边界在哪     (明确不做)
4. 风险点在哪   (可能翻车的地方)
```

---

## 3. Fleet Architecture

### 3.1 舰队拓扑

```
┌─────────────────────────────────────────────────────────────────┐
│                     Fleet Commander (你)                         │
│                     评审点 + 最终决策                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    │
│  │ Scout   │───→│ Scout   │───→│ Worker  │───→│ Verify  │    │
│  │ 侦察舰   │    │ 报告舰   │    │ 作业舰   │    │ 验证舰   │    │
│  │         │    │         │    │         │    │         │    │
│  │ scan()  │    │report() │    │exec()   │    │check()  │    │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘    │
│       ↓              ↓              ↓              ↓             │
│   发现问题        生成报告        执行任务        自动化检查       │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                    Fleet Channel                                 │
│               (Compile → Query → Govern)                         │
│                    状态 + 消息                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 各舰职责

| 舰艇 | 核心职责 | 输出 | 失败处理 |
|------|---------|------|---------|
| **Scout** | 发现问题、评估 significance | 问题清单、优先级 | 报告异常 |
| **Worker** | 执行具体任务 | 产出、状态 | 回滚、报告 |
| **Verify** | 自动化检查 | 通过/拒绝 + 理由 | 报告问题 |

### 3.3 通信协议

```typescript
// Fleet Message
interface FleetMessage {
  type: "scout_report" | "worker_output" | "verify_result" | "review_request" | "command";
  from: "scout" | "worker" | "verify" | "commander";
  payload: unknown;
  timestamp: number;
  session_id: string;
}

// Review Point
interface ReviewPoint {
  id: string;
  after: "scout" | "worker" | "verify";
  requires: "approve" | "reject" | "modify";
  deadline?: number;
}
```

---

## 4. Scout Design

### 4.1 职责

```
Scout = 问题发现器 + 边界评估器 + significance 评分器
```

### 4.2 API

```typescript
interface Scout {
  // 发现 vault 中的问题
  scan(vault: string, scope: ScanScope): ScanResult;

  // 评估 significance
  assess(item: WorkItem): SignificanceScore;

  // 生成报告
  report(results: ScanResult[]): ScoutReport;
}

interface ScanScope {
  directories?: string[];    // 扫描范围
  types?: ("broken_link" | "orphan" | "stale" | "contradiction")[];
  depth?: number;
}

interface SignificanceScore {
  item: string;
  severity: "critical" | "high" | "medium" | "low";
  impact: string;
  effort: "high" | "medium" | "low";
}
```

### 4.3 复用现有实现

| 现有组件 | Scout 复用 |
|---------|-----------|
| `compile.py [diff]` | 发现变更 |
| `llmwiki_doctor.py` | broken_links, orphans |
| `knowledge_health.py` | stale, contradictions |
| `work_protocol.py` | blocked-by 分析 |

---

## 5. Worker Design

### 5.1 职责

```
Worker = 任务执行器 + 边界守护者 + 产出生成器
```

### 5.2 API

```typescript
interface Worker {
  // 执行任务
  execute(task: WorkTask, context: WorkerContext): WorkResult;

  // 边界检查
  checkBoundary(task: WorkTask, partial: PartialResult): BoundaryStatus;

  // 产出验证
  validate(output: WorkOutput): ValidationResult;
}

interface WorkTask {
  id: string;
  type: "compile" | "fix" | "create" | "review";
  input: {
    source: string[];    // 数据源
    spec: string;        // 任务规格
    constraints: string[];  // 限制条件
  };
  output: {
    path: string;
    format: string;
  };
}
```

### 5.3 复用现有实现

| 现有组件 | Worker 复用 |
|---------|-----------|
| `compile.py` | compile pipeline |
| `kb_meta.py` | work operations |
| `work_driver.py` | task selection |

---

## 6. Verify Design

### 6.1 职责

```
Verify = 自动化检查器 + 一致性验证器 + drift 检测器
```

### 6.2 API

```typescript
interface Verify {
  // 全面检查
  check(vault: string, output: WorkOutput): CheckResult;

  // 链接检查
  checkLinks(vault: string): LinkCheckResult;

  // 一致性验证
  checkConsistency(items: WorkItem[]): ConsistencyResult;

  // Drift 检测
  detectDrift(baseline: VaultState, current: VaultState): DriftReport;
}

interface CheckResult {
  status: "pass" | "fail" | "warning";
  issues: Issue[];
  summary: string;
}
```

### 6.3 复用现有实现

| 现有组件 | Verify 复用 |
|---------|-----------|
| `kb_meta.py [check-links]` | 链接检查 |
| `knowledge_health.py` | 健康检查 |
| `llmwiki_doctor.py` | doctor 检查 |

---

## 7. Multi-Agent Context Problem

### 7.1 问题定义

```
当前问题：
单 session 上下文有限
大量任务时上下文爆炸
Agent 能力无法充分发挥

目标：
自动分发到多个 Agent
保持上下文精简
状态同步
```

### 7.2 解决方案：Fleet Hub

```
┌─────────────────────────────────────────────────────────────────┐
│                      Fleet Hub                                   │
│                   (调度 + 状态 + 上下文管理)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Main Session                                                   │
│   ┌─────────┐                                                    │
│   │ Hub     │ ← 只在这里管理状态                                  │
│   │ (精简)   │                                                    │
│   └────┬────┘                                                    │
│        │ dispatch / collect                                      │
│   ┌────┴────┐                                                    │
│   │         │                                                    │
│ ┌─┴───┐ ┌──┴───┐ ┌───┴───┐                                     │
│ │Scout│ │Worker│ │Verify │                                      │
│ │ Sess│ │ Sess │ │ Sess  │  ← 每个独立 session                  │
│ │(精简)│ │(精简)│ │(精简) │     只处理分配的任务                    │
│ └─────┘ └──────┘ └───────┘                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 上下文精简策略

| 策略 | 说明 | 实现 |
|------|------|------|
| **任务裁剪** | 只注入当前任务相关的上下文 | `context.trim()` |
| **Briefing** | 每个子 session 从 Hub 获取 briefing | `render_briefing()` |
| **状态外置** | 状态存在文件/DB，不在上下文里 | `.vault-mind/` |
| **结果摘要** | 子 session 只返回结构化结果 | JSON schema |

### 7.4 Hub API

```typescript
interface FleetHub {
  // 初始化 fleet
  init(vault: string): FleetContext;

  // 分发任务
  dispatch(task: WorkTask, to: "scout" | "worker" | "verify"): DispatchResult;

  // 收集结果
  collect(sessionId: string): SessionResult;

  // 状态同步
  sync(): SyncResult;

  // 上下文报告
  contextReport(): ContextReport;
}

interface ContextReport {
  main: { used: number; limit: number };
  sessions: { id: string; used: number }[];
  recommendations: string[];
}
```

### 7.5 Task 11G 复用

现有的 `render_briefing()` 已经是上下文精简的实现：

```python
# work_driver.py
def render_briefing(notes, entity) -> str:
    """Render the bootstrap briefing for `entity` from the authoritative notes:
    the item + its state, its unresolved blockers, open siblings in its project,
    and the notes to read first. Markdown, read-only, deterministic."""
```

这个可以扩展为 Fleet Hub 的 briefing generator。

---

## 8. Implementation Roadmap

### 8.1 Phase 1: 接口定义 (1天)

- [ ] 定义 FleetMessage schema
- [ ] 定义 ReviewPoint schema
- [ ] 定义 Ship APIs
- [ ] 定义 Hub 接口

### 8.2 Phase 2: Scout 改造 (2天)

- [ ] 复用 compile.py [diff]
- [ ] 复用 llmwiki_doctor.py
- [ ] 实现 significance 评分
- [ ] 实现 scout_report

### 8.3 Phase 3: Worker 改造 (2天)

- [ ] 复用 compile.py pipeline
- [ ] 实现边界检查
- [ ] 实现产出验证
- [ ] 实现 work_output

### 8.4 Phase 4: Verify 改造 (1天)

- [ ] 复用 knowledge_health.py
- [ ] 实现 check 结果
- [ ] 实现 drift 检测

### 8.5 Phase 5: Fleet Hub (3天)

- [ ] 实现 dispatch/collect
- [ ] 实现上下文裁剪
- [ ] 实现 Briefing generator
- [ ] 实现状态同步

### 8.6 Phase 6: 评审点集成 (2天)

- [ ] 实现 ReviewPoint 拦截
- [ ] 实现人工介入 API
- [ ] 实现 approve/reject/modify

### 8.7 Phase 7: 测试 + 调优 (2天)

- [ ] 单元测试
- [ ] 集成测试
- [ ] 上下文大小调优

**Total: ~13 days**

---

## 9. File Structure

```
llmwiki/
├── fleet/
│   ├── __init__.py
│   ├── hub.py              # Fleet Hub
│   ├── scout.py             # Scout ship
│   ├── worker.py            # Worker ship
│   ├── verify.py            # Verify ship
│   ├── message.py           # Fleet message protocol
│   ├── review.py             # Review point logic
│   └── context.py            # Context management
├── compiler/
│   └── ... (复用)
├── docs/
│   └── FLEET_MODE.md         # 本文档
└── tests/
    └── fleet/
        ├── test_hub.py
        ├── test_scout.py
        ├── test_worker.py
        └── test_verify.py
```

---

## 10. Open Questions

| # | 问题 | 优先级 | 备注 |
|---|------|--------|------|
| 1 | 如何处理 Scout/Worker 的失败？ | P1 | 需要 fallback 策略 |
| 2 | 评审点如何集成到现有 workflow？ | P1 | 复用 WORK_LOOP.md |
| 3 | Hub 的状态存哪里？ | P2 | `.vault-mind/` 还是 DB |
| 4 | 如何处理跨 session 的依赖？ | P2 | Task 11F worktree handoff |
| 5 | 多 Agent 并行度？ | P3 | 需要限流 |

---

## 11. References

- `docs/WORK_LOOP.md` — 当前执行循环
- `docs/RESEARCH_COMPILER_LOOP.md` — 研究编译循环
- `compiler/work_driver.py` — Task 11A 实现
- `compiler/work_protocol.py` — 阻塞关系协议
- Task 11A–H — 待实现功能
