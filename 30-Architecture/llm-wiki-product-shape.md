---
type: architecture
entity: architecture/llm-wiki-product-shape
status: draft
last-verified: 2026-08-29
---

# LLM Wiki 产品形态现状评估与收敛草案

> 本文是基于仓库文档、插件 UI 与 domain package README 的现状评估和收敛草案，不是最终 ADR。文中明确标为“建议”或“待拍板”的内容不等于当前已决定事项。本文没有运行时验证结论。

## 结论先行

**当前定位/基线事实：LLM Wiki 是唯一产品，Obsidian 是主工作台。**

仓库的 product spine 将 Obsidian plugin 定义为 primary human-facing product/control plane，并将 MCP/CLI 定义为 Agent/automation access surfaces；`CONTEXT.md` 同样把 LLM Wiki 定义为完整人类产品名。[`30-Architecture/llm-wiki-product-spine.md:10-14`](./llm-wiki-product-spine.md#L10-L14)[`30-Architecture/llm-wiki-product-spine.md:99-107`](./llm-wiki-product-spine.md#L99-L107)[`CONTEXT.md:5-9`](../CONTEXT.md#L5-L9)

这一基线不是本文提出的新产品拆分。当前文档已经把 Ask Mate、Canvas、Mermaid、Project Hub、Bases 与 plugin data 放在 control/projection 层，不赋予它们领域权威。[`docs/ASK_MATE_VISUAL_WORKSPACE.md:15-18`](../docs/ASK_MATE_VISUAL_WORKSPACE.md#L15-L18) 本文的建议仅是将上述定位和表面层级**冻结为所有 UI、README 和新文档的强制规则**；这件事仍属于待拍板事项。

## 一、当前事实

### 1. 产品、工作台与访问面

| 层 | 当前事实 | 证据 |
|---|---|---|
| 产品 | 人类面对的完整系统名是 LLM Wiki；`llmwiki` 只用于机器标识。[`CONTEXT.md:5-9`](../CONTEXT.md#L5-L9) | `CONTEXT.md` |
| 主工作台 | Obsidian 插件当前承载人类 onboarding、vault binding、settings、capability health、project actions 和反馈；共享 TypeScript domain 负责语义，vault Markdown/Work-OS notes 负责 durable user truth。[`30-Architecture/llm-wiki-product-spine.md:50-57`](./llm-wiki-product-spine.md#L50-L57) | product spine |
| Agent 访问面 | MCP server、CLI、session archiver 是 Agent/自动化访问面；共享 domain Operations 才是协议适配与领域逻辑之间的边界。[`CONTEXT.md:136-146`](../CONTEXT.md#L136-L146) | `CONTEXT.md`、product spine |
| 外部能力 | Python compiler、MemU、Graph bridge、Fleet 等是可选能力 worker 或 adapter，不是产品身份。[`30-Architecture/llm-wiki-product-spine.md:41-45`](./llm-wiki-product-spine.md#L41-L45) | product spine |

### 2. Project、Work 与 Knowledge

Project 是跨 work、knowledge、runtime、settings、integration 的持久协作上下文；`project/<slug>` 是稳定逻辑身份，不能等同于仓库、目录、board、forge project 或 vault subtree。[`CONTEXT.md:226-236`](../CONTEXT.md#L226-L236)

当前 Project 的记录分层如下：

- `Projects/<slug>.md` 是共享 Project Registry record。[`docs/LOCAL_PROJECTS.md:24-30`](../docs/LOCAL_PROJECTS.md#L24-L30)
- `01-Projects/<slug>/_project.md` 是 Work-OS project anchor；`01-Projects/<slug>/issues/<slug>.md` 是当前工作项的唯一持久状态来源。[`docs/LOCAL_PROJECTS.md:5-9`](../docs/LOCAL_PROJECTS.md#L5-L9)
- `10-Projects/<slug>/` 保存项目知识；`.vault-mind/local-bindings.json` 保存机器本地 workspace binding。[`docs/LOCAL_PROJECTS.md:3-5`](../docs/LOCAL_PROJECTS.md#L3-L5)
- Kanban、Canvas、Bases 是由 issue notes 或项目状态生成的视图，不是工作状态来源。[`docs/LOCAL_PROJECTS.md:7-20`](../docs/LOCAL_PROJECTS.md#L7-L20)

Knowledge Item 是统一的检索/引用对象词汇，类型可以是 evidence、analysis、memory、issue、comment、kanban_card、asset 等。[`CONTEXT.md:13-20`](../CONTEXT.md#L13-L20) 这说明“可被搜索”不等于“由知识域拥有全部生命周期”。Issue 仍由 Work-OS 负责，reviewed durable knowledge 仍由受保护的知识路径负责。[`docs/MEMORY_GOVERNANCE.md:9-20`](../docs/MEMORY_GOVERNANCE.md#L9-L20)

### 3. Agent、Work Run 与外部 workflow

Agent domain 当前拥有 versioned AgentProfile、ProjectAgentBinding、Thread、Context Envelope、Dream Time、Delegation Plan、Child Work Run 和 Artifact Projection 等记录；runtime adapter 才负责认证、运行时根目录、模型调用和 host UI。[`packages/agent-domain/README.md:1-17`](../packages/agent-domain/README.md#L1-L17)

Work Driver 的职责是读取 authoritative work-OS、选择和租用可执行项、运行 Agent、再把结果送回 capture；它不自行决定知识真相。Knowledge claim 必须进入人工审阅，work-state transition 才可能按 Promotion Policy 自动推进。[`CONTEXT.md:154-164`](../CONTEXT.md#L154-L164)

gstack、Matt Pocock engineering skills、Code-Intel 等外部 workflow/事实来源各自保有权威。LLM Wiki 可以索引和引用其 reviewed outputs，但不应改写其执行计划、triage、review、QA 或配置状态。[`docs/MEMORY_GOVERNANCE.md:3-20`](../docs/MEMORY_GOVERNANCE.md#L3-L20)[`docs/MEMORY_GOVERNANCE.md:84-115`](../docs/MEMORY_GOVERNANCE.md#L84-L115)

### 4. Visual Workspace 与 Ask Mate

Visual Workspace 是 host-neutral domain，拥有 normalized Mind Map Document、Visual Edit Plan、deterministic projections 和 hash-locked apply。[`CONTEXT.md:202-209`](../CONTEXT.md#L202-L209) canonical map source 是普通 Markdown note 中的 versioned managed section；Canvas 和 Mermaid 是 derived views。[`packages/visual-workspace/README.md:5-20`](../packages/visual-workspace/README.md#L5-L20)[`packages/visual-workspace/README.md:32-39`](../packages/visual-workspace/README.md#L32-L39)

Ask Mate 是 Obsidian 中的综合工作流表面。插件 UI 的入口文案是“Work with the current context: understand it, shape a map, or prepare a reviewed change”，并提供 citation-backed answer、Inbox draft、结构澄清、outline、deterministic preview、exact plan、explicit apply 和 reviewed problem workflow。[`obsidian-plugin/src/ask-mate/view.ts:582-740`](../obsidian-plugin/src/ask-mate/view.ts#L582-L740)[`obsidian-plugin/src/ask-mate/view.ts:748-879`](../obsidian-plugin/src/ask-mate/view.ts#L748-L879)

**`outline-first` 只属于 Ask Mate 的 `make_map` 子流程。** 它描述的是 Visual Workspace 在 Ask Mate 中的“读取/解释 → 结构澄清 → 键盘可编辑 outline → exact plan → apply”交互顺序，不是整个 LLM Wiki 的产品架构、Project 管理方式或所有知识工作的统一入口。[`obsidian-plugin/src/ask-mate/view.ts:228-260`](../obsidian-plugin/src/ask-mate/view.ts#L228-L260)[`obsidian-plugin/src/ask-mate/view.ts:775-870`](../obsidian-plugin/src/ask-mate/view.ts#L775-L870)

### 5. Settings、Capability 与 Obsidian UI

Settings Platform 是唯一 operational settings owner，覆盖 definitions、scoped values、snapshots、validation、migration 和 health；解析顺序为 `session > workspace-project > vault > user-device > product default`。[`docs/SETTINGS.md:1-21`](../docs/SETTINGS.md#L1-L21)

Obsidian Settings → LLM Wiki 是该平台的客户端，展示 effective value、winning scope、validation、apply mode、inherited/explicit assignment 和 Doctor 状态。首个 UI slice 只编辑 `user-device` 与 `vault`。[`docs/SETTINGS.md:47-57`](../docs/SETTINGS.md#L47-L57)

插件数据只保留 presentation preferences、machine-local device binding reference 和 legacy migration journal，不保留 operational assignments、resolved secrets 或跨设备绝对路径。[`README.md:168-176`](../README.md#L168-L176)

当前 Obsidian 里已经存在真实的 **Capability Library 用户表面**，它不是假设中的跨域 capability registry/health view：命令为 “Open Capability Library (LLM Wiki)”，面向技能、命令、Agent、Rules、Memories 提供浏览、搜索、创建、编辑、收藏、组织，并包含 project scanning、Claude session exploration、Marketplace discovery 和 Conversations。[`obsidian-plugin/src/agentfiles/feature.ts:81-106`](../obsidian-plugin/src/agentfiles/feature.ts#L81-L106)[`obsidian-plugin/README.md:90-104`](../obsidian-plugin/README.md#L90-L104) UI 实现为 sidebar、list、detail 三栏，并有 Dashboard、Marketplace、Skills/Conversations 列表与详情面板。[`obsidian-plugin/src/agentfiles/views/main-view.ts:80-146`](../obsidian-plugin/src/agentfiles/views/main-view.ts#L80-L146)

建议中的跨域 capability registry/health taxonomy 是另一层尚未冻结的治理视图，不能替代或改名为当前 Agentfiles 表面。Provider/Provider Capability 服务 ingest，Knowledge Adapter 只读检索，Host Capability Connector 发现和执行外部能力，Skill Pack 提供 workflow capability；Skill Pack 的定义还明确包括 user-level 安装、project mirror 和按需调用边界。[`CONTEXT.md:43-58`](../CONTEXT.md#L43-L58)[`CONTEXT.md:124-133`](../CONTEXT.md#L124-L133)[`CONTEXT.md:184-197`](../CONTEXT.md#L184-L197)

## 二、canonical truth、derived projection 与 control plane

### Canonical truth

1. **Project identity**：稳定 `project/<slug>` 与其 Registry record；binding 只把它关联到本机 workspace。[`CONTEXT.md:226-233`](../CONTEXT.md#L226-L233)
2. **Work truth**：`01-Projects/<project>/issues/*.md` 中的 Work-OS issue state、review axis 和 `blocked-by`；board 不写回它之外的另一份状态。[`docs/LOCAL_PROJECTS.md:7-20`](../docs/LOCAL_PROJECTS.md#L7-L20)[`docs/LOCAL_PROJECTS.md:42-84`](../docs/LOCAL_PROJECTS.md#L42-L84)
3. **Knowledge truth**：原始证据、agent drafts、reviewed durable notes 各自留在其 owning path；draft 不自动成为 team truth，compiled projection 也不替代来源。[`docs/MEMORY_GOVERNANCE.md:11-20`](../docs/MEMORY_GOVERNANCE.md#L11-L20)[`docs/MEMORY_GOVERNANCE.md:117-135`](../docs/MEMORY_GOVERNANCE.md#L117-L135)
4. **Visual truth**：Markdown managed map section 中的 Mind Map Document；Visual Edit Plan 是不可变提案，只有显式 apply 才能改变 source。[`packages/visual-workspace/README.md:41-51`](../packages/visual-workspace/README.md#L41-L51)
5. **Settings truth**：Settings Platform 的 versioned registry、scope documents 和 immutable snapshot；Secret 只有 opaque reference。[`packages/settings-platform/README.md:3-26`](../packages/settings-platform/README.md#L3-L26)
6. **Agent/diagnostic truth**：Agent domain 与 Problem Intake 各自拥有其 versioned records；Problem Intake 的 Issue Change Plan 必须通过 Project Operations，不能直接写 issue；远程 receipt 由 tracker/forge execution projection 持有。[`packages/problem-intake/README.md:9-28`](../packages/problem-intake/README.md#L9-L28)[`packages/problem-intake/README.md:44-48`](../packages/problem-intake/README.md#L44-L48)

### Derived projections

- `wiki/` summaries、concepts、relationships、backlinks 和 query results 是 compiler/index projection。[`docs/MEMORY_GOVERNANCE.md:129-135`](../docs/MEMORY_GOVERNANCE.md#L129-L135)
- Kanban board 从 Work-OS issue notes 派生；Canvas、Mermaid 和 Bases 从 canonical project/map state 派生。[`docs/LOCAL_PROJECTS.md:7-20`](../docs/LOCAL_PROJECTS.md#L7-L20)[`README.md:177-183`](../README.md#L177-L183)
- Project Hub 组合 Project intent、current work、knowledge、Work Runs、workspace health、settings、capability health 和 integration drift；它是 read-only derived view，不存完整 workflow state。[`CONTEXT.md:238-242`](../CONTEXT.md#L238-L242)[`docs/MEMORY_GOVERNANCE.md:38-82`](../docs/MEMORY_GOVERNANCE.md#L38-L82)
- GitHub、Gitea、Linear、Plane 是 External Projections；local reviewed Work-OS Markdown 保持 canonical。[`docs/LOCAL_PROJECTS.md:142-167`](../docs/LOCAL_PROJECTS.md#L142-L167)

### Control plane

Control plane 不是另一份数据。它是让人或 Agent 查看、计划、授权和调用 canonical domain operations 的面：MCP/CLI Operations、Settings Platform、write policy、Doctor、preview/apply、transition token 和 capability/runtime resolution。[`CONTEXT.md:136-146`](../CONTEXT.md#L136-L146)[`CONTEXT.md:145-146`](../CONTEXT.md#L145-L146)

Obsidian 中的分工是：

| Obsidian 表面 | 所属层 | 它管理/展示什么 | 不应拥有 |
|---|---|---|---|
| Settings → LLM Wiki | control plane client | Settings scope、effective values、Doctor、workspace binding、advanced settings | 第二套配置模型或 resolved secret [`obsidian-plugin/src/main.ts:846-1050`](../obsidian-plugin/src/main.ts#L846-L1050) |
| Ask Mate | daily work surface + control plane client | 当前 note/selection/Canvas/Project context 的检索、make_map outline、review plan、Inbox draft、Problem Intake plan | 自动把 UI state 写成 canonical map/work truth [`obsidian-plugin/src/ask-mate/view.ts:178-225`](../obsidian-plugin/src/ask-mate/view.ts#L178-L225) |
| Project Hub / Recovery | derived view + read-only control interaction | Project recovery facts、citations、candidate、Agent Binding selection、read-only plan | 独立 Project database、持久 recovery session [`obsidian-plugin/src/project-hub/recovery-panel.ts:46-60`](../obsidian-plugin/src/project-hub/recovery-panel.ts#L46-L60)[`CONTEXT.md:241-257`](../CONTEXT.md#L241-L257) |
| Advanced control plane | administration surface | Project/Agent/binding、Room/Thread、Dream Time、delegation、connectors、capability diagnostics | 日常知识入口或 plugin-local authority [`obsidian-plugin/src/control-plane-ui.ts:110-134`](../obsidian-plugin/src/control-plane-ui.ts#L110-L134)[`obsidian-plugin/src/control-plane-ui.ts:207-236`](../obsidian-plugin/src/control-plane-ui.ts#L207-L236) |
| Canvas / Bases / Kanban | projection/view | 空间图、issue table、board | canonical map 或 issue state [`README.md:177-188`](../README.md#L177-L188) |
| Capability Library（当前 Agentfiles 用户表面） | presentation/workspace surface | 技能、命令、Agent、Rules、Memories，以及 Dashboard、Marketplace、Conversations 的浏览、编辑、收藏、安装/组织 | 跨域 capability registry 的替代物，或各 domain 的 canonical owner [`obsidian-plugin/src/agentfiles/feature.ts:81-106`](../obsidian-plugin/src/agentfiles/feature.ts#L81-L106)[`obsidian-plugin/src/agentfiles/views/main-view.ts:80-146`](../obsidian-plugin/src/agentfiles/views/main-view.ts#L80-L146)[`obsidian-plugin/README.md:90-104`](../obsidian-plugin/README.md#L90-L104) |
| Cross-domain capability registry/health taxonomy（建议） | registry/health governance view | 统一展示不同 capability type 的描述、版本、health、permission、remediation | Agentfiles、Provider、Adapter、Connector 或 Skill Pack 的共同替代物 |

## 三、建议的最小、单一产品骨架

以下是**建议形态**，用于收敛语言和边界，不是已批准的最终架构：

```text
LLM Wiki（唯一产品）
├── Obsidian 主工作台
│   ├── 工作入口：Ask Mate
│   │   ├── ask / cite / save Inbox draft
│   │   ├── make_map：read → clarify → outline-first → plan → apply
│   │   └── problem review：local Work-OS plan / external contribution plan
│   ├── Project 入口：Project Hub（只读组合）
│   ├── 设置入口：Settings（Settings Platform 客户端）
│   └── 管理入口：Advanced Control Plane；Capability Library：Agentfiles 用户表面（建议另加跨域 registry/health 视图）
├── Canonical domains
│   ├── Project + Work-OS
│   ├── Knowledge + Memory/Governance
│   ├── Visual Workspace
│   ├── Agent / Workflow
│   ├── Problem Intake
│   └── Settings Platform
├── Agent access
│   ├── MCP Operations
│   └── CLI
└── Derived projections
    ├── wiki / query / graph evidence
    ├── Kanban / Bases / Canvas / Mermaid
    ├── Project Hub composition
    └── External tracker projections
```

这个骨架的单一产品规则是：**能重建的是 projection；只负责查看、计划、确认、路由的是 control plane；只有 domain-owned record 才是 canonical truth。** 这与 board、Canvas、Mermaid、Project Hub 不取得 domain authority 的现有约束一致。[`docs/ASK_MATE_VISUAL_WORKSPACE.md:15-18`](../docs/ASK_MATE_VISUAL_WORKSPACE.md#L15-L18)[`docs/LOCAL_PROJECTS.md:7-9`](../docs/LOCAL_PROJECTS.md#L7-L9)

## 四、主要混乱点与收敛建议

### 混乱点 1：Knowledge Item 看起来像所有对象的共同 owner

**事实**：Knowledge Item 类型包含 issue、kanban_card、memory、evidence 等，但 Work-OS 和 durable knowledge 仍有不同 owner。[`CONTEXT.md:13-20`](../CONTEXT.md#L13-L20)[`docs/MEMORY_GOVERNANCE.md:11-20`](../docs/MEMORY_GOVERNANCE.md#L11-L20)

**建议**：把 Knowledge Item 限定为跨域的检索、引用和关联词汇；在 UI 和文档中同时显示 owning domain，避免“可搜索”被理解为“可由 Knowledge 域写入”。

### 混乱点 2：Project Registry、Work-OS anchor、Project Hub、workspace binding 都被叫作 Project

**事实**：Project ID 是稳定 join key，Registry、issue notes、knowledge roots 和 local binding 作用不同；Hub 是 derived read model。[`docs/LOCAL_PROJECTS.md:3-9`](../docs/LOCAL_PROJECTS.md#L3-L9)[`docs/MEMORY_GOVERNANCE.md:38-82`](../docs/MEMORY_GOVERNANCE.md#L38-L82)

**建议**：产品文案统一用“Project identity / Project work / Project knowledge / Workspace binding / Project Hub”，不再用“Project”单独指代所有文件夹或画布。

### 混乱点 3：Ask Mate、Visual Workspace、Canvas、Mermaid 被理解为同一套编辑器

**事实**：Visual Workspace 是 domain；Ask Mate 是 Obsidian control surface；Markdown managed section 才是 map source；Canvas/Mermaid 是 projections；普通 note/Canvas adoption 需要 preview/apply。[`packages/visual-workspace/README.md:5-26`](../packages/visual-workspace/README.md#L5-L26)[`docs/ASK_MATE_VISUAL_WORKSPACE.md:47-60`](../docs/ASK_MATE_VISUAL_WORKSPACE.md#L47-L60)

**建议**：把“map editing”称为 Visual Workspace capability，把“Ask Mate”保留为入口，把 Canvas 只称为 Canvas projection/adoption source。`outline-first` 只在 `make_map` 标题下出现。

### 混乱点 4：Agent、Capability、Skill Pack、Provider、Adapter 的入口重叠

**事实**：Agentfiles 是当前 Obsidian Capability Library 用户表面；Provider Capability、Knowledge Adapter、Host Capability Connector、Skill Pack 则分别代表 ingest、read-side retrieval、host execution 和 workflow package。Advanced control plane 还同时显示 Agent、connector、capability state。[`CONTEXT.md:121-134`](../CONTEXT.md#L121-L134)[`CONTEXT.md:124-133`](../CONTEXT.md#L124-L133)[`CONTEXT.md:184-197`](../CONTEXT.md#L184-L197)[`obsidian-plugin/src/agentfiles/feature.ts:81-106`](../obsidian-plugin/src/agentfiles/feature.ts#L81-L106)[`obsidian-plugin/src/control-plane-ui.ts:113-117`](../obsidian-plugin/src/control-plane-ui.ts#L113-L117)

**建议**：保留 Agentfiles 作为现有用户表面；若新增 Capability Library 的跨域 registry/health 视图，应明确其为治理投影，展示 type、owner、side-effect class、权限和 canonical operation，不能把不同对象合并成一个“插件/能力”模型。

### 混乱点 5：Settings、Agent Control Plane 与 plugin data 的边界不够直观

**事实**：Settings Platform 是唯一 settings owner；插件 data 只保存 presentation、device binding 和 migration journal；Advanced Control Plane 管理 Agent/Project/binding/connector 等 domain records。[`README.md:168-176`](../README.md#L168-L176)[`obsidian-plugin/src/control-plane-ui.ts:207-236`](../obsidian-plugin/src/control-plane-ui.ts#L207-L236)

**建议**：UI 导航把“Settings（配置值）”“Agent & Project administration（版本化记录）”“Agentfiles Capability Library（技能/命令/Agent/Rules/Memories 工作表面）”与“跨域 capability registry/health（若批准则为治理视图）”分开表达，不再统称为 settings 或把它们合并为一个实体。

## 五、待拍板事项（最多五个硬决策）

以下事项需要产品/架构负责人明确批准；本文不把建议伪装成既定事实：

1. **唯一产品命名**：是否把当前基线“LLM Wiki 是唯一产品，Obsidian 是主工作台”冻结为所有 UI、README 和新文档的强制规则，并将 Ask Mate、Project Hub、Visual Workspace、Capability Library、Settings 明确标为产品内表面/领域，而非并列产品。
2. **Project authority map**：是否冻结“Registry 负责 Project identity、Work-OS issue notes 负责工作状态、`10-Projects` 负责项目知识、local-bindings 负责本机绑定、Project Hub 只读组合”的分工，并禁止新增第二套 Project/board/docket store。
3. **Visual authority map**：是否冻结“managed Markdown 是 Mind Map Document 的 canonical source；Canvas/Mermaid 是 projection；Canvas adoption 必须 preview/apply”，并明确 `outline-first` 只适用于 Ask Mate 的 `make_map`。
4. **Capability taxonomy**：是否冻结 Provider Capability、Knowledge Adapter、Host Capability Connector、Skill Pack 四种类型及其 owner/side-effect 语义，并明确当前 Agentfiles Capability Library 用户表面与建议中的跨域 registry/health governance view 不互相替代。
5. **External workflow authority**：是否冻结“gstack/Matt/Code-Intel 保有各自状态权威；LLM Wiki 只索引、引用和在自身 owning domain 中创建链接/摘要”，并维持 local Work-OS 为外部 tracker projection 的 canonical authority。[`docs/MEMORY_GOVERNANCE.md:9-20`](../docs/MEMORY_GOVERNANCE.md#L9-L20)[`docs/LOCAL_PROJECTS.md:142-167`](../docs/LOCAL_PROJECTS.md#L142-L167)

## 证据边界

本文判断仅来自当前仓库中的 `CONTEXT.md`、`README.md`、`docs/SETTINGS.md`、`docs/LOCAL_PROJECTS.md`、`docs/ASK_MATE_VISUAL_WORKSPACE.md`、`docs/MEMORY_GOVERNANCE.md`、`30-Architecture/llm-wiki-product-spine.md`、Obsidian plugin UI 源码和 `packages/{agent-domain,problem-intake,settings-platform,visual-workspace}/README.md`。没有把未读取的运行时行为、部署结果或测试结果写成事实。
