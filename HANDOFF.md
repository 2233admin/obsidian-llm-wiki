# vault-mind — 工作交接(handoff)

> 给下一个 session 的自包含简报。读完这一份就能接着干,不需要回看旧对话。

## 0. 怎么跑 / 在哪

- 代码:`D:\projects\vault-mind`(**有 git remote**:origin = github `2233admin/obsidian-llm-wiki`;旧记的「无 remote」是错的,别再信)
- 真实 vault:`D:\knowledge`(gitea 备份,已授权真测;但写入只能落 gitignored 的机器层)
- 当前 branch:`main`,HEAD `941112b`(= origin/main,已推),工作区干净。**Task 8–11 全在 main 上**
- Python 测试(Windows GBK 会坏 UTF-8,**必须带 `PYTHONUTF8=1`**):
  ```
  PYTHONUTF8=1 python -m unittest discover -s tests -p "test_*.py"
  ```
- **回归闸(每次改完我自己跑,不信子 agent 的窄命令)**:
  `test_currency_passes` 6/6 + `test_project_currency` 18/18 + 上面的全量 discover
- Node(mcp-server / hook):`npm run build` + `node --test dist/**/*.test.js`

## 1. 架构脊柱:一条协议 capture → promote → compile

```
输入端 capture=提案(draft): 人手写 md / agent digest(10B) / remote pull(9C-E)
            │  全进 _triage/Pending Review
            ▼  promote=提交(只走 git PR 闸, base-head 乐观锁→HEAD_MISMATCH, 绝不 last-write-wins)
      ╔════════════════════════╗
      ║  markdown 源 = 唯一真值  ║
      ╚════════════════════════╝
            │  compile=只读派生(gitignore/可重建/字节稳定/永不回改源)
   _project-status.md  ·  _work-os.canvas(10A)  ·  workspace-status(9B)  ·  push 回远端
```

- **三个 frontmatter 轴(2026-06-27 调和后)**:workflow `state`(backlog/todo/in-progress/done/canceled;`blocked` 不持久化,由 `effective_state` 从真实 `blocked-by` 派生)× review `review`(draft/reviewed;**已从 `status` 挪出**——`status` 现归 rhizome 契约,∈{active,frozen,archived})× rhizome `kind`(note/decision/spec/...)。work note 现同时过 work-OS 与 rhizome pre-commit hook
- **两种引用永不混**:`note-id = repo 相对路径`(结构锚:base-head/supersedes)vs `entity`(语义锚:blocked-by/related)
- **逻辑身份 ≠ 机器路径**:entity 进共享 md;`D:\...` 机器路径只进 gitignored `.vault-mind/local-bindings.json`

## 2. §0 不变量(所有 Task 共用,不可破)

1. markdown 是唯一真值;派生物(md/canvas/总表)永不是源
2. 派生物:gitignore、可重建、永不提交、永不回改源、两次运行字节一致
3. promote 只经 git PR 闸;dry-run 默认
4. **无 runtime / daemon / webhook / cloud / 新 LLM 服务**(取概念,丢运行时)
5. token 只从 env,只进 header,任何错误路径都不外泄
6. 机器路径只进 gitignored `.vault-mind/`,绝不进共享/提交内容

## 3. 已建成(DONE)

