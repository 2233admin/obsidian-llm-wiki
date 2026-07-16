## Context

LLM Wiki 已经把 Project Context 作为项目身份根，把 Work Item/Work Run 作为计划与执行事实，并具有 Settings、Secret Reference、知识 Promotion、Source Registration 和 Fleet handoff。当前缺口不是再增加一个 Agent 产品，而是把持久 Agent、连续会话、工作记忆整理、只读协商、委派和外部能力接入这些分散机制收敛为同一套后端契约。

EXXETA/exxperts 仅作为产品研究 Source。其产品层采用 PolyForm Noncommercial 许可，因此本变更遵循 clean-room：只记录可观察机制和需求，不复制代码、Prompt、测试、UI 文案、样式或资产。实现只使用 LLM Wiki 现有术语、接口、存储格式和独立测试。

该变更依赖 `complete-settings-platform-and-fleet-release` 先完成、归档并形成 canonical specs。它不改变当前 Beta 验收，也不在 Beta 分支上混入实现。

## Goals / Non-Goals

**Goals:**

- 用一个 Project-aware 领域模型承载 Agent 身份、会话、执行和记忆，而不是创建平行的数据孤岛。
- 让 Dream Time 成为可提案、可审批、可追溯、可并发控制的记忆生命周期。
- 让本地模型、云模型、远程 Agent、MCP server 和设备成为可替换执行能力，而非项目事实的所有者。
- 让 Obsidian、MCP、CLI 和 Fleet 读取相同的 Room、Work Run、Memory Proposal、Connector 和 Usage 投影。
- 默认 fail closed：模型不能直接改受治理记忆、受保护知识、外部系统或跨设备共享事实。

**Non-Goals:**

- 不引入 EXXETA runtime，也不复刻其聊天前端或产品术语。
- 不把 Agent working memory 自动提升为团队知识；Promotion Policy 继续独立生效。
- 不用本变更替换 Git/GitHub/Linear 等 Project Adapter，也不扩展遗留 `agent.trigger` 为通用执行总线。
- 第一阶段不实现常驻 daemon、自动扫描或无审批的外部副作用。
- 第一阶段不追求自主 Fleet 调度器；先交付确定性 assignment plan 和显式 dispatch。

## Decisions

### 1. Room 是派生投影，不是聚合根

Room 的规范身份为：

`Room = Agent Profile × Project Context × Active Thread`

Project Context 仍是项目聚合根；Thread 只表达对话连续性；Work Run 仍是执行事实。Room projection 提供 Agent、Project、当前 Thread、关联 Work Runs、Memory Revision、Connector grants 和 Usage 摘要，但不拥有第二份项目配置或任务状态。

这避免“聊天房间、项目管理、执行管线”各自维护一套身份。没有 Project Context 的临时对话可以存在，但不得获得 Project-scoped memory、connector grant 或 durable work mutation。

### 2. Agent Profile 与 Project Agent Binding 分离

`AgentProfile` 是版本化的稳定身份和 constitution，包括名称、职责、能力声明、默认模型策略和 schema version；不得包含 secret、机器路径或即时运行状态。

`ProjectAgentBinding` 将一个 Profile 绑定到 Project Context，并声明项目角色、允许的 memory scope、connector grant references 和启用状态。Binding 不复制 Profile 内容；Profile 更新必须产生新版本，运行中的 Work Run 保留其锁定版本。

Agent Profile 与 Binding 作为 `_llmwiki` 系统状态存储；Agent working memory 继续位于既有 project/agent memory boundary。受保护团队知识仍只位于 `20-Decisions/`、`30-Architecture/` 和 `40-Runbooks/`，并经过 Promotion。

### 3. Context Envelope 是可重建快照

每次 Agent 执行都编译一个四层 `ContextEnvelope`：

1. Platform Kernel：不可由项目或 Agent 覆盖的安全、治理与输出契约。
2. Agent Constitution：锁定版本的 Agent Profile 和 Project Binding。
3. Governed Working Memory：已批准的 Agent Memory Revision，附 revision/fingerprint。
4. Runtime Envelope：Project Context、Work Item/Work Run、Thread window、Settings snapshot、device/tool capability grants 和 token budget。

