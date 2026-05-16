# vault-mind Design Spec

> Superseded pre-pivot design note. Do not use this document for current product positioning. Current positioning lives in `docs/RESEARCH_COMPILER_LOOP.md`: LLMwiki is a team research memory compiler, not a broad Knowledge OS platform.

> 给 vault 装一个大脑 -- 不是 second-brain skill 包，是 Knowledge OS。

**Date**: 2026-04-07
**Status**: Draft
**Repo**: `2233admin/obsidian-llm-wiki`
**前身**: `obsidian-vault-bridge` (Obsidian plugin + MCP connector + kb_meta.py + 8 skills + 4 hooks)

---

## 1. 问题

obsidian-second-brain 证明了 "vault + AI agent" 的市场。但它是 19 个 skill 文件 -- Claude 读文件、写文件、完事。

缺陷：
- **编译断层**: 知识存了但没结构化。raw notes 不等于 queryable knowledge
- **记忆孤岛**: vault/memU/GitNexus 各自为政，不互通
- **被动等召唤**: 除了死 cron，vault 不会自己行动
- **单 agent 锁定**: 只有 Claude Code 能用，Codex/Gemini/OpenClaw 接不进来
- **无 dreamtime**: 没有夜间自治循环，知识不会自我演化

## 2. 四层架构

```
+---------------------------------------------+
|  Layer 3: Vault Agent                       |
|  自治调度 -- idle -> compile -> emerge ->    |
|  prune -> challenge -> sleep                |
|  白天: 响应式  |  夜间: dreamtime 主动式     |
+---------------------------------------------+
|  Layer 2: Knowledge Compiler                |
|  raw -> chunk -> extract -> concept -> graph |
|  增量编译 + 矛盾检测 + 覆盖度追踪           |
+---------------------------------------------+
|  Layer 1: Unified Memory Layer              |
|  融合查询: vault + memU + GitNexus          |
|  adapter 体系: 全部可选，按需叠加            |
+---------------------------------------------+
|  Layer 0: MCP Interface                     |
|  标准 MCP methods                           |
|  Claude Code / Codex / Gemini / OpenClaw    |
+---------------------------------------------+
```

## 3. Layer 0: MCP Interface

**职责**: 让任何 MCP 客户端都能操作 vault-mind。

**传输**: stdio (标准 MCP transport)。connector.js 已有，迁入。

**Method Namespace**:

| Namespace | Methods | 来源 |
|-----------|---------|------|
| `vault.*` | read, create, modify, append, delete, rename, search, searchByTag, searchByFrontmatter, graph, backlinks, batch, lint, list, stat, exists | 现有 connector.js，已验证 |
| `compile.*` | status, run, diff, abort | 新增，编排编译 |
| `query.*` | unified, search, explain | 新增，统一查询 |
| `agent.*` | status, trigger, schedule, history | 新增，控制 agent |

**认证**: Bearer token (现有方案，crypto.randomBytes)。

**实现**: TypeScript, Node.js, `@modelcontextprotocol/sdk`。

### 从 obsidian-vault-bridge 迁入

- `connector.js` -> `mcp-server/src/index.ts` (重写为 TS，逻辑不变)
- WS proxy + filesystem fallback 双路径保留
- 198 个对抗性测试迁入，CI 复用

## 4. Layer 1: Unified Memory Layer

**职责**: 一个 query，搜所有知识源，融合排序返回。

### 4.1 Adapter 接口

```typescript
interface VaultMindAdapter {
  name: string
  capabilities: AdapterCapability[]
  
  // 核心 -- 只实现你能提供的
  search?(query: string, opts?: SearchOpts): Promise<SearchResult[]>
  read?(path: string): Promise<string>
  write?(path: string, content: string): Promise<void>
  graph?(): Promise<GraphData>
  
  // 事件 -- 可选
  onFileChange?(callback: (event: FileEvent) => void): Disposable
  
  // 生命周期
  init(): Promise<void>
  dispose(): Promise<void>
}

type AdapterCapability = 
  | "search" | "read" | "write" 
  | "graph" | "events" | "embeddings"
```

### 4.2 内置 Adapters

| Adapter | 依赖 | Capabilities | 备注 |
|---------|------|-------------|------|
| `adapter-filesystem` | 无 (默认) | search, read, write | ripgrep/glob 搜索，零依赖 |
| `adapter-obsidian` | Obsidian + vault-bridge 插件 | search, read, write, graph, events | WS 连接，实时事件推送 |
| `adapter-memu` | memU (PG + pgvector) | search, embeddings | HTTP API 或直连 PG |
| `adapter-gitnexus` | GitNexus MCP | search, graph | MCP 转发 |
| `adapter-dreamtime` | dreamtime | events | 双向事件桥接 |

### 4.3 Unified Query

