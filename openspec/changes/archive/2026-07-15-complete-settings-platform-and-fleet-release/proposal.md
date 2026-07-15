## Why

LLM Wiki 已具备 Project Registry、Work-OS、Project Hub 和跨运行时 Work Run 的主体能力，但系统级设置仍被 Obsidian 插件本地状态割裂，若干 Project Context 与发布路径也能绕过既有契约。现在需要一次完整收口，让插件、MCP、CLI、Python、单设备和多设备舰队都使用同一组可验证的领域能力，并确保仓库实际发布的 bundle 与源码一致。

## What Changes

- 新增主机无关的 Settings Platform 第一纵切面：定义注册表、分域持久化、确定性解析、解释、校验、Doctor、乐观 revision 和原子恢复。
- 将 Agent 默认模型连接纳入 Settings Platform，支持兼容既有环境、本地 OpenAI-compatible/Ollama 与云端模型，并通过 Secret Reference 绑定凭证。
- 将 `user-device` 设置存放在设备本地存储，将 vault 与 workspace-project 设置保存在各自域中；Obsidian `data.json` 只保留表现层偏好与设备绑定引用。
- 为 TypeScript 与 Python 提供同源 fixture 和规范化快照，证明在 Obsidian 关闭时 MCP/CLI 仍能独立工作。
- 将 Obsidian 设置页改为共享 `settings.*` 操作的控制面，并让 Project Hub 组合真实 Effective Settings Snapshot 与真实健康状态。
- 修复所有 project-scoped memory、conversation、source 和 workflow 路径，使其先解析规范 `project/<slug>`，未知项目不得隐式创建知识目录。
- 补齐只有 Work-OS anchor 的历史项目迁移、Work Run lease/identity 校验，以及多设备/多 Agent 并发边界。
- 将源码测试、Obsidian 插件、生成 bundle、安装 smoke 和关键 operation smoke 纳入默认 CI 与发布门禁。
- 用本地与 5090 两套运行环境完成同一 Project/Work Run 的舰队 Workflow 端到端验收。

## Capabilities

### New Capabilities

- `settings-platform`: 定义、作用域赋值、快照解析与解释、校验、Doctor、原子持久化、revision 冲突和跨运行时一致性。
- `release-runtime-parity`: 保证源码、生成 bundle、插件产物、安装脚本和默认 CI 执行同一能力与测试集合。
- `fleet-workflow`: 在单设备和多设备环境中维持稳定 Project、Work Item、Work Run 与 agent lease 身份，并提供可重复的跨环境验收流程。

### Modified Capabilities

- `project-context`: 每个 project-scoped operation 必须通过 Project Context resolver；Project Hub 必须组合真实 Settings Snapshot 并准确降级健康状态。
- `project-layout-migration`: 历史 anchor-only 项目必须能规划、应用和恢复 Project Registry 迁移。
- `work-run-coordination`: agent join 必须与现有 lease 和 durable Work Run 身份一致，不能覆盖既有运行身份。

## Impact

- 影响 `mcp-server` 的 operation registry、project/memory/conversation/workflow 模块、bundle 生成与测试入口。
- 影响 Python compiler/CLI 的设置解析、设备本地持久化、Work Driver 协作契约与 conformance tests。
- 影响 Obsidian 插件的设置存储、Doctor、Project Hub 投影、子进程调用和构建测试。
- 影响 Agent/Compiler 子进程的 provider、model、base URL 与临时凭证环境绑定，但不会把凭证值写入插件、vault、日志或快照。
- 影响 CI、setup/install verification、发布文档和 5090 舰队验收脚本。
- 不引入新的知识权威、RAG 后端或外部项目管理 source of truth；Linear、Git、Plan 等保持 External Projection/Host Capability Connector 边界。