Envelope 记录 schema version、各层来源、内容哈希、裁剪原因和总 fingerprint。它是可重建的运行快照，不成为新的知识真相，也不得携带 Secret value、机器路径或 lease token。重试必须使用原 fingerprint，除非显式创建新执行尝试。

### 4. Dream Time 采用 proposal-only 写入模型

Dream Time 包含三个显式 operation：

- `checkpoint`：把当前 Thread/Work Run 的近期事实压缩为待审 Recent Context proposal。
- `learn`：把已批准近期上下文归纳为稳定工作记忆 proposal。
- `review`：只对稳定工作记忆做去重、压缩和结构维护，不引入未引用的新知识。

模型 worker 只能返回 `MemoryProposal`，不能调用写工具、网络或外部 connector。Proposal 至少包含 Project、Agent、Thread/Work Run、source revision、source fingerprint、candidate diff、provenance、warning、model lock 和 expiry。

审批服务验证 actor authority、expected revision 和完整 proposal fingerprint 后，以 copy-on-write 生成新 `MemoryRevision`，保留 previous revision、diff、approval actor、event 和 provenance。失配或过期时标记 `stale` 并 fail closed。默认策略为人工审批；未来只允许对 Agent working memory 的 warning-free proposal 配置显式 auto-approval，永不绕过受保护知识的 Promotion。

日、周、月节奏只是上述 operation 的显式 Project-scoped 编排层：UTC 日映射 `checkpoint`，周一开始的 UTC 周映射 `learn`，UTC 月映射 `review`。三个 Settings 开关默认关闭；`status` 只计算确定性 window，`run` 只执行一次，不启动 daemon 或后台 scheduler。每个 Project/Profile/window 生成稳定 invocation/proposal identity，复用 canonical Work Run，编译 Context Envelope，并把 Work Run 停在 `awaiting_review`、`knowledge-claim`、`pending`。重放不得复制 Work Run、proposal 或 Usage Event，也不得自动批准或直接写 Memory Revision。两个设备同时创建时，Work Run 启动冲突只有在发现同一 cadence provenance 的唯一 canonical Work Run 后才可恢复；proposal 原子创建冲突必须重读已提交记录并严格比较 actor 与完整 immutable candidate bytes，相同则返回同一结果，任何语义漂移都 fail closed。

### 5. Working memory 与 durable knowledge 保持双轨

Agent working memory 用于连续工作，可以记录偏好、开放事项、近期上下文和已引用的项目事实；它不是团队知识库。任何声称为 durable knowledge、decision、architecture 或 runbook 的内容必须生成 Knowledge Promotion candidate，并走既有人工 review。

Memory Proposal 可以引用 Source、Artifact、Work Run checkpoint 和已晋升知识，但不得把引用本身当成已验证结论。`must-keep` 或保护指令必须通过结构化字段表达，模型不能静默删除。

### 6. Consult 只读，Delegation 使用 Child Work Run

`ContextConsult` 对另一个 Agent 的已批准 working memory 做 as-of 查询，返回 revision/fingerprint、provenance 和 warning。Consult 结果只进入请求 Thread/Work Run 的 artifact/output；不得直接写入任一 Agent memory。

`DelegationPlan` 明确目标、候选 Agent、输入 artifacts、允许能力、预算、到期时间和期望输出。批准后创建 `ChildWorkRun`，继承 Project ID 并记录 parent Work Run；同时签发 scoped、expiring `CapabilityGrant`。写操作或外部副作用仍逐 run 审批。Child 输出通过 `ArtifactProjection` 回到 parent，失败、取消和重放沿用 Work Run 状态机与 transition token。

### 7. Host Capability Connector 与 Knowledge Adapter 解耦

`ExpertDescriptor` 描述可执行主体的能力、模型、device affinity、健康和支持的 operation；`HostCapabilityConnector` 负责调用本地 CLI、云 Agent、远程 workflow 或 MCP host。它们不负责知识 ingest，也不拥有 Project Context。

