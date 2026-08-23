# TASK 11 — Work Driver / 执行闭环 (DRAFT, spec for TDD)

> 从 `TASK11-GRILL-BRIEF.md` 收敛而来的正式 draft。北极星 + §0 映射 + 原语 + **可测绿条**(TDD 目标)+ 建造顺序。
> 来源融合:opentag(执行管线)、Loop Engineering playbook(Steinberger/Cherny/Osmani,6 件套)、钱学森《工程控制论》(闭环负反馈)、Thom Wolf gemma-challenge(100+ agent 协作涌现)。**全部取概念、丢运行时**。

## 1. North star

vault-mind 到「真值正确且可查」就停了 = **被动层**。Task 11 补一个**薄 driver**,闭合到「所以 agent 去把活干了」:读 work-OS authoritative 真值 → 挑下一可执行项 → 锁定签出 → 拉 agent 干 → 结果经闭环控制回 vault。**单 agent driver = 单元;多个 driver 共享一个 vault work-OS = 多 agent 协作底座**(Thom Wolf 那场涌现的就是这个)。

## 2. §0 不变量(不可破,除非 ADR 明确放宽)

1. markdown 唯一真值;派生物永不是源
2. 派生物 gitignore / 可重建 / 永不回改源 / 字节稳定
3. promote 走**控制律**:高 grounding 自动闭环 / 低 grounding/冲突升级人审 PR 闸(ADR 0005 + 0006 修订)
4. **无 runtime / daemon / webhook / cloud**:心跳 = cron/ScheduleWakeup **一次性** CLI,跑完退
5. token 只从 env,只进 header,错误路径不外泄
6. 机器路径只进 gitignored `.vault-mind/`,绝不进共享/提交内容
7. **无隐藏侧信道**:所有协作经 capture→promote,全可审(Thom Wolf 反勾结:private side-channel = 勾结)

## 3. 脊柱:闭环负反馈(控制论)

```
discovery(选下一可执行项) → handoff(worktree 隔离) → generator(agent 干)
   → verification(测输出 = 反馈传感器)→ 比设定值(reference)→ 误差 e
   → 控制器据 e 作动:{ 自动 promote | 回灌 generator 自校正 | 升级人审 }
   → persistence(capture→promote)→ scheduling(下一拍 cron)
```

- 核心 = **负反馈自校正回路**(误差回灌 generator → 改 → 再测 → 收敛),不是 pass/fail 分类器。
- 人审 = **高误差/不收敛(限 N 次)时的升级路径**,不是默认沉淀池。
- reference:C2 = done-check;C3 = grounding 置信阈值。

## 4. Run Output Class + Promotion Policy(ADR 0005)

