# Task 10（草案）— structure-into-view:AI 把对话结构化成视图

> 状态:**DRAFT,待审**。方向源自 lumen-light(Empathos/lumen-light),但**只取概念,丢实现**。
> 一句话:**AI 把一段对话结构化,编译成 vault 里一张可视的图**——复用 Task 8/9 的内核,不引入任何运行时。

## 为什么对我们特别顺(核心洞察)

lumen 之所以要 OpenAI Realtime + WebRTC + 独立 web app,是因为它**没有 agent**——它得现造一个 LLM 实时会话来做结构化。
**vault-mind 本来就被 agent 用**(写 capture 的就是 LLM)。所以「AI 把对话结构化」对我们 = **agent 在它本来就有的回合末尾,吐一组结构化 capture 块**。不需要新模型服务、不需要实时通道、不需要画布 app。

> 拿 lumen 的概念(对话→结构化视图),不拿它的运行时(realtime/voice/cloud/TLDraw app)。

## §0 边界(新增,沿用 Task 8/9 全部 §0)

1. **不引入 runtime**:无 realtime/语音/WebRTC/云模型/常驻服务/TLDraw web app。结构化在 **agent 现有回合**完成(它已经是 LLM)。
2. `.canvas` 是**派生视图**:gitignore、可重建、不回改源;Obsidian **原生读 `.canvas`(JSONCanvas)**,看图不需要装插件。
3. markdown 仍是唯一真值;视图(md / canvas)永不是源。
4. 结构化产出 = `status:draft` candidate,只经 promote/PR 进 current-truth(§0 #4)。

## §1 概念两半

**「结构化」**(对话 → 结构)= conversation digest:agent 把一段对话拆成一组 ` ```vault-capture ``` ` 块——entities / decisions / issues / relations(`blocked-by`),复用 **Task 4 capture hook + Task 8 schema + 8C 关系**。一次会话 → 一小张实体图的提案。

**「成视图」**(结构 → 视图)= `.canvas` 渲染:把 current-truth(+digest)编译成 **JSONCanvas**——节点(project/issue/decision)+ 连线(`blocked-by`/supersedes)+ 分组(initiative)+ 配色(STALE/blocked/done)。就是再加一个 `_render_*`,和 `_project-status.md` 同构,只是输出 `.canvas`。

## §2 任务

### 10A — `.canvas` render target(先做,视觉 payoff 最快、风险最低,Python)
- 新 `_render_*` 把 work-OS current-truth 编译成 `<topic>/wiki/_work-os.canvas`(JSONCanvas:`nodes[]`{id,type:text,x,y,width,height,color}+`edges[]`{id,fromNode,toNode,label})。
- 映射:project/issue=text 节点;`blocked-by`=edge;initiative=group 框(或分区);STALE/blocked/done=color(JSONCanvas 预设 1-6 或 hex);可选 cycle=列分区。布局:按 entity 前缀分层的确定性网格(无随机,可重建)。
- 叠加 pass、复用 _pass4/effective_state/STALE;gitignore `**/wiki/_work-os.canvas`;dry-run/apply 同其它派生物;LF bytes。
- 验收:vault-work-os 的 iii-pivot(initiative/projects/issues/blockers)编译出 `.canvas`,节点/边/分组/配色正确,**可在真实 `D:\knowledge` 直接双击打开**;两次运行字节一致;源不变。

### 10B — conversation digest(核:「AI 结构化对话」,Node + 约定)
- 约定 + capture hook 扩展:agent 在会话末尾可发**一组**(而非单条)vault-capture 块,代表把这段对话结构化成的实体图(含 `blocked-by` 关系)。复用现有 hook 的块解析(已支持多块)+ Task 8 schema;一次写多个 draft candidate,走现有 triage→promote。
- 可选:一个 "digest" 块头(`vault-digest`?)让 hook 知道这组块同属一次会话(打 `origin: session/<id>` 便于 triage 分组)。
- 验收:喂一段含「定了用 Postgres、issue X 被 Y 阻塞」的 transcript → 产出 decision + 2 issue + 1 blocked-by 关系的 candidate 组,全进 `_triage/Pending Review`;promote 后进 current-truth 并出现在 10A 的 `.canvas` 上。

### 10C — Obsidian「promote canvas 节点」手势(deferred,薄插件)
- 在 Obsidian Canvas 里选中一个 candidate 节点 → 触发 promote(仍走 PR 闸)。纯 UI 糖,核外;留到 10A/10B 稳后再说。

## §3 fixture + green bar
复用 `fixtures/vault-work-os/`:10A 把现有 initiative/projects/issues/blockers 编译成 `_work-os.canvas`,断言节点数/边(A blocked-by B 有连线)/分组(initiative 框住成员)/配色(STALE 红、done 灰);10B 喂一段 transcript 出结构化 candidate 组。**绿** = 两视图派生/可重建/未提交/未改源,且 `.canvas` 能被 Obsidian 打开(合法 JSONCanvas)。

## §4 顺序
**10A**(canvas render——立刻能在真实 vault 看到 work-OS 地图)→ **10B**(conversation digest)→ 10C(deferred 插件)。

## §5 边界(明确不做)
realtime / 语音 / WebRTC / 云模型 / 新 LLM 服务 / TLDraw web app / 常驻进程。结构化用 agent 现有回合;视图是编译产物;真值仍是 markdown。
