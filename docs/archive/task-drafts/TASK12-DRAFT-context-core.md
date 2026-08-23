# TASK 12（草案）— Context Core:知识作为可版本化的便携工件

> 状态:**DRAFT,待审**。来源蒸馏自 **TrustGraph**(trustgraph-ai/trustgraph,"holonic context graph",2026-06-28 抓取)。**取概念丢运行时**:取「Context Core = 知识的可部署/可版本/可 pin 单元」,丢其 Cassandra/Pulsar/S3-Garage/多模 DB/3D explorer/K8s/cloud 运行时。
> 一句话:把 vault-mind 散落的零件(entities/关系/currency/ontology/provenance)**编译成一个 git-原生、可版本化、可注入的「Context Core」工件** —— **write context once(markdown 真值),run agents anywhere(编译出的 core 随处跑)**。这把 11G briefing 从"per-item 切片"升级成"可 pin/promote 的便携知识单元"。

## 0. 北极星 + 为什么顺

TrustGraph 的杀手概念不是图数据库,是 **Context Core**:把 agent 推理一个域所需的一切打包成**单一便携工件**,与 agent 怎么部署解耦 —— build once、pin 版本、rollback、跨环境 promote。"知识终于被当成基础设施"。

vault-mind **已有全部原料**(entity 图、currency 防漂移、ontology、provenance、11G 注入),只差**把它们当一等工件打包+版本化**。而 vault-mind 的版本/pin/rollback/promote **天生就是 git** —— 所以这个内化对我们几乎零运行时成本,纯属"把已有真值编译成一个声明式 core 清单"。

## 1. §0 边界(沿用 Task 8-11 全部 §0)

1. **无运行时**:不引入 Cassandra/Pulsar/向量 DB 服务/3D explorer/cloud/常驻。Context Core = **编译产物**(派生清单),不是跑着的服务。
2. **markdown 唯一真值**;Context Core 是**派生/可重建/字节稳定**清单(gitignore 或作为 git-tracked 版本化产物,二选一见 §4)。
3. **版本/pin/rollback/promote = git**(commit/tag/PR),不另造版本系统。
4. **provenance 不外泄**;retrieval policy 只读真值;机器路径不进共享 core。
5. embeddings 复用现有 adapter(memU/vector),**不新起向量服务**;无 adapter 时 core 仍可只含 ontology+holon+provenance(embeddings 可选段)。

## 2. Context Core 五件 → vault-mind 映射

| TrustGraph 件 | vault-mind 现状 | 内化动作 |
|---|---|---|
| **Ontology**(域 schema+entity 映射) | `ontology.py`/`meta_ontology.py` 有 | 编进 core(声明域 + entity 类型) |
| **Holon**(实体+关系+证据) | current-truth entities + blocked-by/related + holon_* | 编进 core(当前真值切片) |
| **Embeddings**(向量索引) | memU/vector adapter(可选) | core 引用 adapter 句柄,**可选段** |
| **Provenance**(来源/时间/派生) | currency:source/last-verified/supersession/STALE + capture→promote 审计 | 编进 core(每 fact 带 provenance) |
| **Retrieval policy**(遍历/新鲜度/权威) | 隐式有(reviewed>draft、recency、STALE、blocked-by) | **净新:做成一等可声明物** |

## 3. 净新原语(只 3-4 样,其余复用)

