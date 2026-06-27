# TASK 11 — work driver / 执行闭环：拷问素材(grill seed)

> 喂给 `/grill-with-docs` 的开口素材。目标:把这堆**模糊点**拷问成一份 `TASK11-DRAFT-work-driver.md`(定 §0 映射 / 原语映射 / 绿条)。
> 不是结论,是**待钉死的问题清单**。grill 的活就是把下面每个 ❓ 逼出可执行答案。

## 0. 一句话 north star

vault-mind 现在到「真值正确且可查」就停了 —— **被动层**,从不闭合到「所以 agent 去把活干了」。
Task 11 = 补一个**薄 driver**:读 work-OS authoritative 真值 → 挑下一可执行项 → 锁定签出 → 拉起 agent → 结果 capture → token 记账。**取概念,丢运行时**(同 lumen-light / paperclip 的处理法)。

## 1. 缺口 vs 已有(不是重写)

| 能力 | 现状 |
|---|---|
| 原子签出 | ✅ 现成 base-head 乐观锁(`HEAD_MISMATCH`,绝不 last-write-wins) |
| 持久记忆 | ✅ vault 本身 + 原 brief Task 5 inject |
| 结果写回 | ✅ capture → promote 链 |
| **loop trigger** | ❌ 净新 |
| **budget ledger** | ❌ 净新 |
| **lease(claimed-by)** | ❌ 净新 |

净新只 3 样。其余是接线,不是造轮子。

## 2. opentag 契约 → vault-mind 原语映射(参考源,丢其 daemon/SQLite/Drizzle)

opentag pipeline = `ingress(@mention→work request) → dispatcher(scope校验+持久run+lease+audit) → runner(只领绑定的活) → executor(Claude Code/Codex/custom) → callback(结果回线程+audit)`。

| opentag | vault-mind 落法 | §0 张力 |
|---|---|---|
| ingress `@mention→work request` | **§0 #4 禁 webhook/daemon** → 改 cron/ScheduleWakeup 拉一次 `vault-mind work next`,跑完退 | 直接冲突,必须改成 pull |
| dispatcher: validate scope | 读 work-OS authoritative,挑未 blocked + priority 项 | ok |
| dispatcher: persist runs | run 记成 work note(capture) | ok |
| dispatcher: **lease** | 净新 `claimed-by` 租约,上锁机制复用 base-head 锁 | ok |
| dispatcher: audit | capture→promote 本就是 append-only 审计 | ok |
| runner: claim only bound work | lease + `effective_state` 派生(未 blocked 才可领) | ok |
| executor: Claude Code/Codex/custom | spawn agent(已有概念);**复用 opentag custom-executor schema?还是只取形?** | ❓ |
| callback: result→thread | 结果 capture → promote 写回真值 | ⚠️ 见 ❓9 |

**opentag 缺 Gitea adapter**(只 GitHub/Slack),用户真实 forge = `git.xart.top` gitea(Task 9 forge.py 才有)。

## 3. 路 A vs 路 B(grill 要逼用户二选一或划界)