```typescript
// query.unified("attention mechanism") 的内部流程:
async function unifiedQuery(query: string, opts?: QueryOpts): Promise<UnifiedResult[]> {
  // 1. 向所有有 search capability 的 adapter 并行发起搜索
  const results = await Promise.all(
    adapters
      .filter(a => a.capabilities.includes("search"))
      .map(a => a.search(query, opts))
  )
  
  // 2. 融合排序 (source-weighted)
  //    vault 结果 weight=1.0, memU weight=0.8, gitnexus weight=0.6
  //    权重可配置
  return mergeAndRank(results, opts?.weights)
}
```

**关键**: adapter 搜索失败不阻塞其他 adapter。没装的 adapter 不参与。结果标注来源。

### 4.4 配置

```yaml
# vault-mind.yaml (vault 根目录)
vault_path: "/path/to/your/vault"
adapters:
  filesystem:
    enabled: true  # 默认
  obsidian:
    enabled: true
    ws_url: "ws://127.0.0.1:27124"
    token: "${VAULT_MIND_OBSIDIAN_TOKEN}"
  memu:
    enabled: true
    pg_url: "postgresql://boris:***@localhost:5432/memu"
  gitnexus:
    enabled: false  # 用户没装就 false
  dreamtime:
    enabled: true
```

## 5. Layer 2: Knowledge Compiler

**职责**: 把 raw notes 编译成结构化知识图谱。

### 5.1 编译管线

```
raw/ (markdown, PDF, URL, audio transcript)
  |
  v
[1. Diff] -- kb_meta.py diff -- 只处理 new/changed
  |
  v
[2. Chunk] -- 按 heading/paragraph 切分，configurable size
  |
  v
[3. Extract] -- LLM extraction (concepts, relationships, claims)
  |           -- model tier 可配: haiku(便宜) / sonnet(平衡) / opus(精准)
  |           -- 输出 JSON: { summary, concepts[], relationships[], claims[] }
  |
  v
[4. Merge] -- 新 concept vs 现有 concept: 合并/更新/标注矛盾
  |
  v
[5. Write] -- wiki/summaries/*.md + wiki/concepts/*.md
  |
  v
[6. Index] -- kb_meta.py update-index + check-links
  |
  v
[7. Report] -- 编译报告: N sources, M concepts, K contradictions
```

### 5.2 自动触发

| 触发条件 | 行为 |
|---------|------|
| `vault.create` / `vault.modify` 写入 raw/ | 标记 dirty，加入编译队列 |
| 队列积累 >= 3 个 dirty 文件 | 触发批量编译 |
| 手动 `compile.run` | 立即编译所有 dirty |
| Dreamtime 夜间调度 | 全量 diff + 编译 |
| vault-ingest 完成 | 自动触发增量编译 |

### 5.3 矛盾检测

编译 Extract 阶段，LLM 返回 claims[]。每个 claim 和现有 concepts 比对:

```python
class Claim:
    content: str          # "attention is all you need"
    source: str           # raw/papers/transformer.md
    date: str             # 2026-04-07
    confidence: float     # 0.0-1.0

class Contradiction:
    claim_a: Claim
    claim_b: Claim  
    severity: str         # "direct" | "nuanced" | "temporal"
    resolution: str | None  # LLM 建议的解决方案
```

矛盾写入 `wiki/_contradictions.md`，vault-challenge 会引用。

### 5.4 从现有代码迁入

- `kb_meta.py` -> `compiler/kb_meta.py` (原封不动)
- vault-bridge skill 的 compile workflow -> `compiler/compile.py` (从 markdown 指令变成可调用 Python)
- compile-config.yaml 模板保留

## 6. Layer 3: Vault Agent

**职责**: 自治决策 -- 何时编译、何时 emerge、何时 prune。

### 6.1 调度状态机

```
        ┌─────────┐
  ──────>  IDLE    │
  │     └────┬────┘
  │          │ (trigger: file change / cron / dreamtime)
  │          v
  │     ┌─────────┐
  │     │ EVALUATE │ -- 检查 vault 状态，决定下一步
  │     └────┬────┘
  │          │
  │    ┌─────┼──────┬──────────┬──────────┐
  │    v     v      v          v          v
  │ COMPILE EMERGE CHALLENGE  PRUNE    RECONCILE
  │    │     │      │          │          │
  │    └─────┴──────┴──────────┴──────────┘
  │          │
  │          v
  │     ┌─────────┐
  │     │ REPORT  │ -- 写 log.md + 通知
  │     └────┬────┘
  │          │
  └──────────┘
```

### 6.2 Evaluate 决策逻辑

