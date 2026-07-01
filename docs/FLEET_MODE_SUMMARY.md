# llmwiki 舰队模式 — 一页纸

> 解决 Agent 自嗨 + 上下文爆炸问题

---

## 核心问题

| 问题 | 症状 |
|------|------|
| Agent 自嗨 | 跑着跑着不知道去哪了 |
| 上下文爆炸 | 单 session 跑大量任务时上下文耗尽 |

---

## 舰队模式

```
┌─────────────────────────────────────────────┐
│         Fleet Commander (你)                 │
│         评审点 + 最终决策                     │
├─────────────────────────────────────────────┤
│                                             │
│   Scout ──→ Worker ──→ Verify               │
│   侦察舰    作业舰    验证舰                  │
│                                             │
│   每个舰独立 session                         │
│   上下文精简（只处理分配的任务）               │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 各舰职责

| 舰 | 做什么 | 输出 |
|----|--------|------|
| **Scout** | 发现问题、评估 significance | 问题清单 |
| **Worker** | 执行具体任务 | 产出 |
| **Verify** | 自动化检查 | 通过/拒绝 |

---

## 评审点

```
Sprint Start
    ↓
[你] 评审：目标 + 范围
    ↓
Scout → 问题清单
    ↓
[你] 评审：significance
    ↓
Worker → 产出
    ↓
[你] 评审：越界检查
    ↓
Verify → 检查结果
    ↓
[你] 决定：上线/修改/放弃
    ↓
Sprint End
```

---

## 上下文解决方案

| 策略 | 说明 |
|------|------|
| **任务裁剪** | 只注入当前任务相关的上下文 |
| **Briefing** | 每个子 session 从 Hub 获取 briefing |
| **状态外置** | 状态存在 `.vault-mind/`，不在上下文里 |
| **结果摘要** | 子 session 只返回结构化结果 |

---

## 复用现有实现

| 现有 | 舰队中 |
|------|--------|
| `compile.py [diff]` | Scout |
| `llmwiki_doctor.py` | Verify |
| `compile.py [chunk→write]` | Worker |
| `work_driver.py` | Hub |
| `Task 11G briefing` | 上下文裁剪 |

---

## 评审点设计原则

建模只需要这几样：

```
1. 输入是什么    (数据源)
2. 输出是什么    (交付物)
3. 边界在哪     (不做)
4. 风险点在哪   (可能翻车)
```

---

## 文件

- PRD: `docs/FLEET_MODE.md`
- 实现: `fleet/`
  - `hub.py` — Fleet Hub
  - `scout.py` — Scout ship
  - `worker.py` — Worker ship
  - `verify.py` — Verify ship
  - `message.py` — 通信协议
  - `review.py` — 评审点
  - `context.py` — 上下文管理

---

## 评审点问题 (待定)

| # | 问题 |
|---|------|
| 1 | 评审点如何集成到现有 workflow？ |
| 2 | Hub 的状态存哪里？ |
| 3 | 如何处理跨 session 的依赖？ |