Host Settings 中保留历史 key `providers.host_capability.provider`，但值语义是 connector selector：既可写 canonical `connector/<id>`，也可写会规范化到该 namespace 的通用 provider identifier。selector 只选择 registry identity，不产生批准权；Connector/Descriptor 必须保留 reviewed provenance，Connector registration 的 reviewer/timestamp 由已认证 approver 在服务端绑定，后续仍经过 Project Binding、Capability Grant 和 Assignment Plan。Project Tracker 的 forge.json、endpoint 与 provider token 不得作为 Host 兼容配置。

Assignment planner 只生成确定性 `AssignmentPlan`，输入为 Work Run requirement、Project policy、descriptor、health 和 device capability；排序理由和未匹配原因必须可诊断。真正执行仍经过 Work Driver lease、Work Run join 和 CapabilityGrant。

第三方 MCP 通过单一 proxy surface 暴露 `search`、`describe`、`invoke`。连接延迟建立；Settings 保存非敏感配置，Secret Reference 指向凭证，Project Binding/Grant 决定可见性。OAuth token、stdio environment 和远端 headers 不得写入 vault shared state 或插件数据。

### 7A. Knowledge Adapter 只提供检索，不取得记忆权威

MemU、LightRAG、RAG-Anything、Kanban、QMD 与 Hindsight 属于 `VaultMindAdapter` 的可替换检索面，不属于 Host Capability Connector，也不拥有 Project Context、Agent Memory Revision、Source Registration 或 Promotion 决策。Hindsight clean-room 集成只调用官方只读 recall route；不实现 retain/reflect，不复制上游代码、Prompt、UI 或测试。MemU 的共享 profile 只保存 credential-free PostgreSQL endpoint；私有 DSN 必须由 Secret Reference 在设备本地最后一跳解析，并与公开 host/port/database 匹配。vault-to-MemU 写入/同步复用同一个 profile，在每个数据库或 graph subprocess 最终边界单独解析私有 DSN；私有值不得进入 OS argv、日志、返回结果、Snapshot 或 Doctor。

MCP 启动时从 Settings Snapshot 生成一个可审计、无 secret value 的 adapter runtime profile。显式 Settings assignment 优先；只有对应 key 仍位于 product scope 时，历史 environment/YAML 才作为带 `legacy-env`/`legacy-config` provenance 的兼容候选。显式 disabled、无效 endpoint/list/timeout 或不可解析的显式 Secret Reference 均 fail closed。Secret value 只在设备本地、紧邻 HTTP adapter 构造的最后一跳解析，不进入 Snapshot、Doctor、日志或共享状态。

`VAULT_MIND_VAULT_PATH` 与 `VAULT_BRIDGE_VAULT` 只保留为定位 vault/Settings 文档的 bootstrap locator；它们不构成第二套 adapter 配置权威。

### 8. Usage 是 append-only 事实，不是推算账单

每次模型、connector、consult、delegation 和 Dream Time 调用写入幂等 `UsageEvent`，维度包含 Project、Agent、Thread、Work Run、Provider、Model、Device、operation、token 和 provider-reported cost。幂等键由 provider call ID 或稳定 run/call identity 生成。

未知 token、价格或归属必须显式标记 `unknown`，不得用零代替。预算和额度是 policy projection，不改写历史事件。共享事件不包含 prompt 正文、secret 或机器路径。

### 9. 多设备共享事实与本地执行状态分离

Project、Agent Profile/Binding、Thread、Work Run、approved Memory Revision、proposal decision 和 Usage Event 是 durable/shared facts。Secret values、workspace path、process handle、lease token、runtime session 和 device-local connector state 保持本地。

每次 Memory approval、Work Run transition 和 dispatch 都带 expected revision/fingerprint；并发写冲突返回可诊断 stale/conflict，不做 last-write-wins。Device capability/health 以带 TTL 的 advertisement 表达，过期设备不得被自动匹配。

### 10. 后端契约先行，Obsidian 只做控制面

