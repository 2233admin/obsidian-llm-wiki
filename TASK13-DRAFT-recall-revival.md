# TASK 13（草案）— Recall 复活：让 NL 召回真能用（PG-FTS floor + ingest 接线）

> 状态：**DRAFT，待审**。来源 = 2026-06-28 live 实测 vault-mind 记忆系统暴露的真缺口（非纸面）。
> 一句话：语义/混合召回栈**全建好了**（pglite+pgvector / BGE-M3 / chunk / hybrid / RRF / ingest 方法）但**管线断** —— ① `ingest()` 从没接进 compile ② Ollama 没起 ③ filesystem floor 只字面 ripgrep。结果：NL 问句 0 evidence，只原词命中能查。本任务接上管线，让 NL 召回开箱可用（keyword 不依赖 Ollama；vector 在 Ollama 起时自动叠加）。

## 0. 实测根因（query_trace + 读码钉死）

1. vaultbrain `isAvailable:true` 但查 **count:0 @ 4ms** = pglite 索引**空**：`VaultBrainAdapter.ingest()` 注释 `Called by compile-trigger in Phase 3 (not wired up yet)` → 从没被调。
2. **Ollama DOWN**（`localhost:11434` 积极拒绝）→ 向量嵌入根本跑不了（embedding-client 打 Ollama bge-m3）。
3. filesystem `--fixed-strings` 整句字面 + score 恒 1.0 无排序 → NL 整句必 0；vaultbrain keyword = `pg_trgm`（三连词相似），NL 多词弱。
4. `answerQuery` 只调 keyword `unifiedQuery`（`mode` 硬编码 `"keyword"`）；`unifiedQueryByVector` 写好了却没被调。

## 1. §0（沿用 vault-mind 全局 §0）

- markdown 唯一真值；**召回索引 = 派生**（pglite db 在 `~/.vault-mind/vaultbrain/`，gitignore、可重建、不回改源）。
- **无新 daemon**：pglite = 进程内 WASM（库非服务）；**Ollama 是可选 adapter**（失败优雅降级，filesystem 字面永远兜底）。**keyword floor 不依赖任何 daemon**。
- **轮子复用**：Postgres FTS（`tsvector` / `ts_rank_cd`）on 已装 `@electric-sql/pglite` —— 零新 dep、纯 WASM、无原生编译。**否决 better-sqlite3/FTS5**（node-gyp 原生编译 dead-end 风险 + 与 pglite 全文/向量能力重叠造两套）。

## 2. 建造顺序（PR slices, TDD）

- **13A** PG-FTS keyword floor：pglite engine 加 `tsvector` 列 + GIN 索引 + `ts_rank_cd` 查询（替/并 `pg_trgm`）；`ingest()` **embed 失败也存 chunk + tsvector**（Ollama down 时 keyword 仍活）。绿条 1/2。
- **13B** 接 ingest→compile：server 把 `CompileTrigger.onCompileSuccess(wikiPaths)`（钩子已存、只是没连）接到 `vaultbrain.ingest`。绿条 3。
- **13C** 回填：一次性 reindex 整库进 pglite（过去 compile 从没 ingest）。幂等。绿条 4。
- **13D** 顶层混合（可选增强）：`answerQuery` 在 vaultbrain 有向量时也并 `unifiedQueryByVector`、RRF 合并（vaultbrain 内部已 hybrid，故 13D 非阻塞）。绿条 5。
- **后续（接 caura-memclaw fold）**：currency 权重进排序（STALE 降权，接 §3 缺口）+ reranker/Phase-B + `recall-outcome` 反馈（T11 11I）。

## 3. 绿条（可测断言）

1. **PG-FTS**：index 3 篇 md（含多词 NL 内容）→ NL 短语查 → `ts_rank_cd` 排序命中（非 0）；空库 → `[]`；同输入同序（确定性）。
2. **ingest 韧性**：embed 抛错（模拟 Ollama down）→ chunk + tsvector 仍入库、keyword 查得到；Ollama 在 → 向量也入、hybrid 生效。
3. **compile 接线**：compile 成功后，改动的 wiki 文件出现在 pglite，重查命中（onCompileSuccess→ingest）。
4. **回填**：reindex 后整库可 NL 查；再跑一次结果一致（幂等、不重复 chunk）。
5. **§0**：索引在 gitignored 机器层、可重建、不改源；无 daemon（pglite 进程内）；filesystem 字面仍兜底。
6. **回归闸**：mcp-server `npm run build` + `npm test`（`node --test`）全绿；Python currency 闸不受影响（无 Python 改动，仍按 cadence 跑一遍）。

## 4. 关联

