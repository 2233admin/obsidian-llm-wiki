# Task 8（草案 v2）— work-OS:工作真值的事务协议 + 三层对齐

> 状态:**DRAFT,待审**。承接 Task 7(7A 漂移守卫 / 7B `_project-status.md` / 7C 入口 stamping)。
> v2 把原先零散的 7 个 P0 收敛成**一条事务协议**(8P),其余任务都建立在它之上。

## §-1 单一协议(脊柱,先读这一段)

> **capture 是提案 · promote 是提交 · compile 只读取已提交的工作真值。**

agent 的 `state: done` 不是「失效」也不是直接关 issue,而是**立即成为待审的状态提案**。只有 promotion 能改变工作真值;promotion 必须完整、可审、可并发检测。一条协议同时解决:agent 越权、inbox append-only、稀疏更新、并发冲突、triage。

### 最终状态流

```
authoritative head H1            agent 报告完成        capture candidate C1
state: in-progress       ──────────────────────▶    state: done
status: reviewed                                      status: draft
                                                      base-head: H1
                                                          │ 出现在 _triage,尚不改项目状态
                                                          ▼
                                                      promote(C1)
                                                      1. 校验 current head 仍是 H1
                                                      2. 继承 H1 完整字段
                                                      3. 用 C1 显式字段覆盖
                                                      4. 物化 reviewed 完整快照 H2
                                                          ▼
                                                      H2  state: done / status: reviewed
                                                          supersedes: H1 / promotes: C1
                                                          │ PR merge
                                                          ▼
                                                      authoritative head = H2
                                                      看板才从 Open → Done
```

### 两个索引(关键区分)

| 索引 | 由什么组成 | 用途 |
|---|---|---|
| **candidate index** | `status: draft` 的 capture | `_triage`(待分诊/待审/冲突) |
| **authoritative work index** | `status: reviewed` 快照 + 兼容的旧 note | 项目状态、blocker、统计、initiative health |

**note-id 约定**:`base-head`/`supersedes`/`promotes` 用 **note-id = repo 相对路径**(沿用现有 kb_meta);旧 head 文件 append-only 永不删,路径稳定 → 可作乐观锁 token。`blocked-by`/`blocks`/`related` 用 **entity**。两者**不混用**。

## §0 硬约束(v2 修订,违反即回滚)

1. markdown=唯一真值;无 DB/embedding/vector。
2. 派生物可重建、gitignore、不提交、不回改源 note。
3. inbox append-only、按写者目录(复用 Task 4 capture)。
4. promote 只走 git PR(= Linear Triage 的 review 闸)。
5. 写默认 dry-run。
6. **不改** generic current-truth 选择、ranking、persona、currency score 算法。Task 8 只在 current-truth 索引**之后**追加 authoritative-work-head / relations / triage / work-view 这些 pass。
7. **允许变化仅限 Task 8 明列项**:work state 分类、priority 排序、Blockers、triage、estimate 汇总、agent update lifecycle、新增字段展示。
8. **不含 Task 8 字段的 legacy fixture**:generic current-truth / ranking / persona / currency 输出必须**逐字节不变**(回归基线)。
9. 分支 + 只跑 fixtures。
10. **不做 runtime**:无 Coding Sessions / Diffs / Analytics / 通知运行时 / daemon —— 那是 Multica/Linear 运行时层。

## §1 schema(在 7A/B/C 之上,全部可选)

**两个独立轴**(Linear 也分开):工作流 `state` ≠ 评审 `status`。

```yaml
# --- 工作流轴(持久化只允许 5 态;blocked 是派生态,禁止 writer 写)---
state: in-progress      # backlog | todo | in-progress | done | canceled
assignee: agent/opus    # 工作身份(谁负责)= Multica assignee;≠ generated-by
priority: 1             # 0 none | 1 urgent | 2 high | 3 medium | 4 low
estimate: 3             # 点数,可选
due: 2026-06-30         # 明确日期,overdue 据此判,与 priority 解耦
labels: [auth, infra]   # = tags 复用
blocked-by: [project/iii/issue/schema-freeze]   # 唯一持久化的阻塞方向(entity 引用)
related:    []          # 对称派生
initiative: initiative/q3-launch
cycle: 2026-W26
squad: backend

# --- 评审轴(不变)---
status: draft           # draft(未核)| reviewed(已核)

# --- provenance / 真值链(note-id 引用)---
base-head: H1           # capture 基于哪个 authoritative head(乐观锁,draft 用)
supersedes: H1          # promote 物化的快照取代谁(reviewed 用)
promotes: C1            # 该快照由哪条 capture 晋升而来
generated-by: au-90-opus  # 来源身份(谁写的)≠ assignee
origin:                 # Task 9 联邦层才消费;Task 8 仅列入 ALLOWED_KEYS 占位
  provider: linear      # local | gitea | github | linear
  object-id: LIN-123
  revision: 2026-06-24T20:30:00Z
  actor: user/xue
```

