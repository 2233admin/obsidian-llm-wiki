## Context

LLM Wiki 的核心领域已经通过 Operation Interface 同时服务 MCP、CLI 和 Obsidian，但设置仍由插件直接读写 `data.json`，Project Hub 只能探测配置文件而不能消费真实快照。与此同时，Project Context 的部分 memory/conversation 路径、历史 anchor-only 项目迁移和 Work Run join 仍绕过规范身份。发布脚本又直接安装预生成 `mcp-server/bundle.js`，因此“源码已实现”与“用户安装后可用”不是同一个事实。

本变更跨 TypeScript MCP 域、Python compiler/CLI、Obsidian 控制面、设备本地状态、vault 状态、迁移与发布系统。第一纵切面必须证明同一契约可在 Obsidian 关闭、本地单设备、5090 多设备舰队三种条件下工作。

## Goals / Non-Goals

**Goals:**

- 建立一个可被全部主机调用的 Settings Platform，而不是扩充插件私有配置。
- 使 TypeScript 与 Python 对同一 registry/assignment fixture 产生规范等价的 snapshot。
- 保证设备本地路径不会被 vault 同步，vault/project 设置仍可协作。
- 关闭 Project Context、迁移和 Work Run 身份绕过路径。
- 让源码、bundle、插件、setup 与 CI 的能力集合一致。
- 用真实 5090 环境验证 Project/Work Run/Agent 的跨设备 Workflow。

**Non-Goals:**

- 不选择或内置唯一 RAG、MemoryU、HandSave、Linear 或 Git provider。
- 不把 Obsidian、5090、Orca、Cloud Workflow 或第三方插件变成领域 source of truth。
- 不在第一纵切面保存任何明文 secret；只支持 Secret Reference。
- 不重做前端视觉体系；只完成后端契约与最小可用控制面。

## Decisions

### 1. Settings 使用 MIT 共享领域包和主机适配器

TypeScript 的 registry、schema、resolution、validation、persistence 和 service 放在独立的 `packages/settings-platform/` MIT 包中；GPL MCP 与 MIT Obsidian 插件都消费该包，避免直接把 `mcp-server/src` 打进插件造成许可证和所有权混淆。`mcp-server/src/settings/` 只提供 Operation Interface 与 runtime health probes；Obsidian 通过同一 service/client 调用，不复制解析或校验。Python 实现独立 resolver/CLI adapter，并由共享 JSON fixtures 约束行为。

选择该方案是因为它保持 Operation Interface 边界、明确 GPL/MIT 复用关系，并能检测跨语言漂移。替代方案“以 Obsidian data.json 为源”无法在 Obsidian 关闭时工作；“让 Python 调用 TypeScript 子进程”会掩盖跨运行时契约缺陷。

### 2. 按作用域物理分离存储

- product defaults：版本化 registry，随代码发布，只读。
- user-device：操作系统用户配置目录下的 LLM Wiki 设备文件，不进入 vault/Git。
- vault：vault 内 `_llmwiki/settings/vault.json`。
- workspace-project：vault 内 `_llmwiki/settings/projects/<slug>.json`，以 Project ID 定位。
- session：仅进程内存，可过期，不持久化。

每个持久化 scope 文档包含 `schemaVersion`、`revision`、assignments、更新时间与 actor。写入采用同目录临时文件 + fsync/replace，成功前保存可恢复 previous revision；expected revision 不匹配返回 conflict。跨进程 mutation 在同一文件锁内完成“重读 revision → 校验 → backup → replace”，避免两个 revision 12 编辑器都写成 revision 13。

选择按域分离是为了让同步边界与语义边界一致。单一 vault 文件无法安全承载设备路径，单一用户文件又无法实现团队 vault/project 设置。

### 3. Snapshot 是唯一消费输入

解析优先级固定为 `session > workspace-project > vault > user-device > product default`。消费者不得自行合并 env、CLI、插件状态。env/CLI 只在 bootstrap 时转成声明过的 session 或 user-device assignment。snapshot 包含 source revisions、winning scope、provenance、validation 和 overridden candidates；secret-reference 只返回 locator 元数据与 presence health，不解析 secret 值。