[[vault-mind-currency-v1]] · live 实测（2026-06-28）· `adapters/vaultbrain/*`（pglite engine / ingest / schema）· `compile-trigger.ts`（`onCompileSuccess` 钩子）· `unified-query.ts`（`unifiedQueryByVector` 待接）· caura-memclaw fold（T11 11I `recall-outcome` / 排序接 currency）· package.json `description`「no embeddings required」（语义 = 可选增强，keyword floor 兜底）。

---

## 5. DX 评审（/plan-devex-review，EXPANSION 模式，2026-06-28）

> 产品类型：MCP SDK / CLI / API for AI agents。模式：DX EXPANSION（把 DX 当竞争优势）。TTHW 目标：**Champion < 2min**。

### 5.1 目标开发者 Persona

```
TARGET DEVELOPER PERSONA
Who:       AI 智能体集成者（人）—— 把 vault-mind MCP 接进 Claude Code / 自己 agent 的开发者（常即用户本人）
Context:   想给 agent 加 markdown-真值记忆，不想跑向量库；被 "no embeddings required + headless" 吸引
Tolerance: 装完 ~5 分钟内 recall 必须出东西，否则判定"坏了"并弃用
Expects:   接上 context_recall → 用自然语言问自己 vault → 秒回带 citation 的答案，零 embedding 基建
```

### 5.2 Developer Perspective（共情叙事，已与用户校准为"准确"）

集成者读到 "Knowledge OS for AI agents — headless MCP, plain markdown, no embeddings required"，`npm run dev` 指向自己 vault，94 工具冒出，接 `context_recall` 问 "current project status and blockers" → `0 evidence`。试 "kanban" → 命中。**字面词能查，整句问就 0**。`gaps[]` 报 "literal ripgrep / vaultbrain optional vector" —— 有语义 adapter 却返空。README 没一字说要 `vault reindex` 填库、向量还要 Ollama+bge-m3。"No embeddings required" 被读成"免设置就能召回"，实则"除非自己搭 embedding，否则只有关键词"。20 分钟以为它坏了，差点提 bug、差点弃用。

### 5.3 竞品 DX 基准（WebSearch，2026）

| 工具 | 语义召回 TTHW | 设置 | 文档化 |
|---|---|---|---|
| Mem0 cloud / local | ~5min / ~20min | pip+key / Ollama+Qdrant | ✓ |
| Zep / Letta | ~2-5min | Docker + 150+ 迁移 | ✓ |
| Obsidian 语义 MCP（Nooscope/copilot） | ~5-10min | Ollama+reindex | ✓（文档化第一步） |
| **vault-mind 现状** | keyword ~2min / **NL ≈ ∞** | 未文档化的 reindex+Ollama | **✗** |
| **vault-mind 目标** | **NL keyword < 2min** | 13A floor + 自动入索引，**零 daemon** | 待写 |

**差异化**：同类全都要 Ollama+reindex 才有语义召回；vault-mind 的 **PG-FTS floor（13A）能让 NL 关键词召回零 daemon、零 embedding setup 就活** —— 这是竞品做不到的护城河。语义（向量）作文档化的可选 Ollama 升级。

### 5.4 Magical Moment

集成者首次用自然语言问自己 vault、秒回带 citation 答案、**零 embedding setup**。
投递载体 = **复制粘贴 demo 命令**：`recall "我关于 X 决定了啥"` 在真 vault 上直接出带 citation 的 NL 答案（前提：自动入索引已就绪，免手动 reindex）。

### 5.5 Developer Journey Map（修复后）

| 阶段 | 摩擦 | 状态 |
|---|---|---|
| Discover | "no embeddings required" 误导 | F1 改措辞 |
| Install | 无单命令 bootstrap | F1 写 quickstart |
| Hello World | 首问 NL → 0，没说先 reindex | F2 自动入索引 + demo 命令 |
| Real Usage | keyword-only 直到 Ollama+reindex（未文档化） | F2 + 文档语义升级 |
| Debug | gaps[] 报"限制"不报"修法" | F3 gaps→可执行 |
| Upgrade | （本范围 n/a） | OK |

### 5.6 三个修复（用户已批 F1+F2+F3 全修）

- **F1（文档）** — 改 `package.json`/README 的 "no embeddings required" 措辞为 **"keyword recall works out of the box; semantic recall is an optional Ollama upgrade"**；新增 recall getting-started（含 5.4 demo 命令 + 语义升级页：装 Ollama + `ollama pull bge-m3` + 设 `VAULT_MIND_EMBED_URL`）。
- **F2（自动入索引，含 13A）** — keyword floor 零设置就活：①**13A PG-FTS**（`ts_rank_cd` ⊕ `pg_trgm` RRF，已建，待回归）让 NL 多词排序；②**编译时自动入索引**已接（`index.ts` onCompileSuccess→`vaultbrain.ingest`），但存量库空 → 首连接/首查时**惰性触发一次 `vault reindex`** 或在 quickstart 显式一行；③`ingest` 在 embed 失败时仍存 chunk+tsvector（Ollama 可选）。
- **F3（可执行错误）** — `context_recall`/`answerQuery` 在 `0 evidence` 且 vaultbrain 库空时，`gaps[]` 追加可执行项：`"semantic index empty — run 'vault reindex' to populate"`；向量分支因 Ollama 不可达失败时：`"vector search unavailable — start Ollama and 'ollama pull bge-m3' for semantic recall (keyword recall still works)"`。把"限制"升级成"下一步命令"。