交付顺序为 domain/storage → MCP operations → Compiler/Work Driver → doctor/projections → Obsidian UI。插件调用同一 operations，不自行拼 prompt、不持有 lease、不保存明文 secret，也不创建第二套审批状态。

第一个纵向切片是：创建 Agent Profile/Binding → 打开 Room projection → 创建 checkpoint proposal → 审批并生成 Memory Revision → 在新 Thread/Work Run 中以 fingerprint 读取。该切片通过 MCP/CLI 完成后才进入 UI。

### 11. Project Tracker Projection 与 Host Capability Connector 分离

GitHub、Gitea、Linear 和 Plane 是 canonical Project/Work Item 的外部投影，不是可执行 Agent 能力。它们使用独立的 `providers.project_tracker.*` Settings profile；Host Capability 的 `search/describe/invoke` 配置和授权不得被 Forge 同步复用。

Project Tracker 的 Secret Reference 只在网络调用前解析；显式 disabled、invalid 或缺失凭据时 fail closed，只有完全未配置 Settings 时才允许带 provenance 的 forge.json/环境变量兼容路径。Plane 使用可配置 Cloud/self-hosted base URL、`X-API-Key` 和当前 `/work-items/` REST 路径；workspace/project state UUID 只从 binding 显式读取，不进行猜测。所有 outward mutation 继续经过 reviewed-head digest、Settings/binding drift、总时限与受限重定向校验。

## Risks / Trade-offs

- **领域对象增加导致复杂度上升。** 通过保持 Project Context 和 Work Run 为现有根、Room 仅作投影来限制扩散。
- **Prompt/记忆格式可能过早固化。** 存储结构化 section、revision 和 provenance；具体渲染由版本化 compiler 负责。
- **人工审批影响速度。** 第一阶段优先正确性和可恢复性；只为 working memory 预留显式 auto-approval policy，不给 protected knowledge 开后门。
- **Connector 统一面可能屏蔽供应商特性。** proxy 保留 provider metadata 和 raw diagnostic reference，但核心授权、幂等和审计保持统一。
- **多设备事件同步可能重复。** 使用稳定幂等键、expected revision 和 append-only event；无法确定顺序时显示 conflict 而非静默合并。
- **依赖尚未归档的 Fleet spec。** 实施前必须归档 Beta 变更，再以 canonical fleet-workflow 为基线应用本 delta。
- **外部产品许可污染风险。** Source inspection 只保留事实、链接和 commit SHA；代码审查检查无 EXXETA 文件、字符串、assets 或依赖进入实现。

## Migration Plan

1. 完成并归档 `complete-settings-platform-and-fleet-release`，确认 canonical settings/fleet/work-run specs。
2. 为现有 agent memory/passport/handoff 写 characterization tests 和只读 inventory；不就地重命名用户文件。
3. 引入 versioned Agent Profile/Binding/Thread 和 Room read model，旧入口继续兼容读取。
4. 用 adapter 将既有 recent memory/passport 映射为 initial Memory Revision；迁移只生成报告和 proposal，默认不自动覆写。
5. 交付 checkpoint 纵向切片；再逐步启用 learn/review、consult/delegation、connectors 和 usage ledger。
6. 后端验收通过后增加 Obsidian 控制面；保留 feature flag 和 rollback 到旧只读 memory path。
7. 运行 schema migration、targeted tests、full build/typecheck、fleet verification、secret/path leak scan 和 strict OpenSpec validation 后发布 Beta。

## Open Questions

- Agent Profile 是否需要跨 vault registry，还是第一阶段仅 vault-scoped；默认先 vault-scoped，保留 stable external ID。
- Working memory 的 warning-free auto-approval 是否进入首个 Beta；默认不进入，只保留 policy/schema。
- Usage cost catalog 由 provider metadata 还是 settings-maintained price table提供；第一阶段仅记录 provider-reported cost 和 unknown。
- Fleet health advertisement 的 transport 复用现有 workflow artifact 还是增加独立 operation；实施时以最小可验证复用为优先。