**派生(不持久化)**:
- `effective_state = "blocked"` 当 `state ∈ {backlog,todo,in-progress}` 且 `has_unresolved_blocker(entity)`,否则 = `state`。
- `blocks`:由 `A blocked-by B` 反推 `B blocks A`;`related` 对称。

**back-compat 映射**(currency 读 `state`,缺失从旧 `status` 推):`open→todo`、`in progress→in-progress`、`done/completed→done`、`canceled/archived→canceled`、project `active→in-progress`/`paused→todo`/`planned→backlog`。旧 `status: blocked` → canonical `in-progress` + `legacy_blocked: true` → Blockers 段显示 `[LEGACY-BLOCKED:NO-RELATION]`(老 note 零改动,新数据必须用 `blocked-by` 表达真阻塞)。

**assignee 解析**:更新 issue 时 `candidate 显式 > 继承 previous head.assignee >(绝不因 generated-by 改)`;新建时 `显式 > config writer-actors 映射 > UNASSIGNED`。读 `assignee > owner`,写只写 `assignee`;两者并存且不同 → schema warning。

```yaml
# config: writer 身份 → 稳定 actor(agent 换机器不产生两个 assignee)
writer-actors: { au-90-opus: agent/opus, us-01-codex: agent/codex }
```

**新 type**:`issue`、`initiative`。层级靠 entity 前缀:`initiative/<slug>` ⊃ `project/<slug>` ⊃ `project/<slug>/issue/<id>`。

## §2 任务

### 8A — state contract(PR1,Python,不碰视图)
5 canonical states + legacy 映射 + `priority`/`due` 校验 + actor identity resolver(writer-actors)。helper `work_state(cm)`、`PRIORITY_RANK`。验收:各 state 归类正确、旧 status 正确映射;**不改任何视图输出**。

### 8P — authoritative work update protocol(PR2,Python+Node,脊柱)
- 建两索引:candidate(`status:draft` capture)/ authoritative(`status:reviewed` 或 legacy-compatible head)。
- **capture hook(改 Task4)**:始终写 `status:draft`;honor `state`/`assignee` 等提案字段;有 entity 时盖 `base-head=<当前 authoritative head>`;**不写 `supersedes`**(draft 不进 supersession 链);不改任何 authoritative 状态。
- **promote**:校验 `candidate.base-head == current authoritative head`,不等 → `HEAD_MISMATCH` 入 triage/Conflicts;否则按 `SNAPSHOT_FIELDS` allowlist 从「旧 head + candidate 显式」**物化完整快照**(继承发生在 **promote 写出阶段**,不许 compiler 读时偷偷继承——最终 Markdown 自身即完整真值);写 `status:reviewed`/`supersedes`/`promotes`/`promoted-by`;只经分支+PR 进主干。
- **并发兜底**:一个 entity 出现两个 reviewed terminal head → `CURRENT-TRUTH-CONFLICT`,**不按时间戳自动选赢家**,用「最后无歧义祖先」作临时有效状态,标 `[TRUTH-CONFLICT: H2,H3]`,任一分支都不得静默关 issue。
- `SNAPSHOT_FIELDS = {type,entity,state,assignee,priority,estimate,due,tags,blocked-by,related,initiative,cycle,squad}`;合并优先级 `candidate 显式 > previous head > 新实体默认`。
- **P0-2 过滤**:`is_authoritative_work_note(cm)` = reviewed→True / draft→False / 旧 work note→Task7 现有行为。`_project-status.md`/relations/closed_count/initiative health 全部只读 authoritative work index。
- 验收:draft `state:done` 不动 open/closed count;promote 后才 `closed_count+1`;稀疏 capture 不丢 assignee/priority/estimate/relations;两 capture 同 base-head,第二个 promote 必 `HEAD_MISMATCH`;capture 源文件内容与 hash 不变。

### 8D — triage 视图(PR3,Python)
不改 inbox(append-only)。`_triage.md` 判据 = `capture 在 AI-Output 且 id ∉ accepted_promotes 且 id ∉ accepted_rejects`。三段:**Unclassified**(无 entity)/ **Pending Review**(有 entity 未 reviewed)/ **Conflicts**(base-head 过期 / 多头 / promotion 冲突)。接受 = 新建 reviewed 快照带 `promotes:`;拒绝/判重 = 新建 `type:decision status:reviewed rejects:<id> reason:`——都不改源 note。验收:消费后从 `_triage` 派生视图消失,源 hash 不变。

