# Task 7（草案）— 工作状态防漂移：把 currency 引擎接到 project/decision/action

> 状态：**DRAFT，待审**。承接 V1-BUILD.md（Task 0–6）。一句话：知识已经防漂移了，
> 让**工作状态**也享受同一套 compile/currency —— project / decision / action 不再是死归档。

## 北极星

一个 project 的状态本身就是高漂移实体（决策被推翻、action 被做掉或丢掉、"现在到哪了"每天变）。
agent/人每次开口拿到的应是**编译过的项目 current-truth**（含 STALE/blocker 标记），而不是某条手填、过期的 `status: active`。

## 诊断（为什么要做）

现状三个证据，说明 PM 这块是"有词表、没引擎":
1. `vault.decide` 有 `superseded` 词，但**没东西自动算**——全手填。
2. currency `_scan_entity_notes` 只扫 `<topic>/wiki` + `00-Inbox`,**不扫 `Projects/` `Decisions/` `Meetings/`**;这些 note 也不带 `entity` → 对 supersession/staleness 完全隐形。
3. `vault.project status: active` 纯咨询性,**无人发现"标着 active 但 3 个月没动"**。

## §0 硬约束（沿用 V1-BUILD，违反任一 = 回滚）

1. markdown = 唯一真值;无 DB/embedding/vector。
2. 派生物可重建、gitignore、**不提交**、不回改源 note(标记只进派生视图)。
3. inbox append-only、按写者目录(复用 Task 4 capture)。
4. promote 只走 git PR。
5. 写操作默认 dry-run。
6. **只 ADD pass,不动现有 ranking / persona / compile / currency 行为**(7 是在 currency 之上再叠,不改 Task 1–3)。
7. 全程分支 + 只跑 fixtures,不碰真 vault。

## §1 schema（复用现有,只加最小字段）

work-state note(project / decision / meeting-action / capture)的 frontmatter,**全部复用 Task 1 的 5 个 currency 字段**,只新增 2 个可选:

```yaml
entity: project/iii-pivot     # 复用;project 用 project/<slug> 命名空间锚
type: decision                # 复用;action 用 decision/fact,project 用新值 project(见下)
source: commit:NEW5678        # 复用
last-verified: 2026-06-25     # 复用;= 该条最近一次被确认/活动的日期
supersedes: <旧 action/decision 的 id>  # 复用;done 的 supersede open 的
status: draft                 # 复用(draft=未核 / reviewed=已核)
# --- 新增,均可选 ---
owner: <name>                 # 可选;compile 出"无主"段
due: 2026-07-01               # 可选 ISO date;compile 出"逾期"段
```

新增 `type` 值 `project`(进 `STALE_THRESHOLD_DAYS`,默认 30d);`action` 复用 `decision`(14d)。
`owner`/`due` 缺省即不参与对应分段——老 note 零改动仍可编译。

## §2 任务（顺序;各做完开 PR）

### Task 7A — project 状态漂移守卫(Python,`kb_meta.py`,复用 staleness pass)
- 扩 `_scan_entity_notes` 的扫描根:加入 work 文件夹(`Projects/`、`Decisions/`、`Meetings/`,或按 config),其余逻辑不变(仍只收带 `entity` 的)。
- staleness pass 已有 age+anchor 逻辑;`project` 进阈值表(30d,config)。
- 判据:`status` 蕴含"在进行"(active / 未 superseded) **且** 最近活动(该 entity 下所有 note 的 `last-verified`/mtime 最大值)超阈值 → 标 `STALE` = "真还在做?"。
- **不删不改源**;标记只进派生视图。
- 验收(fixture):project `entity: project/iii-pivot` active 但 60d 无活动 → STALE;<阈值则 OK。

### Task 7B — project current-truth pass(Python,新 pass,镜像 `_current-truth.md`)
- 新 compile pass:按 `entity=project/*` 聚合,产出**派生** `wiki/_project-status.md`(gitignore、可重建)。每个 project 一段:
  - **当前状态**(取 current-truth 那条 project note 的 status,带 7A 的 STALE 标记)
  - **未完成 action**(该 project 下 un-superseded 且非 STALE 的 action;done 的走 supersession 已被顶掉、不列)
  - **最近决策**(该 project 相关、按 recency)
  - **blocker = contradiction**:挂已有 `_contradictions.md` 机制,不建依赖图 DB
  - **逾期 / 无主**:有 `due` 过期 / 无 `owner` 的 action 单列
- 复用 Task 1–3 的 group-by-entity + supersession + render 套路;**不重写**,只多产一个视图。
- 验收(fixture):见 §3。

### Task 7C(可选,二期)— 入口与检索打通
- `vault.project`/`vault.decide`/`vault.meeting` 写出时自动盖 `entity`/`type`/`last-verified`(复用 Task 4 buildNote 思路)。
- `vault.search` 命中 project/action 时内联 `_project-status` 的 STALE/blocker 标记(复用 Task 3 currency-aware 检索)。

## §3 fixture + 验收(单一 bar)

`fixtures/vault-project-iii/`(独立,非真 vault),seed:
1. `Projects/iii-pivot.md`:`entity: project/iii-pivot, type: project, status: reviewed`,`last-verified` = 60d 前,正文"进行中"。
2. `Decisions/2026-..-pivot.md`:`entity: project/iii-pivot, type: decision`,近期。
3. action A(open):`entity: project/iii-pivot, type: decision`,`due` 已过、无 `owner`。
4. action B(done):`supersedes: <action A 之外的某条>`,演示 done supersede open。
5. 一条 blocker note(挂 contradiction)。

**验收**:compile 后 `wiki/_project-status.md` 对 `project/iii-pivot` 显示——
状态 = active **但 STALE**(60d 无活动);未完成含 action A(标"逾期/无主");列出近期决策;列出 1 个 blocker;done 的 action superseded 未删。全部派生、可重建、未提交、未改源。绿 = 可合并。

## §4 可调参数（config,非硬编码）

| 参数 | 默认 | 位置 |
|---|---|---|
| 漂移阈值 `project` | 30d | config |
| 漂移阈值 `action`(=decision) | 14d | config |
| 扫描的 work 文件夹 | `Projects/ Decisions/ Meetings/` | config |

## §5 边界（明确不做）

不做 Linear/Jira:不加任务执行引擎、排期、通知、容量/WIP 强约束、看板 UI。
违背 [COMPETITIVE_BOUNDARY.md] 与 philosophy.md "de-alienation, not task management"。
定位 = **工作状态的 compiled/reviewed 记忆**(谁定了什么、项目当前真相、什么漂移了);执行/排期/通知留外部。

## §6 实现栈

- 7A/7B = Python,进 `kb_meta.py`(同 Task 2 currency passes,纯叠加 pass)。
- 7C = Node(`connector.ts` + Task 4 hook 复用)。
- 优先级:**7A 先(最便宜,马上止血状态漂移)→ 7B(项目 current-truth 视图)→ 7C 二期**。
