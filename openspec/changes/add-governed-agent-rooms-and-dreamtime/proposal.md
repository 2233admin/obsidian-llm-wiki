## Why

LLM Wiki 已经拥有 Project Context、Work Run、Settings、Secret Reference、知识 Promotion 和跨设备 Fleet，但持久 Agent 的身份、会话连续性、Dream Time 记忆整理、跨 Agent 协商和第三方能力连接仍是分散原语，尚未形成一套可观测、可审批、可恢复的后端契约。EXXETA/exxperts 证明了“持久房间 + 提案式记忆 + 只读协商 + 单一 MCP 代理”的产品价值；我们需要用 LLM Wiki 自己的领域模型 clean-room 内化这些机制，使 Obsidian、MCP、CLI 与 Fleet 共享同一事实，而不是引入或复制另一个产品运行时。

## What Changes

- 将 UI 中的“Room”定义为派生投影：`Agent Profile × Project Context × Active Thread`，不新增与 Project 平行的身份或数据孤岛。
- 建立版本化 Agent Profile、Project-scoped Agent Binding、Thread 和四层 Context Envelope：平台内核、Agent Constitution、受治理记忆、当前运行时授权。
- 把 Dream Time 正式建模为 `Checkpoint → Learn → Review` 三段记忆生命周期；模型只能生成 Memory Proposal，只有审批服务可在 revision/fingerprint 校验后写入新 Memory Revision。
- 每次记忆写入采用 copy-on-write、保留 diff/actor/provenance/event，过期提案 fail closed；知识结论仍走既有 Promotion Policy，不允许 Agent 直接写受保护知识。
- 建立只读 Context Consult 和审批后 Delegation：协商结果携带 as-of revision/fingerprint，委派以 Child Work Run、能力租约和 Artifact Projection 表达。
- 建立 Host Capability Connector/Expert Descriptor，支持按能力、健康、设备、模型与权限进行确定性 assignment planning；外部 Agent runtime 只是可替换执行器。
- 将 LightRAG、RAG-Anything、Kanban、QMD 与 clean-room Hindsight recall 收敛为 Settings 驱动的只读 Knowledge Adapter；外部检索结果不成为 LLM Wiki Memory 或 durable knowledge authority。
- 将第三方 MCP 服务器压缩为一个 `search/describe/invoke` 代理面；配置归 Settings、凭证归 Secret Reference、授权归 Project Context，连接延迟建立并可诊断。
- 建立 append-only Usage Event 账本，按 Project、Agent、Work Run、Provider、Device 和调用类型投影 token、成本与无法归因状态。
- Obsidian 最终提供 Agent Room、Dream Time 提案审批、Connector、Work Run/舰队和 Usage 的控制面；MCP/CLI 保持完整无界面可用性。
- EXXETA/exxperts 只作为注册 Source 和产品研究证据。除其单独标记为 MIT 的 runtime 外，不复制 PolyForm Noncommercial 约束下的代码、Prompt、测试、UI 文案、CSS、图标或资产；本变更使用 LLM Wiki 术语、数据格式、测试和实现独立完成。

## Capabilities

### New Capabilities

- `governed-agent-rooms`: Agent Profile、Project-scoped Agent Binding、Thread、Context Envelope、能力与模型锁，以及 Room 派生投影。
- `dreamtime-memory`: Checkpoint、Learn、Review 的提案、审批、版本、fingerprint、归档、事件与知识 Promotion 边界。
- `agent-collaboration`: 只读 Context Consult、审批式 Delegation、Child Work Run、能力租约和 Artifact Projection。
- `host-capability-connectors`: Expert/Host Capability Descriptor、健康探测、assignment planning、MCP 单代理入口和 Secret Reference 边界。
- `knowledge-adapters`: Settings 驱动的可选检索适配器、legacy provenance、最后一跳 Secret Reference、只读 Hindsight recall 与 Memory/Promotion 权威边界。
- `agent-usage-ledger`: append-only Usage Event、幂等记录、成本/额度/无法归因分栏及 Project/Agent/Work Run 投影。
- `project-tracker-projections`: 将 GitHub、Gitea、Linear 与 Plane 建模为独立于 Host Capability Connector 的 Project External Projection，并通过专属 Settings/Secret Reference 配置面治理同步。

### Modified Capabilities

- `work-run-coordination`: Work Run 增加 Agent Assignment、parent/child 关系、能力租约摘要、Context Envelope fingerprint 和 Artifact Projection，不改变既有 Project/Work Item/Work Run 身份与审批规则。
- `fleet-workflow`: Fleet 从单 Work Run portable handoff 扩展为基于设备能力与 Agent 健康的可诊断 assignment/dispatch，同时继续保持设备路径、租约 token 和 secret 不进入共享状态。

## Impact

- 主要影响 `mcp-server/src/` 的 memory、context、workflow、project、settings、connector 和新增 agent-domain operations。
- `compiler/work_driver.py` 增加可插拔但确定性的 assignment planner；Compiler 负责 Context Envelope，而不是复制 Agent runtime 状态。
- `packages/settings-platform/` 增加 Agent process、connector、usage 与维护模型设置，所有 secret 仍只保存 Secret Reference。
- `obsidian-plugin/` 在后端契约稳定后增加 Project/Agent/Dream Time/Connector/Usage 控制面，不把 prompt、lease 或明文 secret 存入插件数据。
- `scripts/verify_fleet_workflow.ts` 扩展多设备能力漂移、Child Work Run、consult/delegation、artifact 和 secret/path 泄漏验收。
- 实施前置条件是先完成并归档 `complete-settings-platform-and-fleet-release`；本变更独立推进，不改写 Beta 的最后验收任务。
- 不新增 EXXETA 产品层依赖；如未来需要 Pi runtime，应优先评估其 MIT 上游并单独完成依赖与许可证决策。