- **Task 8 — work-OS 协议(8P/8A–8G,含 Tier2 8E/8F)**:5 态状态契约、8P 事务协议(capture/promote/compile + base-head 锁)、blocker 图、triage 视图、issue 属性视图、initiative/cycle rollup、agent 自更新环。`compiler/currency.py`、`compiler/work_protocol.py`、`compiler/kb_meta.py`
- **Task 9 — workspace 联邦(9A–9F)**:`workspace.py`(registry/scan/adopt/workspace-status,只读,无符号链接穿越)+ `forge.py`(Transport 可注入/FakeTransport;Gitea/GitHub/Linear 三 adapter;`detect_sync_conflict` anti-loop;sync-pull/plan/apply)
- **真实全量勘察已落库**:`D:\knowledge\.vault-mind\` 里有 workspace.json + local-bindings.json(65 项目)+ _workspace-status.md。结果:**65 项目,3 个 local-only,9 个 unpushed(openalice +65 commits;code-intel-pipeline diverged;vault-mind no-upstream),61 dirty/forgotten**
- **Task 11 — work driver 执行闭环(11A+11B 已落)**:`compiler/work_driver.py` `select_next`(actionable+未 blocked,priority+note-id 确定性)+ lease 原子签出(base-head 锁,`.vault-mind/_leases.json`)+ `work next` CLI。**11B budget gate**(`compiler/work_budget.py`,commit `30ee25e`):cap+spent 进 markdown frontmatter(`budget`/`budget-spent`,§0 #1/#7 可审,不进机器层),`work next` claim 前查池→满则停(不 lease 不 spawn,绿条 3);池化=项目容器预算(§7);`== cap` 放行/`> cap` 拦;`work budget` CLI 只读报表。**无 runtime**——一次性心跳跑完退(§0 #4)
- **看板(kanban)统一**:`render_kanban_board` 把 work-OS 真值渲成 obsidian-kanban 插件**原生格式**(`work board` CLI 落盘 `board.md` 派生视图);lane 标题 i18n(zh/ja/en 自动探测);`ensure-plugin` CLI 自动装+启用 obsidian-kanban(用户没装也能用)
- **MCP↔work-OS 单一真值(941112b)**:`mcp-server/src/project/workos.ts`(work-OS 脑的 TS 移植)+ `project.ts` 改薄 adapter,删 docket store。`project_board_get` 与 Python `work board` **字节相等**(`parity.test.ts` 守);`project_issue_*` 全落 work-OS note。**Linear 可弃**
- **bundle 启动 bug 修(92e15d3)**:Windows 下 entrypoint guard 路径串比对失败 → bundle.js 静默不启服务;改 `file://` URL 比对修好
- **Task 10A — work-OS map JSONCanvas(已落,commit `0d15551`)**:`kb_meta._render_work_os_canvas` 把 cmd_currency 已解出的 current_truth/project_status/initiative_status 编译成 `<topic>/wiki/_work-os.canvas`(Obsidian 原生读 .canvas,不装插件)。initiative 框 project、project 框 issue、`blocked-by`=edge、color=STALE 红/blocked 橙/in-progress 绿/todo 青、done 灰(不上色)。确定性嵌套网格(sorted+固定几何→字节稳定);派生不改源;`if project_status` 同闸写出 + gitignore `**/wiki/_work-os.canvas`。**≠ TS 的 per-project `project-map.canvas`**(那是单项目;这是全 work-OS 地图,两者并存)
- **Task 10B — conversation digest(已落,commit `dd6c25a`)**:capture hook(`scripts/hooks/capture-hook.mjs`)保留 `blocked-by` 关系(进 ALLOWED_KEYS,`buildNote` emit 成 inline YAML list→编译器读成真关系→promote 后上 10A canvas 当 edge)+ 每条 capture 打 `digest-session: <sid>`(标识同一会话的 digest 组,triage 可聚类;专用 key 不撞联邦 `origin` 嵌套 map)。多块本就支持(一块一 draft),所以 digest=agent 回合末吐一组 vault-capture 块走现有 triage→promote。测试 `capture-hook.test.mjs` U 例(decision+2 issue+1 blocked-by→3 draft,blocked-by 存活成 list,全带 digest-session)。**seam**:triage 按 digest-session 聚类(绿条不要求)

## 4. 待办 / 方向

### Task 10 — structure-into-view(已起草:`TASK10-DRAFT-structure-into-view.md`)
取 lumen-light 概念(AI 把对话结构化成视图),**丢其运行时**。两半:
- **10A ✅ 已落(commit `0d15551`)**:`_render_work_os_canvas` 把 work-OS current-truth 编译成 `<topic>/wiki/_work-os.canvas`(**JSONCanvas,Obsidian 原生读,不装插件**)。节点=project/issue,edge=blocked-by,group=initiative,color=STALE/blocked/done。确定性网格布局。测试 `tests/test_work_os_canvas.py`(13 例,结构/边/配色/确定性/集成全绿)。
- **10B ✅ 已落(commit `dd6c25a`)**:capture hook 保留 `blocked-by`(emit inline YAML list→真关系→上 10A canvas)+ 每条打 `digest-session: <sid>`(同会话 digest 组溯源,专用 key 不撞联邦 origin)。多块本就支持。测试 `capture-hook.test.mjs` U 例全过。seam:triage 按 digest-session 聚类(绿条不要求)。
- 10C(deferred):Obsidian Canvas 里「promote 节点」手势,薄插件。