### 4. Project Context 是所有 project-scoped 操作的入口

memory、conversation、source、workflow、settings workspace-project scope 和 Project Hub 在执行业务逻辑前调用同一 resolver。兼容裸 slug 时记录诊断；严格发布门使用 `LLMWIKI_PROJECT_COMPATIBILITY=disabled`。未知项目一律 not-found，不创建 `01-Projects`、`10-Projects` 或 settings project 文件。

历史 anchor-only 项目由 migration inventory 识别，plan 生成缺失 Registry 记录，apply 使用既有 hash/backup/manifest 机制，restore 可逆。

### 5. Work Run join 是身份断言而不是 upsert

`workflow.agent.join` 必须验证 Project ID、Work Item ID、Work Run ID、agent ID 和本地 lease 关联。已存在 durable run 时只允许幂等加入或合法状态推进，禁止覆盖身份字段。无 lease 的显式人工 run 走独立的受限创建路径，不能冒充 Work Driver lease。

### 6. 生成产物属于发布门

`mcp-server/bundle.js` 由确定性 build 命令生成并在 CI 中验证 clean diff。默认测试同时运行 `tests/**` 与 `src/**/*.test.ts`；插件执行独立 test/typecheck/build。setup smoke 从实际 bundle 启动并断言 settings、project context、hub、migration、workflow operation 存在。发布工件缺任一能力即失败。

### 7. 舰队验收复用领域 Workflow，不引入第二套协调状态

5090/Orca 只负责创建隔离 worktree、运行 agent 和收集 commit。LLM Wiki 的舰队验收使用一个注册 Project、两个设备绑定、一个 Work Item 和一个 Work Run：本地创建/租约，5090 join/checkpoint/leave，本地 doctor/Hub 验证。Orca task ID 只作为 External Projection/provenance，不替代 Project ID 或 Work Run ID。

## Risks / Trade-offs

- [跨语言实现出现细微差异] → 共享规范化 fixture、稳定 canonical JSON、双向 parity tests，并把 fixture digest 纳入测试输出。
- [Windows 原子替换与文件锁行为不同] → 封装 persistence adapter，使用同目录临时文件和 bounded retry，并用真实 Windows CI/5090 smoke 验证。
- [插件无法直接调用内嵌 MCP operation] → 提供进程内 operation client；必要时使用明确 argv 数组的 CLI bridge，禁止把 `py -3` 当单一 executable。
- [历史项目迁移误判] → inventory/plan 默认只读，hash precondition、备份与 manifest 保持现有恢复契约。
- [多 Agent 同时修改高冲突文件] → 5090 工作树按 settings core、project/workflow hardening、release verification 分 lane，根 Agent 负责顺序集成和生成 bundle。
- [CI 时间增长] → 先运行受影响模块测试，再运行完整 Python、MCP、plugin 和 install smoke；不通过则不推 main。

## Migration Plan

1. 单独提交 LLM Wiki 命名统一，形成所有工作树的共同基线。
2. 引入 registry、scope store、resolver 与 parity fixture，不改变插件现有行为。
3. 暴露 `settings.*` operations，迁移插件 `pythonPath` 等第一批字段；保留一次性读取旧 `data.json` 的 migration plan/apply，并删除迁移后的设备路径副本。
4. 将 Project Hub 和全部 project-scoped operations 接入 resolver/snapshot。
5. 补齐 anchor-only Project Registry 与 Work Run identity migration/validation。
6. 更新默认测试、生成 bundle、setup smoke 和发布清单。
7. 本地通过完整门禁后推协作分支，在 5090 重复构建测试并执行跨设备 Workflow。
8. 仅在两端证据一致且 git tree clean 时合入 main。回滚使用 scope previous revision、project migration restore 和 git revert，不删除用户数据。

## Open Questions

- 第一版 Secret Reference provider 仅实现 `environment` presence probe，还是同时接入 OS keychain；本变更默认前者。
- Obsidian 最终采用设置页还是独立控制中心；本变更只要求两者共享 operation client，默认保留设置页并增加 Doctor/解释投影。