- **路 A(概念入,运行时丢 —— 守 §0 #4)**:opentag 的 work-request schema + dispatcher/lease/audit 契约当设计源,重写成一次性 CLI。无常驻。**推荐默认**。
- **路 B(opentag 当独立 sidecar 执行层 —— 自觉破 §0 #4)**:仅当真要 GitHub/Slack 线程实时 @agent。daemon 当**有意例外**,只限执行层,compiler 保持纯。需自己补 gitea ingress。

## 4. §0 不变量(约束,不可破 —— 除非 grill 明确决定放宽并记 ADR)

1. markdown 唯一真值;派生物永不是源
2. 派生物 gitignore / 可重建 / 永不回改源 / 字节稳定
3. **promote 只经 git PR 闸;dry-run 默认** ← 和「自动执行闭环」最冲(见 ❓9)
4. **无 runtime / daemon / webhook / cloud / 新 LLM 服务** ← 和 opentag 本体最冲
5. token 只从 env,只进 header,错误路径不外泄
6. 机器路径只进 gitignored `.vault-mind/`,绝不进共享/提交内容

## 5. 必须拷问的 ❓(虚点 —— grill 重火力打这里)

1. **❓冲突语义**:两 trigger/agent 同时领同一 work?base-head 锁够不够?lease **过期**怎么算(agent 崩了 lease 不释放→死锁)?TTL?谁回收?
2. **❓预算语义**(HANDOFF 点名最虚):token ledger 一行账在哪个 note?谁扣、何时扣?spawn 前硬停的精确边界?**预算池 = per-run / per-project / 全局**?耗尽时排队 vs 丢弃?
3. **❓触发语义**:`vault-mind work next` 跑**一个**就退 vs 跑到没活?幂等?多 trigger 并发撞车靠 lease 防?cron 间隔?
4. **❓选活策略**:priority + 未 blocked + assignee —— `assignee` 怎么落到**具体 agent**?多 agent 谁领同一项?
5. **❓路 A/B 终局**:纯 CLI 够用,还是真要线程实时?若 B,daemon 例外的隔离边界画在哪?
6. **❓executor 契约**:复用 opentag custom-executor contract,还是只取 schema 自己实现 spawn?
7. **❓失败/重试**:executor 失败,run 状态怎么回写?重试 N 次 vs 标 `canceled`?幂等重入?
8. **❓【最大冲突】结果写回 vs §0 #3**:执行闭环要**自动 promote** 结果?那破了「promote 只走人审 PR 闸」。
   - 选项 a:结果只落 `_triage` candidate,**永不自动 promote**,人审后才进真值(守 §0 #3,但闭环不全自动)。
   - 选项 b:某类低风险 run 自动 promote,定义「低风险」白名单 + ADR 记放宽。
   - 这是 Task 11 的**命门**,grill 必须钉死。

## 6. 绿条候选(draft 里要变成可测断言)

- `vault-mind work next` 选出下一可执行项,**确定性**(同真值 → 同选择,字节稳定)。
- lease 上锁:两并发 trigger 只一个领到(`HEAD_MISMATCH` 验证)。
- 预算硬停:ledger 到阈值,spawn **前**退出,绝不超支。
- 结果 capture 落 `_triage`,**默认不自动 promote**(守 §0 #3)—— 除非 ❓8 决定放宽。
- 全程 §0 #4:无常驻进程,只 cron/ScheduleWakeup 一次性 CLI,跑完退。

## 8. Loop Engineering playbook 映射(Steinberger/Cherny/Osmani)

参考源:[Addy Osmani — Loop Engineering](https://addyosmani.com/blog/loop-engineering/) · [O'Reilly Radar](https://www.oreilly.com/radar/loop-engineering/)。
核心论点:**「别再 prompt agent,设计一个自己 prompt 自己的系统」**。生成几乎免费,**判断成了稀缺资源**。**取形不取魂**:收它的结构,每件套换 vault-mind 的 §0 约束实现(同 lumen-light/paperclip/opentag 的「取概念丢运行时」)。

**5 动作**:discovery → handoff → verification → persistence → scheduling。

**6 件套 → vault-mind 落法**:

| playbook 零件 | Task 11 落法 | 状态 |
|---|---|---|
| Automations(心跳) | `vault-mind work next` 经 cron/ScheduleWakeup **一次性**触发(非常驻) | ✅ 守 §0 #4 |
| Worktrees(隔离) | 每个 Work Run 一个 git worktree(repo 已有 `.worktrees/`) | 🆕 **新原语,draft 要加** |
| Skills(意图上盘) | 工作类型指令写进 skill;「agent 每轮冷启会瞎猜填补意图空洞」 | ✅ skill 富 |
| Connectors(MCP) | = **C4 外部副作用**(开 PR/发线程);paper 默认无人 push → **撞 §0 #3/#4** | ⏸ 缓做(路B/Task12) |
| Sub-agents(生成/评判分离) | = **「确立」判定机制**(见下) | 🆕 **新原语,draft 要加** |
| State/Memory(repo 不忘) | **vault 本身**(capture→promote)—— 这就是 vault-mind 立身之本 | ✅ 完美对齐 |

**命门 = Generator/Evaluator 分离**:「写代码的模型给自己批作业太手软」。独立 skeptic evaluator 判「done」,比让 generator 自我批判**容易得多**。`/goal` 机制 = 每回合后一个**独立小模型**查**可验证停止条件**(如「test/auth 全绿且 lint 干净」)成立才停。**「done 是声明,不是证明。」**

**三个失败模式(loop 越快越严重,Task 11 要防)**:① verification rot(无人值守=无人值守犯错)② comprehension debt(ship 你没写的越快,「存在的」vs「你懂的」差距越大)③ cognitive surrender(懒得有意见,给啥要啥)。收尾纪律:**「build it like someone who intends to stay the engineer, not just the person who presses go.」**

### 「撞它的设计」= 趋同验证,不是重造

两条独立的路(你的 §0 反漂移 + Anthropic 工程实践)走到同一 fallback(搞不定→triage inbox 人审)= 强信号这答案对。vault-mind 6 件套**已有 4 件**(state/skills/connectors=Task9/automations 概念),paper 只补 2 件显式原语(worktree handoff + generator/evaluator)。

### 甲/乙的化解:乙机制 + 甲纪律(两层,不是二选一)

- **乙(逐 run 资格闸)= 机制**:loop 本就逐 Work Run 跑,每个 run 由**独立 evaluator** 判可验证停止条件 → 过了才够格 C2 自动 promote。
- **甲(建造分期)= 推出纪律**:evaluator 未被信任前,它判的「过」也**先落 triage**(A);信任建立(=「确立」)后才放它直接自动 promote。
- → 用**乙的机制 + 甲的纪律推出**,正是 playbook「stay the engineer」的活法。

### OpenCLI = 知识获取 Connector(跨项目定死,见 memory feedback-opencli-external-knowledge)

playbook 的 Connectors 件套不止 C4 forge/出仓,**更含「知识 IN」**:遇到模糊 / context+训练数据缺口,用自研 **`opencli`**(npm 全局 v1.8.4,205 site adapter)读外部知识 —— **一次性 CLI 调用,守 §0 #4**(非 daemon):

- 调异构 AI:`opencli grok ask "<prompt>" -f md`(同形 `chatgpt|gemini|deepseek|kimi|qwen`),浏览器驱动真实登录会话。
- 搜索:`opencli google|duckduckgo|brave` + 垂直 `arxiv|google-scholar|pubmed|github|eastmoney`。

**直接补强 C3 grounding 控制律的两路信号**(解我之前标红的「同族 evaluator 共享盲区/相关性误差」):

- **consensus** 升级:不再是 K 个**同族** sub-agent,而是经 opencli 调 **grok/chatgpt/gemini/deepseek 真·异构模型**交叉判 → 破盲区,grounding 信号才硬,更多 C3 声明能安全自动闭环(= 超越 paper 把 C3 甩 triage 的开环尾巴)。
- **source-support** 升级:evaluator 可经 opencli 重取被引 source / 问另一 AI「这条声明被 X 支持吗」,而非只信自己。

→ Connectors 拆成两向:**知识 IN(opencli 搜/调 AI,读,§0 安全)** vs **副作用 OUT(C4 真 push/开 PR,写,缓做)**。

### 异构交叉验证实测(grok 实跑,2026-06-27)→ C3 控制律加固

经 `opencli grok ask` 真调 grok(异构模型)交叉验证 C3 控制律,坐实并补出风险,**3 条进 draft 硬约束**:

1. **错误传播与复合(新,之前漏)**:agent 拿已 auto-promote 的「真理」当新 source-grounding → 闭环里幻觉**指数放大**。对策**不是**把机器真值打成永久低信任层(静态不信任 = 开环偷懒);**而是根据具体情况主动交叉验证**:当一条 C3 声明 ① 要被复用作 grounding / ② 信号模糊 / ③ 高风险或撞现有真值 / ④ 久未核 时 → **触发 opencli 搜真实数据 + 调异构 AI 交叉分析降幻觉** → 重测 → 过了就**同等 grounding**,不过才升级人工。控制器**按情况花**这笔外部核查(不是每条都跑、也不是永不跑)= 用户说的「根据实际情况查数据」。**复用即重验**堵住静默复合,而非靠贬低机器输出。
2. **drift 传感器 = 控制论可观测性**:loop 必须装 escalation-rate + 一致性漂移监测(embedding 相似度 / fact-consistency check)。钱学森「只能控你能测的」—— 无传感器的闭环是盲的。沉默失败(plausible 过检、无 alert)靠这层抓。
3. **consensus 别过信(加固原信号)**:高共识可能是**相关偏差/集体幻觉**(文献:模型互相「social prediction」反而强化 shared misconception)。所以 consensus 要真·去相关模型 + 混 **外部实时 API/规则引擎锚**(opencli 搜索),不靠纯多模型投票。
4. 已有不重复:versioned memory + rollback(git/supersession)、抽取与真值库解耦(capture vs promote)、human 作最终权威 —— vault-mind 本就具备。

> 工具备注:`opencli <site> ask` 在部分 adapter(qwen/chatgpt 实测)**提前返回**只给开场白,grok 完整。绕过:跟一条 `opencli <site> read` 取完成态,或用返回完整的 adapter。记入 opencli 待修。

### 待 grill 钉死(承 §5 ❓,被 playbook 重置)

- **❓evaluator 的「可验证停止条件」对 C2/C3 各长啥样?**(C2 工作态:done-criterion 可机器跑;C3 知识声明:真值不可机器证 → evaluator 只能当 triage 质量过滤,**人仍是裁判**)
- worktree handoff:每 run 一 worktree 的生命周期 / 清理 / 与 base-head 锁的关系
- generator/evaluator 用哪两个 agent、model/effort 怎么配

## 7. 构建 cadence(沿用 HANDOFF §5)

TASK11-DRAFT 定稿 → 多 agent Workflow(build 顺序 → 3 棱镜对抗 verify 并行 → fix)→ 我自己跑回归闸(`test_currency_passes` + `test_project_currency` + 全量 discover,**不信子 agent 窄命令**)→ commit。