### 5.7 DX Scorecard

```
Dimension          | Before | After | 主修
Getting Started    |  3/10  | 9/10  | F1+F2（零设置 NL keyword + 诚实文档）
API/CLI/SDK        |  6/10  | 8/10  | 加 recall demo 命令；context_recall 本身 OK
Error Messages     |  4/10  | 9/10  | F3（gaps→可执行命令）
Documentation      |  3/10  | 8/10  | F1（recall getting-started + 语义升级页）
Upgrade Path       |   —    |  —    | n/a 本范围
Dev Environment    |  5/10  | 8/10  | pglite 进程内零 daemon；Ollama 可选 + 可探测
Community          |   —    |  —    | 本范围外
DX Measurement     |  2/10  | 6/10  | 可选：TTHW-到-首次成功-recall 埋点
-------------------|--------|-------|
TTHW (NL recall)   |   ∞    | <2min | keyword 零设置；语义 ~5-10min 文档化可选
Overall DX         |  3/10  | 8/10  |
```

### 5.8 NOT in scope（显式缓做）
- 交互 playground/sandbox（与本地 vault 定位不合）。
- 自动装/起 Ollama（保持 §0 无 daemon；只文档化 + 可探测提示）。
- reranker/Phase-B、currency-into-ranking、recall-outcome 反馈（属 caura-memclaw fold / T11 11I，另排）。

### 5.9 What already exists（复用，别重造）
- `vault.reindex`（`core/operations.ts:596`，全库回填，dryRun+并发）—— F2 直接复用，只需 quickstart 引用 + 惰性触发。
- `onCompileSuccess→ingest` 接线（`index.ts:1788-1816`）—— 已在，非"待接"（vaultbrain 注释 "not wired up yet" 是过时的）。
- `embedding-client.ts`（OpenAI 兼容，默认 Ollama bge-m3）+ `unifiedQueryByVector` —— 语义升级即用，无需新造。
- citation/`gaps[]`/`query_trace` —— F3 在其上加可执行项，不重写。

### 5.10 Implementation Tasks（本评审综合，派生自具体发现）
- [ ] **T1 (P1)** — vaultbrain/engine — 13A PG-FTS floor（已建 `schema.ts`+`pglite-engine.ts`+测试，**待全量回归绿 + commit**）。Verify：`pglite-engine.test.js` 3/3 + 全套 `node --test`。
- [ ] **T2 (P1)** — onboarding — F2 惰性/显式回填：quickstart 一行 `vault reindex` 或首查惰性触发；`ingest` embed 失败仍存 chunk+tsvector。Files：`core/operations.ts`、`adapters/vaultbrain/index.ts`。
- [ ] **T3 (P1)** — docs — F1 改 `package.json` description + README recall getting-started + 语义升级页。Files：`package.json`、`README.md`、`mcp-server/README.md`。
- [ ] **T4 (P2)** — query — F3 `answerQuery`/`context_recall` 的 `gaps[]` 加可执行命令（库空→reindex；Ollama 不可达→pull bge-m3）。Files：`unified-query.ts`、`adapters/vaultbrain/index.ts`。
- [ ] **T5 (P2)** — cli — recall demo 命令（magical moment 载体）：`kb_meta recall "..."` / `vault recall` 出 citation 的 NL 答案。
- [ ] **T6 (P3)** — measurement — TTHW-到-首次成功-recall 埋点（DX EXPANSION，可选）。

> 注：gstack JSONL artifact（`~/.gstack/projects/.../tasks-*.jsonl`）未写 —— 本机 PowerShell/bash + 多仓父目录下 gstack-slug 不可靠，且 vault-mind 非 gstack-tracked 项目。Implementation Tasks 以上表为准。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | DONE | DX 3/10→8/10；TTHW ∞→<2min（NL keyword 零设置）；3 fixes F1+F2+F3 批准 |

- **UNRESOLVED:** 无（persona/mode/tier/magical/journey-fixes 全经 AUQ 决定）。
- **VERDICT:** DX Review DONE（EXPANSION）。Eng Review 未跑（非阻塞本评审）；建造 F1/F2/F3 前可选 `/plan-eng-review` 验架构。13A（T1）待全量回归绿 + commit。
