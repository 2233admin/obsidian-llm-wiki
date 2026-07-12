# obsidian-llm-wiki — Context Core 开发文档

## Spec workflow

For non-trivial repository changes, use the repo-local OpenSpec workflow before implementation:

```bash
openspec new change <change-id>
openspec status --change <change-id>
openspec validate <change-id> --strict
```

See [OpenSpec Workflow](OPENSPEC_WORKFLOW.md). OpenSpec tracks change intent and requirements only; it does not replace GSD, work-OS issue notes, vault memory, or release CI.

## 目标

把 obsidian-llm-wiki 从「文件夹+搜索」升级为**可版本化的上下文基础设施**。

Agent 不再每次重建上下文——知识以 Holon（结构化单元）+因果图+溯源链的形式预编译，
作为 Context Core 部署给 MCP server 使用。

参考来源：
- [TrustGraph](https://github.com/trustgraph-ai/TrustGraph) — Context Core 概念、Quad 溯源、因果图
- [rhizome](https://github.com/the-orrery/rhizome) — frontmatter 合约、域自发现（自研）
- [docket](https://github.com/the-orrery/docket) — 原子 git 提交、vault 任务追踪（自研）

---

## 架构概览

```
obsidian-knowledge/          ← Markdown 笔记（人类写）
    KB/
      ontology.yaml          ← Domain Ontology（人工审核，LLM 首次生成）
      context-core/          ← 编译产物（机器用）
        manifest.json
        ontology.json
        holons/
        causal-graph.json
        provenance.json
      tasks/                 ← Vault 维护任务（docket 模式）
        TASK-001.md
    ↓ compile
MCP server (vault-mind)      ← 服务层，Agent 唯一入口
```

### 三个知识层

```
Layer 1: Meta-Ontology   ← 框架内置，所有项目通用（relation types、entity base types）
Layer 2: Domain Ontology ← 每个 vault 自定义（KB/ontology.yaml）
Layer 3: Instance Data   ← 编译器生成（KB/context-core/holons/）
```

### 目录结构（compiler/）

```
compiler/
  rhizome/             ← 从 rhizome 移植，适配 id 字段
    contract.py        ← frontmatter schema + 验证器
    sources.py         ← INDEX.md 域自发现
    check.py           ← 验证引擎（Pass 0）
  docket/              ← 从 docket 移植，适配 vault 场景
    task.py            ← KnowledgeTask 模型（issue.py 改）
    gitops.py          ← 原子 git 提交（直接复用）
    states.py          ← 状态枚举（直接复用）
  meta_ontology.py     ← 新增：内置常量（关系类型、实体基础类型、信任层级）
  ontology.py          ← 新增：Domain Ontology 加载 + LLM 生成
  context_core.py      ← 新增：打包 + git tag
  extractor.py         ← 现有，扩展因果 schema
  concept_graph.py     ← 现有，加 causal layer
  compile.py           ← 现有，串联所有 Pass
```

---

## Layer 1：Meta-Ontology（内置常量）

```python
# compiler/meta_ontology.py

RELATION_TYPES = {
    "causal":    ["causes", "enables", "requires", "prevents"],
    "epistemic": ["supports", "contradicts", "refines", "implies"],
    "temporal":  ["precedes", "triggers"],
}

ENTITY_BASE_TYPES = ["Concept", "Event", "Decision", "Claim", "Evidence"]

TRUST_LEVELS = {
    "human":     1.0,   # 手写笔记
    "assisted":  0.8,   # AI 辅助整理
    "extracted": 0.6,   # LLM 从笔记中抽取
    "inferred":  0.4,   # 图遍历推导
}

FRONTMATTER_KINDS = [
    "note", "research", "decision",
    "runbook", "reference", "spec", "index",
    "knowledge-task", "ontology",
]
```

---

## Layer 2：Domain Ontology（KB/ontology.yaml）

### 格式规范

```yaml
# KB/ontology.yaml
domain: personal-knowledge
version: "1.0"
generated_by: llm          # llm | human（人工审核后改为 human）
reviewed: false

entity_types:
  MacroFactor:
    parent: Concept
    description: "宏观经济因子"
    properties:
      - timeframe        # short/medium/long-term
      - region           # US/CN/GLOBAL
      - data_source

  TradingStrategy:
    parent: Decision
    description: "交易策略"
    properties:
      - asset_class
      - timeframe
      - risk_level

  EngineeringDecision:
    parent: Decision
    description: "工程决策（ADR）"
    properties:
      - system
      - reversibility    # reversible | irreversible

  ResearchFinding:
    parent: Claim
    description: "研究发现"
    properties:
      - study_type       # primary | meta-analysis | opinion
      - confidence_interval

relation_constraints:
  - from: MacroFactor
    to: [MacroFactor, TradingStrategy]
    allowed: [causes, enables, prevents, precedes]

  - from: ResearchFinding
    to: [Claim, TradingStrategy]
    allowed: [supports, contradicts, refines]

  - from: EngineeringDecision
    to: [EngineeringDecision, Concept]
    allowed: [requires, enables, prevents, refines]
```

### ontology.py 接口

```python
# compiler/ontology.py

class DomainOntology:
    def load(self, vault_path: Path) -> dict          # 读 KB/ontology.yaml
    def generate(self, vault_path: Path) -> dict      # LLM 自动生成初版
    def validate(self, ontology: dict) -> list[str]   # 检查合法性
    def get_allowed_relations(self, from_type: str, to_type: str) -> list[str]
```

**自动生成流程（Option C）：**
1. 扫描 vault 所有 `.md` 的 `keywords` + `kind`
2. 提示 LLM 生成 Domain Ontology
3. 写入 `KB/ontology.yaml`，`reviewed: false`
4. 人工审核后改 `reviewed: true` → 编译器不再覆盖

---

## Layer 3：Instance Data

### Frontmatter 合约（rhizome/contract.py 适配）

每个 `.md` 文件的 frontmatter：

```yaml
---
# 必填
id: trading/macro-2026           # domain/slug，小写 kebab
description: "2026 宏观周期研究" # 一句话摘要
keywords: [利率, 债券, 美联储]
kind: research

# 可选
links: [trading/duration-strategy]
status: active                   # active | frozen | archived
supersedes: []                   # kind: decision 替代了哪些旧笔记
entity_type: MacroFactor         # 对应 Domain Ontology（编译器填写）
---
```

**不变性规则：**
- `kind: decision` → 提交后自动冻结，不可修改，新增时用 `supersedes`
- `status: frozen` → 任何修改触发 pre-commit ERROR

### Holon Schema（KB/context-core/holons/）

```json
{
  "id": "trading/macro-2026",
  "type": "MacroFactor",
  "domain": "personal-knowledge",
  "title": "2026 宏观周期研究",
  "summary": "分析美联储加息周期对债券市场的影响",
  "keywords": ["利率", "债券", "美联储"],
  "parts": ["macro/fed-policy", "macro/inflation"],

  "facts": [
    {
      "claim": "利率上升导致债券价格下跌",
      "relation": "causes",
      "target": "macro/bond-prices",
      "target_type": "MacroFactor",
      "confidence": 0.92,
      "trust_level": "human",
      "evidence": "第三段：「历史数据显示...」",
      "source_note": "04-Research/macro-2026.md",
      "paragraph_index": 2,
      "extracted_by": "human",
      "timestamp": "2026-05-12"
    }
  ],

  "relations": [
    {
      "predicate": "causes",
      "target": "macro/bond-prices",
      "confidence": 0.92,
      "trust_level": "human"
    },
    {
      "predicate": "enables",
      "target": "strategy/duration-short",
      "confidence": 0.80,
      "trust_level": "extracted"
    }
  ],

  "embedding_ref": "embeddings/trading-macro-2026.vec",

  "provenance": {
    "source_note": "04-Research/macro-2026.md",
    "git_sha": "abc123",
    "compiled_at": "2026-06-20T14:30:00+08:00",
    "compiler_version": "0.4.0"
  }
}
```

### Context Core manifest.json

```json
{
  "version": "20260620-1430",
  "domain": "personal-knowledge",
  "vault_path": "D:/knowledge",
  "compiled_at": "2026-06-20T14:30:00+08:00",
  "stats": {
    "total_notes": 312,
    "total_holons": 289,
    "total_relations": 1847,
    "causal_edges": 423,
    "contradiction_count": 7
  },
  "adapters": ["filesystem", "vaultbrain"],
  "git_sha": "abc123def456"
}
```

---

## Compile Pipeline

```
Pass 0  [rhizome/check.py]     frontmatter 合约验证
        ERROR: 缺字段、id 格式错、frozen 笔记被修改
        WARN:  links 引用不存在、entity_type 不在 ontology

Pass 1  [现有]                 wikilink 图 + frontmatter 解析

Pass 2  [ontology.py]          加载/生成 Domain Ontology
        [extractor.py]         LLM 抽取 Holon + 因果边
        输入：chunk + domain ontology
        输出：holons/*.json

Pass 3  [concept_graph.py]     合并结构图 + causal layer
        矛盾检测：同一 target 同时有 causes + prevents
        输出：causal-graph.json + 更新 _contradictions.md

Pass 4  [context_core.py]      打包 Context Core
        写 manifest.json
        git tag context-core-v{YYYYMMDD-HHMM}

pre-commit hook:
        运行 Pass 0，有 ERROR 则拒绝提交
```

### extractor.py 扩展 schema

```python
# 现有输出
{"relationships": [{"from": "A", "to": "B", "type": "related"}]}

# 扩展后输出
{
  "entity_type": "MacroFactor",
  "facts": [
    {
      "claim": "...",
      "relation": "causes",              # 严格来自 meta-ontology
      "target_id": "macro/bond-prices",
      "target_type": "MacroFactor",
      "confidence": 0.88,
      "evidence": "原文片段",
      "trust_level": "extracted"
    }
  ]
}
```

---

## KnowledgeTask（docket 模式，浅集成）

仅用于 vault 维护任务。

```yaml
# KB/tasks/TASK-001.md
---
id: TASK-001
title: "摘要《Attention Is All You Need》"
status: "Todo"
state_type: unstarted
task_type: ingest            # ingest | graduate | reconcile | compile | review
source_note: 10-External/attention-is-all-you-need.md
target_note: 04-Research/attention-mechanism.md
blocked_by: []
created: 2026-06-20
updated: 2026-06-20
---
```

**触发时机：**
- `vault-ingest` skill 运行 → 自动创建 TASK
- `vault-graduate` 完成 → 自动关闭 TASK + gitops.auto_commit

---

## 新增 MCP 工具

```
vault.holon(id)                    → 完整 Holon（事实+关系+溯源）
graph.causes(concept, depth=2)     → 该概念导致什么（BFS）
graph.caused_by(concept, depth=2)  → 什么导致了该概念（反向）
graph.causal_chain(from, to)       → A→B 完整路径 + 每步置信度
graph.contradict_check(topic)      → 该主题下所有矛盾 claims
fact.provenance(claim_id)          → 溯源链（笔记→段落→提取方式）
context.export(domain?)            → 导出 Context Core JSON
```

---

## 测试策略（边做边测）

每个模块独立可测，不依赖完整 pipeline。

### Pass 0（rhizome/contract.py）

```python
# tests/test_contract.py

def test_valid_frontmatter():
    fm = {"id": "trading/macro-2026", "description": "...",
          "keywords": ["利率"], "kind": "research"}
    assert validate(fm) == []

def test_missing_id():
    fm = {"description": "...", "keywords": [], "kind": "note"}
    errors = validate(fm)
    assert any("id" in e for e in errors)

def test_invalid_id_format():
    # 大写、空格、不含斜杠都应报错
    for bad_id in ["Macro 2026", "macro", "TRADING/Macro"]:
        assert validate({"id": bad_id, ...}) != []

def test_decision_frozen_guard():
    # kind: decision 已存在的文件被修改 → WARN supersedes
    ...
```

### Pass 2（extractor.py）

```python
# tests/test_extractor.py

def test_causal_extraction():
    chunk = "利率上升历史上总是导致债券价格下跌..."
    ontology = load_test_ontology()
    result = extract(chunk, ontology)
    assert result["entity_type"] == "MacroFactor"
    assert any(f["relation"] == "causes" for f in result["facts"])
    # 所有 relation 必须在 meta-ontology 里
    all_relations = [f["relation"] for f in result["facts"]]
    valid = [r for v in RELATION_TYPES.values() for r in v]
    assert all(r in valid for r in all_relations)

def test_ontology_constraint_blocks_invalid_relation():
    # ResearchFinding 不能有 causes 边
    ...
```

### MCP 集成测试

```bash
# 启动后发 JSON-RPC
VAULT_MIND_VAULT_PATH=D:/knowledge \
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"vault.holon","arguments":{"id":"trading/macro-2026"}}}' \
  | node mcp-server/bundle.js
```

---

## 实施顺序

```
Phase 1  合约层（Pass 0）
  compiler/rhizome/contract.py     移植 + 适配 id 字段
  compiler/rhizome/check.py        移植验证引擎
  compiler/rhizome/sources.py      INDEX.md 域自发现
  tests/test_contract.py
  .lefthook.yml / pre-commit hook

Phase 2  Domain Ontology
  compiler/meta_ontology.py        内置常量
  compiler/ontology.py             加载 + LLM 生成
  tests/test_ontology.py
  KB/ontology.yaml                 vault 里生成初版

Phase 3  Holon 抽取（Pass 2-3）
  extractor.py                     扩展因果 schema
  concept_graph.py                 加 causal layer + 矛盾检测
  tests/test_extractor.py

Phase 4  Context Core 打包（Pass 4）
  compiler/context_core.py
  tests/test_context_core.py

Phase 5  Vault 任务追踪
  compiler/docket/task.py          KnowledgeTask 模型
  compiler/docket/gitops.py        直接复用
  tests/test_task.py

Phase 6  MCP 新工具
  mcp-server/src/operations/causal.ts
  mcp-server/src/operations/holon.ts
  mcp-server/src/operations/provenance.ts
```

---

## 开发环境

```bash
# Python（compiler/）
uv venv && uv pip install -e ".[dev]"
uv run pytest tests/ -v

# TypeScript（mcp-server/）
cd mcp-server && npm install && npm run build

# 快速测试 MCP server
VAULT_MIND_VAULT_PATH=D:/knowledge \
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' \
  | node mcp-server/bundle.js
```

---

## 关键约定

| 约定 | 规则 |
|------|------|
| id 字段格式 | `domain/slug`，小写 kebab，必填 |
| kind: decision | 冻结，只能 supersedes，不能修改 |
| git commit 粒度 | 一次变更一个文件一个 commit（docket/gitops.py） |
| Domain Ontology | LLM 生成初版，人工 review 后设 `reviewed: true` 锁定 |
| Context Core 版本 | 每次 compile 后 `git tag context-core-vYYYYMMDD-HHMM` |
| trust_level 优先级 | human(1.0) > assisted(0.8) > extracted(0.6) > inferred(0.4) |
| 自动化原则 | 自动化是一等公民，不是事后补丁。人不会主动维护，系统必须自维护 |

---

## 架构决策记录（ADR）

> 通过 grilling 逐一确认，不可随意变更。变更须走 supersedes 流程。

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| 1 | 主要消费者 | Claude Code 会话（A） | 最痛点；B/C 是自然延伸 |
| 2 | 编译时机 | 预编译，MCP 启动时加载（B） | 312篇×LLM call 不能每次跑 |
| 3 | 增量失效 | 过期标记 + 版本号降级（C） | 雪崩重编不可接受 |
| 4 | 版本指纹 | 内容哈希 SHA256（C） | 无 git 依赖，数据越多越稳定 |
| 5 | 存量迁移 | 路径自动派生 id，WARN 不 ERROR（B） | 立刻可用，渐进迁移 |
| 6 | CTM 融合 | 自适应深度(A) + wikilink 共现先验(B) | A 降延迟，B 提升边权质量 |
| 7 | 停止条件 | max_depth=5 且 cumulative_confidence≥0.3（C） | 双保险：安全网+质量门 |
| 8 | 共现计算 | wikilink 图距离（直接=1.0，二跳=0.5）（C） | 主动标注的语义信号优于统计共现 |
| 9 | 编译触发 | Pass 0 pre-commit 同步；Pass 1-4 post-commit 异步（C） | 质量门不能异步；LLM 抽取不能阻塞 commit |
| 10 | Context Core 存储 | vault repo 的 orphan branch `context-core`（C） | main 零污染 + 完整版本历史 |

### CTM 集成细节

参考：[Continuous Thought Machine](https://arxiv.org/abs/2505.05522)（Llion Jones et al., Sakana AI）

**A. 自适应查询深度**（`graph.causal_chain` 实现）

```python
def causal_chain(from_id, to_id, max_depth=5, min_confidence=0.3):
    # BFS，累积置信度 = 沿路径各跳 confidence 相乘
    # 任一条件触发停止：depth > max_depth 或 cumulative < min_confidence
    cumulative = 1.0
    for hop in path:
        cumulative *= hop.confidence
        if cumulative < min_confidence:
            return path_so_far, status="low_confidence_halt"
    return full_path, status="complete"
```

**B. wikilink 共现先验**（边权融合）

```python
def edge_confidence(llm_conf, source_id, target_id, wikilink_graph):
    dist = wikilink_distance(source_id, target_id, wikilink_graph)
    cooccur = {0: 1.0, 1: 1.0, 2: 0.5}.get(dist, 0.0)
    return 0.7 * llm_conf + 0.3 * cooccur
```

### git 分支结构

```
main              ← 笔记（Markdown）
context-core      ← 编译产物（orphan branch，无共同历史）
  KB/context-core/
    manifest.json
    holons/
    causal-graph.json

# 编译后操作
git worktree add .cc-build context-core
cp -r compiler_output/* .cc-build/
git -C .cc-build add . && git -C .cc-build commit -m "compile: vYYYYMMDD-HHMM"
git -C .cc-build tag context-core-vYYYYMMDD-HHMM
git worktree remove .cc-build
```