1. **Context Core 工件**:`_context-core.<topic>.json`(或 `.md` frontmatter+body),编译自 current-truth —— 打包 {ontology 切片 + holon(实体+关系+provenance)+ retrieval-policy + embeddings 句柄(可选)} + **版本戳(git HEAD/tag)**。确定性、字节稳定。这是 **11G briefing 注入的源**(briefing = 从 core 取的视图)。
2. **Retrieval policy 一等物**:声明式(freshness=currency 阈值 / authority=reviewed>draft+recency / traversal=blocked-by|related 深度)。core 带它;query/briefing 读它。
   - **per-agent 学习层(内化 caura-memclaw)**:policy 默认全局,但允许 **per-agent overlay**(top_k / min-sim / 遍历深度 / authority-vs-freshness 权重),**从 Task 11 的 outcome 反馈环(`recall-outcome`,见 11I)整定**——长期 helped 的检索形状增益、misled 的降。overlay 落 per-agent note 或机器层 `.vault-mind/`(§0 #1:无 tuner 服务,是编译期读 + 离线整定;§0 #4:机器层不进共享 core)。core 导出全局 policy;per-agent overlay **不进共享 core**。
3. **Explainability receipt**:query 回 **trace**(哪些 entity/子图/provenance 进了答案)—— 扩 `query_trace`/`query_explain`。"给收据":fact 不在 core 里 agent 就不用,杜绝黑盒。
4. **(关联,可选)Ontology 驱动 backfill**:用 ontology + agent 抽取给**存量语料**打 entity 锚(治"空转"根因),走 10B digest 路径。

## 4. 关键设计决策(待定)

- **core 是 gitignore 派生 vs git-tracked 版本化工件?** TrustGraph 要 pin/rollback/promote → 倾向 **git-tracked**(`<topic>/wiki/_context-core.json` 提交,版本=git;但与 §0 #2"派生物不提交"张力)。**折中:core 清单 git-tracked(它就是"write once"的产物,值得版本化),但其内容全可从源重建(字节稳定校验)**。需 ADR 定。
- **core 粒度**:per-topic(`<topic>/wiki/`)对齐现有 compile;或 per-domain(ontology 域)。默认 per-topic。
- **与 11G 关系**:briefing = core 的一个**查询视图**(per-work-item 切片);core = 全域可注入单元。11G 重构成"从 core 取"。

## 5. 绿条(TDD 目标)

1. **core 编译**:从 fixture current-truth 编出 `_context-core.json`,含 ontology+holon(实体+关系+provenance)+retrieval-policy+版本戳;两次运行字节一致;源不改。
2. **retrieval policy**:声明 freshness/authority/traversal → query/briefing 按它过滤排序(STALE 降权、reviewed 优先、blocked-by 深度限)。
3. **receipt**:query 回 trace = 命中的 entity/子图/provenance 链;fact 不在 core → 不出现在 trace。
4. **11G 重构**:briefing 从 core 取,行为不回归(现有 11G 测试仍绿)。
5. §0:无运行时;core 派生可重建;git=版本;无侧信道。
6. 回归闸:`test_currency_passes` + `test_project_currency` + 全量 discover 全绿。

## 6. 建造顺序(PR slices)

- **12A** Context Core 编译(打包 current-truth→`_context-core.json`,确定性+版本戳)— 绿条 1。**纯 Python,复用 currency/ontology/work_protocol**。
- **12B** Retrieval policy 一等物(声明+被 query/briefing 读)— 绿条 2。
- **12C** Explainability receipt(扩 query_trace/explain)— 绿条 3。
- **12D** 11G briefing 重构成"从 core 取" — 绿条 4(不回归)。
- **12E(可选)** ontology 驱动存量 backfill(治空转)— 走 10B 路径。
- 全程守 §0 + 回归闸。每 slice TDD 红→绿→重构 → 跑回归闸 → commit。
- **先做 12A**(core 编译,payoff 最大、风险最低、纯复用)。

## 7. 定位差异(同 Task 11)

TrustGraph = **完整 production agentic 后端**(多模 DB + RAG 管线 + agent 编排 + cloud)。vault-mind = **headless / git-native / 无运行时**。同一"知识作为可版本工件"概念,取概念丢运行时。vault-mind 差异 = **markdown 唯一真值、git 作版本、全可审无侧信道、零 DB**。

## 8. Open questions
- core git-tracked vs gitignore(§4,需 ADR)。
- embeddings 段:必含还是可选(无 vector adapter 时)。
- receipt 与现有 `query_trace`/`query_explain` MCP 工具的重叠/复用。
- "run agents anywhere":core 怎么被外部 agent 消费(MCP `context_*` 工具已是雏形?需核)。
- per-agent retrieval overlay 的整定数据(`recall-outcome`)来自 Task 11 11I —— 两任务**共用同一 outcome 反馈环**,别各造一套。

## 9. 关联
[[vault-mind-currency-v1]] · Task 11G(briefing=core 视图)· `ontology.py`/`meta_ontology.py` · 10A `_work-os.canvas` · currency 层(provenance/freshness)· MCP `holon_*`/`context_*`/`query_trace` · TrustGraph(trustgraph-ai/trustgraph)。
