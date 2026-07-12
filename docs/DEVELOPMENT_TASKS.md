---
id: docs/development-tasks
description: Context Core development task board generated from DEVELOPMENT.md
kind: spec
status: active
keywords: [context-core, development, tasks]
---

# obsidian-llm-wiki 任务拆解与推进看板（基于当前进度）

更新时间：2026-07-03  
来源：`docs/DEVELOPMENT.md` 全量条目逐项转化

## 0. 前置治理（必须先做）

1. **建立非平凡变更前置门禁**
   - 文件：`.github`, `ops`, `issue` 工作流
   - 动作：每次进入实现前先执行 `openspec new/status/validate --strict`
   - 验收：每个实现 issue 有 `change-id` 与 `validate --strict` 输出留痕
   - 任务来源：`spec-governance-openspec`（优先级 1，已验证）
   - 依赖：无
   - 证据：`openspec status --change adopt-openspec-workflow`，`openspec validate adopt-openspec-workflow --strict`

2. **质量闸口规则上墙**
   - 动作：将文档约定固化为可运行规则（ID、frozen/decision、tag、trust）
   - 验收：`quality-gates-and-conventions` 的验收项都有用例可追测
   - 任务来源：`quality-gates-and-conventions`（优先级 3，todo）
   - 依赖：无

---

## 1. Pass 0 合约层（`pass0-contract-layer`）

状态：`implemented`，OpenSpec 前置已验证

### 1.1 `id` 与 frontmatter 合规

1. [x] `compiler/rhizome/contract.py`
   - 实现 `id` 必填规则：`domain/slug`、小写 kebab、最少两段
   - 校验 `status/supersedes/kind/entity_type/links` 等必填与类型
   - 验收：非法 `id` 和缺字段返回 ERROR，合法 frontmatter 通过

2. [x] `compiler/rhizome/sources.py`
   - 恢复 INDEX.md 域自发现链路
   - `KB/` 中 `INDEX.md` 能被编译器正确索引并生成稳定 note-source 列表

### 1.2 Error/WARN 分离与变更保护

3. [x] `compiler/rhizome/check.py`
   - 错误与告警分类：ERROR 阻断、WARN 提示
   - ERROR 包含：frontmatter 缺失、id 规则、frozen/decision 非法变更
   - WARN 包含：`links` 引用不存在、`entity_type` 不在 ontology 约束等
   - 验收：`tests/test_contract.py` 中独立覆盖 ERROR/WARN 两类场景

4. [x] `tests/test_contract.py`
   - 覆盖：
     - 缺字段
     - `id` 格式错误（大写、空格、无斜杠）
     - decision/frozen 守约（不可修改）
     - `links` 不存在 / `entity_type` 无效
   - 验收：上述场景返回期望错误集

5. [x] 提交前门禁
   - `.lefthook.yml` + pre-commit 接入 Pass0
   - 验收：Pass0 任一 ERROR 时提交失败

---

## 2. Domain Ontology（`phase2-domain-ontology-bootstrap`）

状态：`implemented`

### 2.1 Meta-Ontology 常量

6. [x] `compiler/meta_ontology.py`
   - 定义关系类型：`causal / epistemic / temporal`
   - 定义实体基类型：`Concept, Event, Decision, Claim, Evidence`
   - 定义 trust 常量：`human > assisted > extracted > inferred`
   - 定义 frontmatter `kind` 白名单
   - 验收：可被引用且不再散落在多处重复定义

### 2.2 Domain Ontology 生命周期

7. [x] `compiler/ontology.py`
   - 实现 `load(vault_path)` 与 `validate(ontology)`，返回错误列表
   - 实现 `generate(vault_path)`（LLM 初版生成）
   - 实现 `get_allowed_relations(from_type, to_type)`，用于 extractor 约束
   - 验收：非法关系组合触发约束错误

8. [x] `KB/ontology.yaml` 与 `tests/test_ontology.py`
   - 根据现有 Notes 生成初版 `KB/ontology.yaml`（`reviewed: false`）
   - 生成后需可被 `validate` 通过
   - 人工审核后改为 `reviewed: true` 时编译器不应覆盖
   - 验收：`tests/test_ontology.py` 覆盖 load/validate/get_allowed_relations

---

## 3. Instance Data 抽取链（`phase3-holon-extraction-causal`）

状态：`implemented`

### 3.1 前端数据与 holon schema

9. [x] `compiler/extractor.py`
   - 扩展输出 schema，附加 `entity_type` 与 `facts[]`
   - `relation` 必须受 meta-ontology 限定（只允许预定义 relations）
   - 每条 fact 带 `trust_level` 与 `evidence`、`source_note`、`paragraph_index`
   - 验收：`tests/test_extractor.py` 中 relation 白名单 + 实体约束生效

### 3.2 因果图与矛盾检测

10. [x] `compiler/concept_graph.py`
   - 合并结构图与因果层
   - 实现 causes/prevents 矛盾检测并生成 `_contradictions.md`
   - 计算 edge confidence（含 wikilink 先验）
   - 验收：新增冲突关系能输出完整矛盾报告
 
11. [x] `tests/test_concept_graph.py`
   - 覆盖矛盾对检测、最短路径、置信度传播/截断

---

## 4. Context Core 打包（`phase4-context-core-packaging`）

