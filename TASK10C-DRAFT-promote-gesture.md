# TASK 10C（草案）— Obsidian promote 手势:在视图里一键提交候选

> 状态:**APPROVED**(2026-06-28,`/office-hours` Builder 模式)。Approach **C(候选 canvas + 稳定命令触发)** 选定。
> 一句话:**把"看见候选"和"提交候选"合到 Obsidian 里** —— 候选渲成一张 canvas(复用 10A render),promote 走稳定 command/右键(不赌 Canvas 节点手势 API)。闭合 capture(10B)→ 视图 → promote 环,**全在 Obsidian 内**,不离开去手编 frontmatter + git。

## 0. 为什么顺

10A 把 current-truth 渲成 `_work-os.canvas`;10B 让 agent 末回合吐一组 candidate(draft + `digest-session` 溯源 + `blocked-by`)。但**提交一个候选**目前还得:手开 draft → 改 `review: reviewed` → git。10C 给这步一个 Obsidian-native 低摩擦入口。**酷点**:候选铺在一张图上,一个命令把它推过 git 闸,变成 current-truth,下次就出现在 10A 的地图上。

## 1. §0 边界(沿用 Task 8-11 全部 §0,新增本任务约束)

1. **插件只是 UI affordance**:触发**现有** promote 路径,绝不旁路闸、绝不直写 current-truth(§0 #3)。
2. **promote 仍 git-PR 闸**:手势 = **暂存提交**(标 `review: reviewed` + materialize + 落到一个 PR 分支),真合并 = 人 git。手势不"偷偷 promote"。
3. **dry-run 默认**:手势先弹 promote **plan(materialized 快照 diff)**,确认才 apply(镜像 CLI dry-run)。
4. **派生物规矩照旧**:`_triage.canvas` = 派生视图,gitignore、可重建、字节稳定、不回改源。
5. **机器路径不进共享 md**;插件不读写 `.vault-mind/` 之外的机器态;token/路径不外泄。
6. **插件是新 artifact → 必须有分发渠道**(见 §6),否则是没人能装的码。

## 2. 触发机制(确认过的前提)

- 插件跑在 Obsidian(Electron)→ 用 Node `child_process` **shell out 到 Python `kb_meta`**。**不走 MCP server**(那是给 Claude Code 的 stdio,插件够不着)。
- ⚠️ **当前 kb_meta 没有 `promote` CLI 子命令**(现有:init/currency/work/sync-* …)。`work_protocol.promote()` 是函数,promote 闸是 git 人审。
- **本任务净新 CLI 面**:加 `kb_meta promote --note <id> [--apply]` —— 薄包装 `work_protocol.promote()`(带 base-head 乐观锁 + materialize 快照),dry-run 出 plan,apply 写 reviewed head。**锁/快照逻辑留在 Python 单一真值**,插件只编排 + git。

## 3. Approach C — 候选 canvas + 稳定命令触发

### 3.1 候选 canvas render(Python,复用 10A 机器)
- 新 render target `_triage.canvas`:把 **candidate(draft in `00-Inbox/AI-Output/**` / `_triage` Pending Review)** 渲成 `file` 节点,**独立配色**(draft=黄/待审),**按 `digest-session` 分组**(10B 的溯源 tag)或按 triage 段(Unclassified/Pending/Conflicts)。`blocked-by` 仍画 edge。
- 复用 `render_work_os_canvas` 的几何 + JSONCanvas 约定(确定性网格、字节稳定)。gitignore `**/wiki/_triage.canvas`(或 vault 根)。
- 这是 10A 的**姊妹 render**:10A=authoritative 地图,10C 渲=candidate 地图。

### 3.2 Obsidian 插件(TS,fork 官方 sample-plugin = 轮子)
- fork `obsidianmd/obsidian-sample-plugin`(manifest + esbuild,稳定脚手架)。
- 加 **command**「vault-mind: promote candidate」+ **draft 笔记 file 右键菜单**项。**不**用 Canvas 节点手势 API(避开不稳面)。在候选 canvas 上,点节点→打开其链接的 draft 笔记→对该笔记用命令/右键。
- 动作流:`kb_meta promote --note <id>`(dry-run)→ 插件弹 **modal 显示 plan**(materialized 快照 diff + base-head)→ 确认 → `--apply` → 插件 `git add`+commit 到 promote 分支(PR 闸)。
- **降级**:Canvas API 探到不可行就纯靠 command-palette + file 菜单(= Approach A 形态),功能不丢、只少"图上看候选"。

### 3.3 Canvas-API spike(第一步,降风险)
- 先核**当前 Obsidian Canvas API 面**:能否程序化生成/打开 `.canvas`、节点→file 跳转是否稳。手势本身走稳定 command/menu,所以**即使 Canvas 节点 API 全废,10C 仍成立**(降级形态)。spike 决定 3.1 候选 canvas 值不值得渲。

## 4. 方案对比(office-hours Phase 4 留档)

- **A 最小可行**:仅 command/右键 promote draft,无 canvas。人~1天/CC~30min,低风险,视觉弱。
- **B 纯 Canvas 节点手势**:理想 UX,但赌不稳的 Canvas 内部 API,可能白啃。人~3-4天,高风险。
- **C 混合(选定)**:候选 canvas(可见)+ 稳定命令触发(不赌 API)+ 降级路径。人~2天/CC~45min,中低风险。**酷又能 ship**。

## 5. 绿条(TDD 目标 / 验收)

1. **候选 canvas**:`_triage.canvas` 把 draft 候选渲成合法 JSONCanvas(file 节点 + draft 配色 + digest-session 分组 + blocked-by edge);两次运行字节一致;源不改;gitignore。**可在真 Obsidian 双击打开**。
2. **promote CLI**:`kb_meta promote --note <id>` dry-run 出正确 materialized 快照 plan(base-head 锁、SNAPSHOT_FIELDS allowlist);`--apply` 写 reviewed head + 不静默覆盖(HEAD_MISMATCH 守);源 draft 经闸才动。
3. **插件**:command 出现在面板 + draft 右键;触发弹 plan modal;确认走 apply + git 暂存;**绝不旁路闸**。
4. **端到端环**:capture(10B 吐候选)→ `_triage.canvas`(10C 渲)→ promote 手势 → current-truth → 出现在 10A `_work-os.canvas`。
5. **降级**:Canvas API 不可行时,纯 command/menu 路径仍能 promote(绿条 3 不依赖 canvas)。
6. 全程 §0:派生字节稳定、不回改源、promote 只经 git 闸、dry-run 默认。
7. **回归闸**:`test_currency_passes` + `test_project_currency` + 全量 discover 全绿(Python 侧);Node 插件 + promote CLI 各自测试。

## 6. 分发计划（新 artifact 必须有）

- **个人用**:Obsidian BRAT 装(github repo)或手动 copy 到 `<vault>/.obsidian/plugins/`。
- **社区**:Obsidian community plugin 提交(后续,非首版)。
- **promote CLI** 随 vault-mind 仓走(kb_meta 子命令,无新分发)。
- 插件仓 = vault-mind 内子目录(`obsidian-plugin/`?)或独立 repo;CI 出 `main.js`+`manifest.json` release。**首版手动 release 即可**,别先上 community。

## 7. 建造顺序(PR slices)

- **10C-0 spike**:核当前 Obsidian Canvas API 面 + 跑通 sample-plugin 在本 vault 加载(降风险,先做)。
- **10C-A `kb_meta promote` CLI**:薄包装 work_protocol.promote,dry-run/apply,base-head 锁(绿条 2)。**纯 Python,可独立测/落**。
- **10C-B `_triage.canvas` render**:Python,复用 10A 机器,candidate 节点+配色+分组(绿条 1)。
- **10C-C 插件**:fork sample-plugin + command/右键 + plan modal + shell `promote` + git 暂存(绿条 3/4);降级路径(绿条 5)。
- 全程守 §0 + 回归闸(绿条 6/7)。每 slice:TDD 红→绿→重构 → 我跑回归闸 → commit。
- **注意**:10C-A(promote CLI)其实独立有用(无插件也能命令行 promote),可先落当 11 执行环的"真 promote"一环。

## 8. Open questions

- 当前 Obsidian Canvas API 到底暴露啥(spike 定;可能要配 Browser Bridge 查文档)。
- PR 闸具体形态:插件 git commit 到本地 promote 分支 vs 调 `gh` 开 PR vs 只标 reviewed 等人手 commit?(默认:本地分支 commit,人审 merge)
- `_triage.canvas` 独立文件 vs 给 `_work-os.canvas` 加 candidate 图层?(默认独立,职责清)
- promote CLI 与 11 执行环的 `work debit`/loop 怎么共用(10C-A 落了,loop 的"真 promote"也有了着落)。

## 9. The Assignment(下一步具体动作)

**先做 10C-0 spike**:① clone/装官方 `obsidian-sample-plugin` 到 `D:\knowledge\.obsidian\plugins\` 跑起来确认插件能加载;② 在 Obsidian 开发者控制台核 Canvas API(`app.workspace` / canvas view 暴露啥、能否程序化开 `.canvas`、节点→file)。spike 结果决定 10C-B 渲 canvas 值不值,**不决定 10C 成立**(命令路径稳)。spike 完回来定 10C-A(promote CLI)先落。

## 10. 关联
[[vault-mind-currency-v1]] · TASK10-DRAFT(10A canvas / 10B digest,§2 10C 原始构想)· `docs/WORK_LOOP.md`(11 执行环,promote CLI 共用)· 10A `_render_work_os_canvas`(候选 canvas 复用其机器)。