### 8C — relations + blocker 图(PR4,Python)
Markdown 只持久化 `blocked-by`(entity 引用);`blocks`/`related` compiler 反向/对称派生,避免双写漂移。`blocker_status(target)`:不存在→`BROKEN_REF`;有真值冲突→`TRUTH_CONFLICT`;`done`→`RESOLVED`;`canceled`→`CANCELED_DEPENDENCY`(canceled 依赖**不等于**满足);否则 `UNRESOLVED`。**只有 `done` 自动解除依赖**,且必须是 reviewed promoted 的 done(draft `state:done` 不解除)。7B Blockers 段从真关系算。验收:A blocked-by B,B 未完→A 进 Blockers;B reviewed-done 后→A 自动回 Open。

### 8B — issue properties(PR5,Python+TS)
`priority` 排序;**`urgent ⇔ priority==1`(不是 `<=1`)**;`due < --as-of 且 state ∉ {done,canceled}` → `[OVERDUE]`;两者并存 `[URGENT][OVERDUE]`。`sort_key = (urgent&overdue?0:1, PRIORITY_RANK[p], overdue?0:1, due or DATE_MAX, entity)`。无 assignee → `[UNASSIGNED]`。estimate 在 project 段汇总。7C `vault.project/decide` + 新 `vault.issue` 写出盖 `state/priority/assignee`。fixture 注固定日期,`compile --as-of 2026-06-30`。

### 8G — agent 自更新闭环(PR6,Node)
agent 干完 → 末条发 ` ```vault-capture ``` ` 块带 `entity + state:done` → 经 8P 成 draft candidate(`base-head` 自动盖)→ promote/PR 后才落 Done。`assignee` 缺省走 writer-actors 映射,**不等于** generated-by。验收:喂 transcript 发 `state:done` 块 → 进 `_triage/Pending Review`、open 不变;promote 后 issue → Done、`closed_count+1`、旧 head 留档未删。

### 8E / 8F — initiatives / cycles(PR7,Tier2,Python)
8E:`type:initiative`,聚合 `project/*`,派生 `_initiative-status.md` 滚动汇总(一 project STALE → health=at-risk)。8F:`cycle:` → per-cycle 视图 + 完成率。

## §3 P0 单一 green bar(唯一验收条)

给定 authoritative issue H1(`state:in-progress, assignee:agent/opus, priority:1, estimate:3, blocked-by:[B]`):

1. agent capture C1 只提交 `state:done`:C1=`status:draft`、`base-head=H1`;H1 仍 authoritative;issue 仍 Open;`closed_count` 不变;C1 在 `_triage/Pending Review`。
2. promote C1:物化完整 H2(保留 assignee/priority/estimate/blocked-by)、`status:reviewed`、`supersedes:H1`、`promotes:C1`;PR merge 后 issue → Done、`closed_count+1`、C1 出 triage、H1 与 C1 均未删未改。
3. 另一 C2 同 `base-head=H1`:promote 必 `HEAD_MISMATCH`,不覆盖 H2,C2 进 `_triage/Conflicts`。
4. A blocked-by B:B 的 draft `state:done` 不解除 A;B 的 reviewed promoted `state:done` 才解除。
5. priority:`0` 不显 URGENT;`1` 显 URGENT;`due < --as-of` 显 OVERDUE。
6. legacy fixture:Task 7 generic current-truth/ranking/persona/currency 结果不变。
7. compile:dry-run 不写文件;source tree hash 不变;派生物删除后可完全重建。

## §4 config
state→category 映射 · `writer-actors` · urgent 阈值(==1)· triage 判据(无 entity / 未消费)· SNAPSHOT_FIELDS · 各 type 漂移阈值(沿用 Task 7)· `--as-of`。

## §5 边界(明确不做)
Coding Sessions / Diffs / Analytics / 通知运行时 / daemon / cloud。定位 = **工作状态的 git-native、可审、防漂移记忆与编译层**;执行/排期/通知留外部。

## §6 实现栈 + 顺序(PR 序)
8A/8P/8D/8C/8B/8E/8F = Python(`kb_meta.py`/`currency.py` 叠加 pass);8P/8B/8G 含 Node(`index.ts` stamping + capture hook)。
**PR1 8A**(state contract,不碰视图)→ **PR2 8P**(权威写入协议,脊柱)→ **PR3 8D**(triage)→ **PR4 8C**(relations)→ **PR5 8B**(properties)→ **PR6 8G**(agent 闭环)→ **PR7 8E/8F**(二期)。