状态：`implemented`

### 4.1 打包产物

12. [x] `compiler/context_core.py`
   - 落地 `manifest.json`
   - 落地 `ontology.json`
   - 落地 `holons/*.json`
   - 落地 `causal-graph.json`
   - 落地 `provenance.json`
   - 维护 `context-core` 可加载的目录和版本元数据

13. [x] `tests/test_context_core.py`
   - 验证版本号（`YYYYMMDD-HHMM`）与 tag 规则一致
   - 验证 stats/字段完整性与哈希指纹可复现
   - 验证 dry-run 与正式打包行为一致

---

## 5. Work-OS 任务追踪浅接入（`phase5-work-os-task-tracking`）

状态：`implemented`

14. [x] `compiler/docket/task.py`（或等效入口）
   - 支持 `knowledge-task` 模型解析与读写
   - 支持 `create / update / close` 生命周期
   - 与现有 `blocked-by` 约束打通
   - 验收：issue 触发动作映射稳定、状态可追溯

15. [x] `compiler/docket/gitops.py`
   - 维持原子提交语义（单文件单 commit）
   - `vault-graduate` 后自动关闭对应 task 并提交
   - 验收：`tests/test_task.py` 覆盖 create/update/close 与自动提交链路

16. [x] `tests/test_task.py`
   - 覆盖 `knowledge-task` 全链路，含状态机切换与阻塞关系

---

## 6. MCP 工具落地（`phase6-mcp-holon-ops`）

状态：`implemented`

17. [x] `mcp-server/src/operations/holon.ts`
   - 实现 `vault.holon(id)`
   - 输出 holon 事实、关系、溯源链

18. [x] `mcp-server/src/operations/causal.ts`
   - 实现：
     - `graph.causes(concept, depth=2)`
     - `graph.caused_by(concept, depth=2)`
     - `graph.causal_chain(from, to?, max_depth=5, min_confidence=0.3)`
   - 停止条件：`depth` 与 `cumulative_confidence` 双约束

19. [x] `mcp-server/src/operations/provenance.ts`
   - 实现 `graph.contradict_check(topic)`
   - 实现 `fact.provenance(claim_id)`
   - 实现 `context.export(domain?)`
   - 验收：工具返回结构稳定，可脱敏打印

20. [x] MCP 集成验证
   - JSON-RPC dry-run：`initialize`、`vault.holon`、`graph.*`、`context.export`
   - 验收：`mcp-server/bundle.js` 可在非交互下返回有效响应
   - 测试目标：`tests` + 人工验证脚本可重放

---

## 7. 全链路测试矩阵（`integration-test-matrix`）

状态：`partially implemented`，核心 Phase1-4/6 gate 已建立；完整矩阵仍需持续维护

21. [x] 单元测试补齐（Phase1-4/6 核心）
   - `tests/test_contract.py`
   - `tests/test_ontology.py`
   - `tests/test_extractor.py`
   - `tests/test_concept_graph.py`
   - `tests/test_context_core.py`
   - `tests/test_task.py`

22. [ ] 平台/系统测试
   - `tests/fleet/test_fleet.py`
   - `tests/fleet/test_protocol_space.py`（如适用）
   - MCP JSON-RPC 套件与离线回放脚本

---

## 8. 架构决策与策略落地（`adr-validation-and-integration-flow`）

状态：`partially implemented`

23. [ ] ADR-01~ADR-10 一一复核
   - 主要消费者 / 编译时机 / 质量闸 / 增量策略 / 版本指纹 / 存量迁移 / CTM 融合 / 停止条件 / 图距离 / 质量门异步性 / context-core 分支策略
   - 把实现进度逐项回填到 `docs/DEVELOPMENT.md`

24. [x] 实现 ADR 决策中的关键算法
   - `max_depth=5`, `cumulative_confidence>=0.3`
   - path confidence 乘法累积停机
   - 边权融合：`0.7 * llm_conf + 0.3 * wikilink_cooccur`
   - `dist==0/1 ->1.0`, `dist==2 ->0.5`, others `0`
   - 直接更新 `concept_graph.py` 与测试

25. [ ] 发布机制
   - 建立 `context-core` 发布脚本（orphan branch）
   - `git worktree add .cc-build context-core`
   - 输出 `context-core-vYYYYMMDD-HHMM` 与打包提交

---

## 当前推进建议（今天先做）

1. 补 `adr-validation-and-integration-flow`：把已落地的 CTM/Context Core/MCP 状态回填 ADR。
2. 实施 ADR-03 增量失效：过期标记 + 版本号降级。
3. 实施 ADR-10 发布机制：`context-core` orphan branch/worktree/tag 脚本或等效自动化。
4. 做 server 级 JSON-RPC smoke；当前已完成 direct operation smoke。

## 与现有工单的映射

- `spec-governance-openspec` -> 0、2
- `pass0-contract-layer` -> 1.x
- `phase2-domain-ontology-bootstrap` -> 2.x
- `phase3-holon-extraction-causal` -> 3.x
- `phase4-context-core-packaging` -> 4.x
- `phase5-work-os-task-tracking` -> 5.x
- `phase6-mcp-holon-ops` -> 6.x
- `integration-test-matrix` -> 7.x
- `adr-validation-and-integration-flow` -> 8.x