| 类 | 产出 | 回仓 |
|---|---|---|
| C1 视图 | compile 出 canvas/status | 永远(是 compile 非 promote,§0 #2) |
| C2 工作态迁移 | `state` todo→done | done-check 过 → 自动 promote |
| C3 知识声明 | 关于 entity 的 fact/decision/supersedes | 控制律(下) |
| C4 外部副作用 | 真 push/开 PR/发线程 | 显式人批,缓做(路 B/后续) |

## 5. 控制律

### C2(work-state)
- reference = work item 自带 `done-check: <shell>`(exit 0 = 过)。evaluator 在 worktree 跑它。
- **显著性闸(Thom Wolf)**:若 done 判据是指标(TPS/耗时/覆盖率),提升必须 **超噪声 σ**(多次跑取方差)才算改进;delta < 阈值 = 平局,不 promote 为「更好」。
- 没 done-check 的 item → 不够格自动 → 落 triage 人审。

### C3(knowledge claim)— evaluator = 准入过滤 + 情境化主动核查
- 廉价内层信号 `s = grounding-confidence`:source-support / consensus(**真·异构模型,opencli 调 grok/chatgpt/gemini,破相关盲区**)/ consistency(无未声明冲突)/ anchored(有 entity)。
- **情境化主动交叉核查(根据具体情况花外部核查,非每条非永不)**:当 ① 声明要被复用作 grounding / ② s 模糊 / ③ 高风险或撞现有真值 / ④ 久未核 → 触发 `opencli` 搜真实数据 + 异构 AI 交叉分析降幻觉 → 重测。
- 过 → promote,**同等 grounding**(不静态贬低机器输出);不过 → 升级人审。
- **复用即重验** 堵 Thom Wolf 的「错误传播复合」(已 promote 真值当新 grounding 致指数放大)。
- **drift 传感器(控制论可观测性)**:监测 escalation-rate + 一致性漂移(embedding 相似度/fact-consistency);沉默失败靠这层抓。

### 甲纪律 = 增益整定(rollout)
初始增益低(阈值高、自动 promote 默认关、全升级)→ 观测误差长期低 → 逐路调高增益/降升级阈值。「确立」= 控制器被信任、自动闭环份额边长。

## 6. Loop Engineering 6 件套 → 原语(opentag 内化)

| 件套 | vault-mind 落法 | opentag 对应 |
|---|---|---|
| Automations 心跳 | `vault-mind work next` cron/ScheduleWakeup 一次性(§0 #4) | ingress(改 pull 非 webhook) |
| Worktrees 隔离 | 每 Work Run 一 git worktree(repo 已有 `.worktrees/`) | runner 隔离 |
| Skills 意图 | 工作类型指令进 skill | — |
| Connectors | **知识 IN**=opencli 搜/调 AI(§0 安全) / **副作用 OUT**=C4(缓做) | callback/ingress |
| Sub-agents 生成/评判 | generator + 独立 skeptic evaluator | executor |
| State/Memory | **vault 本身**(capture→promote) | dispatcher 持久化 |

opentag dispatcher 的 **scope 校验 + lease + audit** → 分别落:选活(读 authoritative)+ `claimed-by` 租约(base-head 锁当上锁)+ capture→promote append-only 审计。

## 7. 多 agent 协作支持(Thom Wolf 涌现行为 → 原语)

- **公共知识库**:共享 current-truth + 编译视图(免重复死胡同)。
- **反勾结**:§0 #7 无侧信道,全经 capture→promote 可审。
- **验证漏洞 → 社区/人裁决**:C3 flag → triage Conflicts。
- **四代理接力(build/run/diagnose/deliver)**:work-OS 状态机 + lease 交接 + blocked-by。
- **配额池化**:lease + budget ledger —— 配额上限**催生协作**(语义升级:不只安全闸)。
- **发现-反转-命名**:supersession + entity 锚(currency 层)。
- **显著性规范**:见 §5 C2 显著性闸。

## 7b. First-Tree 内化:团队上下文注入 + 持久工作流(用户点名要实做)

不止借鉴,这两件要实做:

**(A) 给所有 agent 相同团队上下文 —— 吸收原 brief Task 5 inject**
每个 Work Run **开工前注入**编译过的 authoritative current-truth(相关切片)→ 无冷启、所有 agent 共享同一团队真值。§0 安全:注入的是只读编译产物(C1 视图),不回改源、可重建。这把 First-Tree 的「Context Tree 读前置」做成 vault-mind 的注入步。

**(B) 在持久聊天中续 agent 工作 —— 仓内持久 work-stream**
每个 work item 带一条 **append-only work-stream = 运行/消息历史**(仓内 markdown capture log,**不是 daemon session**)。新 run **从它续**不冷启;支持跨 agent / 跨调用接力(Thom Wolf 四代理 build→run→diagnose→deliver 续上同一流)。First-Tree 用 DB+web,vault-mind 用仓内 append-only markdown —— 同概念、无运行时(§0 #4)。

**(C) 从 First-Tree 代码挖到的具体落法(clone 在 `D:\projects\_reference\first-tree`)**

- **11H 三表 → 仓内三件**(它 Postgres,我们 markdown):`chats`(一任务一容器)= work-stream note;`messages`(**不可变** UUID v7 + `in_reply_to` 线程)= append-only capture log(本就 §0 #2);`agent_chat_sessions`(serialized state + runtime_state `idle|working|blocked|error`)= work item frontmatter 的 runtime_state + lease,**无 DB**。
- **11H resume 三态**(抄):cold start(全史 + briefing)/ warm(反序列化 state → resume)/ cold-resume(丢快照 → 重放全史)。
- **11G 注入 = bootstrap briefing**(抄):开工生成 AGENTS.md 式 briefing,注入 current-truth 切片 + read/write skill payload + "Required Reading"。**只在 bootstrap 注、不中途刷**(cache-friendly)→ **重审原 Task 5 的「周期重注入」,默认改 bootstrap-only**。
- **Double Test(抄 capture 准入规则)**:写进 current-truth 前过两问 —— ① 确立一条未来 agent **必须遵守**的东西吗?② 源 PR 被重写它还成立吗?都 yes 才进 truth,否则留 work-stream。→ 精化 C2(工作态留流)vs C3(知识声明进真值)边界。
- **NHA 教训(第四次趋同)**:First-Tree 把硬编码审查闸(Need-Human-Attention)**整删 —— 太僵硬**,改 git PR → 人审 → merge → re-pull。= §0 #3 + ADR 0006 的情境化/规则化,**别建僵硬审查闸**。
- **审计分层(抄)**:`context_tree_io_events`(读写审计,**持久**)vs `session-events`(**可逐出**)。对 vault:真值审计持久、运行态可丢。

## 7c. 内化(caura-memclaw):outcome-memory 反馈环(唯一真缺口)

caura-memclaw(caura-ai/caura-memclaw,2026-06-28 抓取)杀手概念 = **自改进记忆**:agent 用完一条 recall 的记忆后**报 outcome(成功/失败)**→ 系统强化「真帮上忙」的、失败时**自动生成预防性 `rule` 记忆**。取概念丢运行时(它 Postgres + 多租户;我们 capture→promote)。

**这是 Task 11 唯一真缺口**:§5 控制律量了 C2(work-state done-check)与 C3(声明**写入时**的 grounding),却**从不回灌「这条已 promote 的真值,被 agent 取用后到底有没有帮上活」**。Karpathy loop 把 §3 的负反馈从「写入闸」延伸到「**取用后效**」—— 记忆质量本身进入闭环。

§0 兼容做法:
- **outcome = 一条 capture**:work run 结束,driver 对本 run 经 11G **注入过的 current-truth 切片**逐条标 `recall-outcome: helped|misled|unused`(+ run id),走 capture→promote,§0 #7 全可审、无侧信道。
- **强化 = grounding 信号增项**:§5 C3 的 `s` 加一维 `recall-track-record`(历史 helped/misled 比),长期 misled 的真值**降权 + 标复核候选**(不删,§0 #2)。
- **失败自动生成 `rule`**:run 失败且归因到某条 misled 真值 → 生成一条 `type: rule` draft candidate(「下次别信 X / 先验 Y」)落 _triage,**经 promote 闸**才成真值(不自动写源)。
- 喂 §5 drift 传感器:misled-rate = 新的可观测漂移信号。

落点:**11I** 建造序;复用 11G 注入清单(知道这条 run 取了哪些)+ capture→promote + §5 控制律。**纯概念叠加,不引运行时,§8「只 3 样原语」不变。**

## 8. 净新原语(只 3 样,其余复用)

1. **loop trigger**:cron/ScheduleWakeup 触发一次性 `vault-mind work next`,幂等,跑完退。
2. **budget/quota ledger**:work note 一行 token/配额账;spawn 前硬停;配额上限催协作(公开候选 + 归功发起者)。
3. **lease(`claimed-by`)**:领取即写 capture,promote 即上锁(base-head HEAD_MISMATCH 防双领);**TTL + 过期回收**(防 agent 崩了死锁)。

## 9. 绿条(TDD 目标,可测断言)

1. `vault-mind work next` 选下一可执行项**确定性**(同真值→同选择,字节稳定)。
2. lease:两并发 trigger 只一个领到(`HEAD_MISMATCH` 验证);lease TTL 过期可被回收。
3. budget:ledger 到阈值,spawn **前**退出,绝不超支。
4. C2 done-check:exit0 才 promote;指标类提升 < σ 阈值 = 平局不 promote。
5. C3:s 低/冲突 → 落 triage 不自动 promote;s 高 + 情境核查过 → 自动 promote;**机器 promote 的真值复用作 grounding 前必重验**。
6. drift 传感器:escalation-rate / 一致性漂移可读出。
7. 全程 §0:无常驻进程;派生物字节稳定;机器路径不进共享 md;无侧信道(全经 capture→promote)。
7b. **团队上下文注入**:同一时刻不同 agent 拿到的注入 current-truth 切片**一致**(字节稳定);注入只读、不回改源。
7c. **持久 work-stream**:第 N+1 run 读到前 N run 的 work-stream **续上**;work-stream append-only,promote 只经闸。
7d. **outcome-memory 反馈环**(内化 caura-memclaw):run 末对注入切片标 `recall-outcome`(capture→promote);长期 `misled` 真值 grounding 降权 + 进复核候选;失败归因生成 `type:rule` draft 落 _triage(不自动写源);misled-rate 可从 drift 传感器读出。
8. 回归闸:`test_currency_passes` + `test_project_currency` + 全量 discover 全绿(HANDOFF §5,不信子 agent 窄命令)。

## 10. 建造顺序(PR slices, TDD)

- **11A** loop trigger + `work next` 选活(确定性)+ lease 上锁(绿条 1/2)
- **11B** budget/quota ledger(绿条 3)
- **11C** C2 done-check + 显著性闸 + 自动 promote(绿条 4)
- **11D** C3 grounding 信号 + 情境化 opencli 交叉核查 + 复用重验(绿条 5)
- **11E** drift 传感器 + 视图(绿条 6)
- **11F** worktree handoff 生命周期 + 清理
- **11G** 团队上下文注入(吸收 Task 5):每 run 开工注入 current-truth 切片(绿条 7b;只读不回改)
- **11H** 持久 work-stream:work item append-only 运行历史,新 run 续接(绿条 7c;跨 agent 接力)
- **11I** outcome-memory 反馈环(内化 caura-memclaw):recall-outcome 回灌 grounding + 失败生成 `type:rule`(绿条 7d;复用 11G 注入清单 + §5 控制律)
- 全程守 §0 + 回归闸(绿条 7/8)。每 slice:TDD 红→绿→重构;多 agent Workflow build→3 棱镜对抗 verify→我跑回归闸→commit。

## 11. 收敛的同类工作 / 定位

三家独立设计**都撞上同一命题**(读前/写后的团队上下文闭环 + 规则化人介入)= 强验证 vault-mind 核心对:

- **Anthropic Loop Engineering**:triage-inbox fallback(搞不定才人审)。
- **Thom Wolf gemma-challenge**:100+ agent 涌现的公共知识库 + 自监管 + 配额池化。
- **First-Tree**(agent-team-foundation):Context Tree(git-native 团队记忆:决策/归属/约束)+ context loop;human「只在规则说该介入时」介入。

**关键差异 = 定位**:opentag / First-Tree 把这套做成 **daemon + DB + web 运行时**;vault-mind 做成 **headless / git-native / 无运行时**(§0 #4)。同一 loop,取概念丢运行时。vault-mind 差异化 = **no-runtime、markdown 唯一真值、全可审无侧信道**。

---
**关联**:[[vault-mind-currency-v1]] · ADR 0005(promotion policy)· ADR 0006(闭环 + C3 控制律,改 §0 #3)· `TASK11-GRILL-BRIEF.md`(拷问全程)。