### Task 11 — work driver / 执行闭环(**✅ 功能完整:select_next + lease + work next + 看板统一 + MCP 统一 + budget gate + budget-spent 回写 + 自pacing loop-trigger 心跳(`83be98d`);端到端可按需跑,recipe=`docs/WORK_LOOP.md`**)
源自 paperclip(paperclipai/paperclip,agent 编排平台),**只取「执行闭环」概念,丢其 daemon/Postgres/org chart/多租户**。
- **缺口**:vault-mind 到「真值正确且可查」就停了,是被动层;从不闭合到「所以 agent 去把活干了」。补一个**薄 driver**:读 work-OS authoritative 真值 → 挑下一个可执行项(priority + 未 blocked + 指给 agent)→ 锁定签出 → 拉起 agent → 结果 capture→promote → token 记账。
- **硬骨头我们已有**(不是重写):原子签出 = 现成的 base-head 锁(HEAD_MISMATCH);持久记忆 = vault 本身 + Task 5 inject;结果写回 = capture→promote。**净新只有三样:loop trigger + budget ledger + lease(claimed-by)**。
- **§0 兼容做法**:心跳 = OS cron / ScheduleWakeup 触发**一次性 CLI**(`vault-mind work next`),跑完退,无常驻;预算 = work note 里一行 token 账本,spawn 前硬停;签出 = `claimed-by` 租约当 capture,promote 即上锁。
- **它吸收并升级原 brief 的 Task 5(inject)+ Task 6(e2e)**。

## 5. 构建 cadence(沿用)

每个 Task:**TASK 草案(先写文档定 §0/原语映射/绿条)→ 多 agent Workflow(build 顺序 → 3 棱镜对抗 verify 并行 → fix)→ 我自己跑回归闸(不信窄命令)→ commit**。
教训:Workflow 的子 agent 用窄测试命令漏过 `test_currency_passes`,曾把通用 current-truth 搞坏(§0 #8 回归,后在 `480e350` 修)。**回归命令必须含 currency 测试 + 全量 discover。**

## 6. 下一步建议

1. ~~**Task 11**~~ ✅ 功能完整。11A 选活+lease + 11B gate(`30ee25e`)+ budget-spent 回写(`176da66`:`work_budget.record_spend` 字节级改 frontmatter + `work debit` CLI)+ loop-trigger 自pacing 心跳(`83be98d`:`work next` 出 `status`[selected/idle/budget_exhausted]+`remaining`,recipe `docs/WORK_LOOP.md`)+ 11G bootstrap briefing(`d2aefd3`:`work_driver.render_briefing` + `work briefing` CLI,开工注入 current-truth 切片=state/blockers/siblings/required-reading,只读派生)。端到端 = `work next`(选)→`work briefing`(冷启上下文)→do→capture→promote→`work debit`,**按需 ScheduleWakeup 重拉、自终止**(A 机制,看情况按需要)。**剩纯操作/可选**:真用 ScheduleWakeup 起一次 on-demand(本机未起,无队列不常驻);10C Obsidian promote-节点插件(deferred,Canvas API 不确定/headless 难验)。
2. ~~**Task 10A/10B**~~ ✅ 全落(10A `0d15551` + 10B `dd6c25a`)。**10C 设计定稿+首片落地**:design doc `TASK10C-DRAFT-promote-gesture.md`(office-hours approach C,approved `c1dd4c3`);**10C-A `kb_meta promote` CLI 已落 `ee940fc`**(包 work_protocol.promote,base-head 锁+materialize,dry-run 出 plan/`--apply` 写 reviewed,HEAD_MISMATCH 不静默,非 draft=NOT_DRAFT)——**顺手补上 Task 11 loop 缺的真 promote 步**。剩 10C:**10C-0 spike**(需用户 Obsidian dev console 核 Canvas API)→ 10C-B `_triage.canvas` 渲染(复用 10A 机器)→ 10C-C 插件(fork sample-plugin,command/右键触发,降级稳)。**未验**(可选):真 `D:\knowledge` 跑 currency 看 `_work-os.canvas`。
3. 原 brief Task 5 inject / 6 e2e(已被 Task 11 概念吸收,按需)。

---
**成本提醒**:本 session 已 ~$928 / 改了 55 文件(累计旧 session 更高)。新 session 注意收口,别一口气铺太广。