```python
def evaluate(vault_state: VaultState) -> Action:
    # 优先级从高到低
    
    # 1. 有 dirty 文件? -> 编译
    if vault_state.dirty_count > 0:
        return Action.COMPILE
    
    # 2. emerge 超过 N 天没跑? -> 浮现模式
    if vault_state.days_since_emerge > 14:
        return Action.EMERGE
    
    # 3. 有未解决的矛盾? -> 调和
    if vault_state.unresolved_contradictions > 0:
        return Action.RECONCILE
    
    # 4. 有孤儿/死链? -> 修剪
    if vault_state.orphan_count > 10:
        return Action.PRUNE
    
    # 5. 活跃项目有重大决策? -> 挑战
    if vault_state.recent_decisions:
        return Action.CHALLENGE
    
    # 6. 无事可做
    return Action.IDLE
```

阈值全部可配（vault-mind.yaml）。

### 6.3 白天 vs 夜间

| 时段 | 模式 | 行为 |
|------|------|------|
| 白天 (用户活跃) | 响应式 | file change -> 标记 dirty，不主动编译（不抢资源） |
| 夜间 (dreamtime) | 主动式 | 全量 evaluate -> 执行所有待办 action -> 写报告 |
| 用户手动触发 | 即时 | `agent.trigger("compile")` 立刻执行 |

### 6.4 外部系统交互 (dreamtime 等)

**原则**: vault-mind 不内置任何外部系统。它是 MCP server -- 谁来都接客。

dreamtime (或任何外部系统) 通过标准 MCP methods 与 vault-mind 交互:

```
# 知识喂料: dreamtime 调 vault-mind 查知识
dreamtime -> query.unified("recent concepts, last 7 days")
dreamtime -> vault.read("wiki/_contradictions.md")
dreamtime -> vault.read("wiki/_emerge_latest.md")

# 行为回流: dreamtime 调 vault-mind 写回结果
dreamtime -> vault.append("01-Projects/xxx.md", decision_content)
dreamtime -> vault.create("raw/dreamtime/2026-04-07-discovery.md", content)

# 触发编译: dreamtime 写完后触发
dreamtime -> compile.run({ scope: "incremental" })

# 查询 vault 状态: dreamtime 自己决定议程
dreamtime -> agent.status()  // 返回 dirty_count, days_since_emerge, etc.
```

vault-mind 不为任何特定消费者写专用代码。`agent.status()` 返回 vault 状态，
谁用这个状态做什么决策是调用者的事。

**adapter-dreamtime (如果有)**: 只做一件事 -- 事件订阅。
dreamtime 产出新文件时通知 vault-mind 有新 raw 要编译。
不做调度，不做决策，不做数据转换。

## 7. Skills (从现有迁入)

| Skill | 现有? | 改动 |
|-------|-------|------|
| vault-save | 有 | 加 adapter 查询替代纯文件搜索 |
| vault-world | 有 | L1 从 adapter 拉 memU/GitNexus 上下文 |
| vault-challenge | 有 | 引用 `_contradictions.md` + memU 历史 |
| vault-emerge | 有 | 结果写入 `wiki/_emerge_latest.md`，agent 可调度 |
| vault-connect | 有 | 用 compiled concept graph 找桥接，不只 grep |
| vault-graduate | 有 | 毕业时自动触发编译 |
| vault-ingest | 有 | 完成后自动 queue 编译 |
| vault-bridge | 有 | compile workflow 调用 compiler/ 而非内联 |
| vault-health | 新增 | 8 类审计 (P2 未做的) |
| vault-reconcile | 新增 | 矛盾调和 (P2 未做的) |

## 8. 分发策略

### 8.1 Monorepo 结构

```
vault-mind/
+-- mcp-server/          # TS, npm package: @vault-mind/mcp
|   +-- src/
|   |   +-- index.ts     # MCP stdio entry
|   |   +-- methods/     # vault.*, compile.*, query.*, agent.*
|   |   +-- adapters/    # adapter 接口 + filesystem 默认实现
|   |   +-- unified-query.ts
|   +-- package.json
|   +-- tsconfig.json
+-- compiler/            # Python, pip package: vault-mind-compiler
|   +-- kb_meta.py       # 现有，零依赖
|   +-- compile.py       # 编排 LLM extraction
|   +-- models.py        # Claim, Concept, Contradiction
|   +-- pyproject.toml
+-- agent/               # Python, 和 compiler 同包
|   +-- scheduler.py     # 状态机
|   +-- evaluate.py      # 决策逻辑
+-- adapters/            # 每个 adapter 独立包
|   +-- adapter-obsidian/    # npm: @vault-mind/adapter-obsidian
|   +-- adapter-memu/        # npm: @vault-mind/adapter-memu
|   +-- adapter-gitnexus/    # npm: @vault-mind/adapter-gitnexus
|   +-- adapter-dreamtime/   # 外部包，由 dreamtime 项目维护，不在此 repo
+-- skills/              # 纯 markdown, 平台无关
|   +-- vault-save.md
|   +-- vault-world.md
|   +-- vault-challenge.md
|   +-- vault-emerge.md
|   +-- vault-connect.md
|   +-- vault-graduate.md
|   +-- vault-ingest.md
|   +-- vault-bridge.md
|   +-- vault-health.md
|   +-- vault-reconcile.md
+-- hooks/               # bash scripts
|   +-- vault-bg-agent.sh
|   +-- vault-morning.sh
|   +-- vault-nightly.sh
|   +-- vault-weekly.sh
+-- setup.sh             # 一键安装
+-- vault-mind.yaml.example
+-- README.md
```

### 8.2 安装体验

```bash
# 最小安装 (任何人)
git clone https://github.com/2233admin/vault-mind ~/.vault-mind
cd ~/.vault-mind && bash setup.sh /path/to/your/vault

# setup.sh 做什么:
# 1. 检测环境 (Node.js, Python, Claude Code / OpenClaw)
# 2. npm install mcp-server deps
# 3. pip install compiler deps (minimal)
# 4. 生成 vault-mind.yaml (交互式: 你有 Obsidian? memU? GitNexus?)
# 5. 注册 MCP server 到 Claude Code / OpenClaw settings
# 6. 安装 skills 到 ~/.claude/skills/vault-mind/
# 7. 可选: 注册 cron hooks
# 8. 跑 vault-mind init -- 生成 _CLAUDE.md + index.md + log.md (如果没有)
```

### 8.3 多平台支持

| 平台 | 安装方式 | 可用能力 |
|------|---------|---------|
| Claude Code | setup.sh 注册 MCP + 安装 skills | 全部 |
| OpenClaw | setup.sh 检测 OpenClaw，注册到 dashboard | 全部 (通过 MCP) |
| Codex CLI | MCP server 手动配置 | Layer 0-2 (无 skills，有 MCP methods) |
| Gemini CLI | MCP server 手动配置 | Layer 0-2 |
| 其他 MCP client | 指向 `mcp-server/` entry | Layer 0-2 |

## 9. 实现优先级

| Phase | 内容 | 依赖 | 工作量估计 |
|-------|------|------|-----------|
| P0 | Monorepo scaffold + 迁入现有代码 | 无 | 小 |
| P1 | MCP server TS 重写 (从 connector.js) | P0 | 中 |
| P2 | Adapter 接口 + filesystem adapter | P1 | 小 |
| P3 | compile.py 自动编排 | P0 | 中 |
| P4 | Unified query (vault-only 先跑通) | P2 | 小 |
| P5 | adapter-memu | P2 | 小 |
| P6 | adapter-obsidian (迁入 WS proxy) | P2 | 小 |
| P7 | Agent scheduler + evaluate | P3+P4 | 中 |
| P8 | adapter-dreamtime + 双向桥接 | P7 | 中 |
| P9 | setup.sh 一键安装 | P1-P6 | 中 |
| P10 | Skills 迁入 + 适配 unified query | P4 | 小 |
| P11 | adapter-gitnexus | P2 | 小 |
| P12 | vault-health + vault-reconcile 新 skill | P3 | 小 |

**MVP = P0-P4**: monorepo + MCP + filesystem adapter + compiler + unified query。
这就已经超越 obsidian-second-brain 了 -- 他没有编译器，没有 MCP，没有统一查询。

## 10. 护城河分析

| 维度 | obsidian-second-brain | vault-mind |
|------|----------------------|------------|
| 别人能抄 skills? | 能 | 能 -- 但 skills 只是表层 |
| 别人能抄编译器? | 他没有 | 难 -- kb_meta.py + compile.py + 矛盾检测是核心 IP |
| 别人装了 memU? | 不影响他 | 我们的 adapter 让 memU 融入知识循环，单装 memU 做不到 |
| 别人有 dreamtime? | 不影响他 | 我们的双向桥接是独有的 |
| 最终护城河 | 你的 notes | 你的 notes + compiled knowledge graph + 演化历史 |

## 11. 三问自省

1. **精确性**: 架构图和接口定义是设计产物，未经实现验证。工作量标注为"小/中"而非具体天数，因为依赖并行度和 LLM 辅助程度。
2. **框架适配**: 如果不用 MCP 而用 REST API，结论不变 -- MCP 是当前 agent 生态标准，但 adapter 模式使传输层可替换。如果 MCP 生态衰退，换传输层不影响上层。
3. **可行性**: P0-P4 (MVP) 的 60% 代码已存在于 obsidian-vault-bridge。主要新增工作是 TS 重写 MCP server + compile.py 编排。约束: compiler 用户侧 LLM 成本 (可配 haiku 降本)。
