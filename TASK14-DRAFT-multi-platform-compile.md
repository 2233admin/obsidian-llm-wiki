# TASK 14（草案）— 多平台真值编译 + 漂移守卫：vault-mind 真值编译进任何 harness/IDE

> 状态：**DESIGNED（设计已评审通过，0 行代码，未建造）**。§5 的设计稿（office-hours Builder）已经过评审并 APPROVED，但那是**设计评审**的批准，不是"已建造"——14A/14B/14C 三片 PR 一行代码都还没写。来源蒸馏自 **Trellis**（mindfold-ai/Trellis，"the best agent harness"，11.3k★，docs.trytrellis.app 已读，2026-06-28）。**取概念丢运行时**：取「① 一份真值源 → N 个平台原生 agent-context 文件 ② template-hash 漂移守卫」，丢其 npm CLI（`@mindfoldhq/trellis`）、per-platform 生成器、16 平台 hook 运行时。
> 一句话：vault-mind 已是 Trellis 级 harness（spec 注入 / 任务工作流 / workspace 记忆 / verify 环 / 学到的回灌全有），**只差把真值 push 进各平台原生文件** —— MCP 是 pull，本任务补 push：current-truth/briefing 编译成 CLAUDE.md / AGENTS.md / .cursorrules / .codex / .opencode / .agents/skills，让任何 agent/IDE 不装 MCP 也吃到 vault-mind 真值。

## 0. 收敛验证（先讲清楚：Trellis 大部分 vault-mind 已有）

Trellis 自己的对比表列的能力，vault-mind 几乎全覆盖 —— 又一个 11.3k★ harness 独立撞上 Task 11 的同一循环，是**强验证不是新需求**：

| Trellis 概念 | vault-mind 已有 |
|---|---|
| 4 阶段循环 Plan→Implement→Verify→Finish | **T11 控制环**（discovery→generator→verification→persistence，§3/§5）|
| auto-inject specs（per-task、modular、precisely loaded）| **11G bootstrap briefing**（注 current-truth 切片）+ Task 5 inject |
| 任务工作流（prd + impl/review context + status）| **T8 work-OS**（state/review/kind + issue + blocked-by）|
| workspace journal（跨会话项目记忆，per-developer）| **T11H 持久 work-stream** + handoff/passport（per-actor）|
| check verify loop（diff vs spec + lint/test 自修）| **T11 C2 done-check + C3 grounding + 负反馈自修** |
| update-spec（学到的回灌 spec，下次更聪明）| **capture→promote + Karpathy outcome loop（11I，memclaw fold）** |
| git-versioned spec library；team-shared | **markdown 唯一真值 + git PR 闸**（vault-mind 全模型）|
| **16 平台多平台生成 + 漂移守卫** | **❌ 真缺口** —— vault-mind 只 MCP 单接口，无平台编译、无 hash 守卫 |

**结论**：完整内化 = 不重复造前 7 行（已有），只内化最后一行的 **2 个净新原语**。

## 1. §0 不变量（沿用 vault-mind 全局 §0）

1. markdown 唯一真值；平台文件 = **派生**（编译产物，单向真值→文件，可重建、字节稳定、永不回改源）。
2. **无运行时**：不引入 Trellis 的 npm CLI / 常驻 hook 进程 / per-platform 生成服务。编译 = 一次性 compile pass（挂现有 compile/scheduler，§0 #4）。
3. token/机器路径规则照旧；平台文件只含共享真值，不含机器路径。
4. **ADR（待定，见 §5）**：生成的平台文件 **git-tracked**（团队共享产物，像 Trellis 提交 CLAUDE.md）vs **gitignored**（机器派生）。与 §0「派生物不提交」张力 —— 由净新原语②（hash 守卫）化解。

## 2. 净新原语（只 2 样，其余复用）

1. **多平台 compile target**（取自 Trellis 多平台生成）：新 compile pass，把 **11G briefing 的注入载荷**（current-truth 切片 + 相关 spec/约束）经 per-platform adapter 格式化，emit 成各平台原生 agent-context 文件：
   - `CLAUDE.md` / `AGENTS.md`（最通用两个，先做）→ `.cursorrules` / `.codex` / `.opencode` / `.agents/skills/`（共享层）。
   - 载荷复用 11G（`work_driver.render_briefing`），**不另造注入逻辑**；adapter 只管格式 + 落点。MCP（pull）与平台文件（push）共享同一真值源。
2. **template-hash 漂移守卫**（取自 Trellis `.template-hashes.json`）：派生文件落进**用户仓库**（非 gitignored 机器层）时，记录每个生成文件的模板哈希；重生成前比对：
   - 本地哈希 == 记录 ⇒ 用户没改 ⇒ 安全覆盖。
   - 本地哈希 != 记录 ⇒ 用户改过 ⇒ 提示（覆盖/跳过）或按 `--force`/`--skip` 策略静默。
   - **这是 §0 #2 对「派生但用户可编辑」情形的精化**：vault-mind 现有派生物靠 gitignore + 字节稳定保证不冲突；落进仓库的派生文件（生成的 CLAUDE.md）需 hash 守卫防踩用户改动。存 `.vault-mind/.template-hashes.json`（机器层）。

## 3. 建造顺序（PR slices, TDD）

- **14A** `CLAUDE.md` + `AGENTS.md` 编译（最通用两平台，vault-mind 自己就有 CLAUDE.md）+ hash 守卫。绿条 1/2/4。**纯 Python，复用 11G briefing 载荷 + currency**。
- **14B** 加 `.cursorrules` / `.codex` / `.opencode` adapter（格式差异，载荷同源）。绿条 3。
- **14C** `.agents/skills/` 跨平台共享层（Trellis 的标准，任何读该目录的 agent 都吃到）。
- 先做 **14A**（payoff 最大、风险最低、纯复用 11G）。

## 4. 绿条（可测）

1. **编译确定性**：同一 current-truth → 同一 `CLAUDE.md`/`AGENTS.md`，两次运行字节一致；源不改。
2. **载荷正确**：生成文件含 11G briefing 的 current-truth 切片（state/blockers/required-reading），与 MCP `work briefing` 输出同源一致。
3. **多 adapter**：同载荷 → 各平台格式正确落点（CLAUDE.md vs .cursorrules vs AGENTS.md）。
4. **hash 守卫**：生成文件被用户改过（hash 不符）→ 重生成**提示/跳过**不静默覆盖；未改 → 安全重生成；`.template-hashes.json` 在机器层。
5. §0：无运行时；派生可重建；机器路径不进平台文件。
6. 回归闸：mcp-server `npm run build` + `node --test` 全绿；Python `test_currency_passes` + `test_project_currency` + 全量 discover 全绿。

## 5. Open questions（ADR）

- **生成平台文件 git-tracked vs gitignored**（§0 #4）。倾向 **git-tracked**（团队共享、可审、像 Trellis），由 hash 守卫 + 字节稳定 + 可从真值重建保证不踩改动 —— 但与 §0「派生物不提交」张力，需 ADR 明确（同 TASK12 core 的同款张力，可一并裁决）。
- 平台 hook（session-start/UserPromptSubmit）vault-mind 要不要也编译出？还是只出静态文件（prelude）？Trellis 两条都走（capable 平台用 hook，其余 prelude）。vault-mind §0 #4「无常驻」→ 优先静态文件 + 一次性 hook（如现有 capture-hook 模式）。
- 与 `mcp-server` 的关系：平台文件是 push 镜像，真值仍 MCP/markdown；冲突时真值赢，平台文件永远可重生。

## 6. 关联

[[vault-mind-currency-v1]] · Task 11G briefing（注入载荷复用）· Task 10（另一派生视图目标）· Task 11（Trellis 收敛验证的那个循环）· First-Tree（前一次同类收敛，T11 §11）· caura-memclaw fold（update-spec=outcome loop 已折）· Trellis（mindfold-ai/Trellis · docs.trytrellis.app，多平台 + `.template-hashes.json`）· TASK12 core（同款 tracked-vs-gitignore ADR）。

---

## 5. 设计稿（office-hours Builder，hardened 2026-06-28）

> 模式：Builder。Status：APPROVED（见 §5 末）。前提 P1-P4 已对齐。方案 A 入选。

### 5.1 Problem Statement
vault-mind 的真值现在只经 MCP 暴露（pull）—— 不接 MCP 的 agent/IDE（Cursor、Codex、opencode 原生模式）吃不到。Trellis 证明了把一份真值**编译成 N 个平台原生 agent-context 文件（push）**的价值。缺口 = vault-mind 没有这条 push 路径。

### 5.2 What Makes This Cool（whoa）
**"接上即有"**：任何 agent 在任何 IDE 打开仓库，它的原生上下文文件（CLAUDE.md / .cursorrules / AGENTS.md）**已经载着 vault-mind 的 live current-truth**，零 MCP 设置。打开 Cursor，`.cursorrules` 里就是你 vault 的当前真值切片 —— 不是死规则，是编译出来的活真值。

### 5.3 Constraints
§0（无 daemon、markdown 唯一真值、派生可重建/字节稳定/不回改源）。注入载荷复用 11G `render_briefing`，不另造。

### 5.4 Premises（已对齐）
- **P1** 真新只「多平台 compile + hash 漂移守卫」；Trellis 其余 vault-mind 已有，不重造。
- **P2** compile 复用 11G briefing 载荷（一个注入源）。
- **P3** §0 无 daemon：优先静态生成文件；一次性 hook 可以，不编译常驻 hook。
- **P4** open ADR（生成文件 tracked vs gitignored）是关键未决点；hash 守卫让 tracked 安全。

### 5.5 Approaches Considered
- **A（入选）最小静态编译 = 14A**：compile pass 只出 `CLAUDE.md`+`AGENTS.md`（11G 载荷），静态文件无 hook，hash 守卫，默认 gitignored。S/Low。80% 命中、风险最低。
- **B 全平台 adapter 编译**：`platform.py` adapter 层（仿 forge Transport）fan-out 到所有配置平台，生成文件 git-tracked（hash 守卫保安全）。L/Med。= 14A→14C 完整 arc，A 是其首片。
- **C 按需 export 命令**：`vault platform-export --target ...` 按需吐文件（pull），输出瞬态永不 tracked，绕开 ADR。M/Low。被否：丢了「接上即有」的 push 体验（5.2 的 whoa）。

### 5.6 Recommended Approach
**A 最小静态编译（14A）**。理由：最快兑现 5.2 的 whoa（CLAUDE.md/AGENTS.md 是大多数 agent 默认读的两个文件），纯复用 11G + compile + currency，§0 最稳（默认 gitignored 派生）。B 是后续 arc（14B/14C），不是 either/or。

### 5.7 Open Questions
- **ADR**：A 默认 gitignored（机器派生、§0 纯）；到 B（团队共享）时 revisit 成 git-tracked + hash 守卫。建议 A 阶段先 gitignored，B 阶段开 ADR 定 tracked。
- 注入新鲜度：静态文件在 compile 时刷；够不够？还是要一次性 SessionStart hook 刷（像 capture-hook）？A 阶段先静态（compile 时刷），观察够不够。
- 载荷裁剪：CLAUDE.md（agent 指令向）vs AGENTS.md（通用）该放 current-truth 的哪些切片？默认同 11G briefing（state/blockers/required-reading）。

### 5.8 Success Criteria
- 同一 current-truth → 同一 `CLAUDE.md`/`AGENTS.md`，两次运行字节一致；源不改。
- 生成文件载的 current-truth 切片与 MCP `work briefing` **同源一致**。
- hash 守卫：用户改过生成文件（hash 不符）→ 重生成提示/跳过不静默覆盖。
- 回归闸（Python currency + 全量 discover；若动 TS 则 mcp-server build+test）全绿。

### 5.9 Distribution Plan
无独立分发 —— 生成物（CLAUDE.md/AGENTS.md）就是用户仓库里的文件，随 vault-mind 编译器走。deliverable = 仓库内文件，非 npm 包/二进制。

### 5.10 Next Steps（14A 建造）
1. 新 compile pass（`kb_meta.py`/`compile.py`）：调 `work_driver.render_briefing` 取载荷 → per-platform 格式化器 emit `CLAUDE.md`+`AGENTS.md`。
2. hash 守卫：`.vault-mind/.template-hashes.json` 记每个生成文件模板哈希，重生成前比对。
3. TDD：字节稳定 / 载荷与 `work briefing` parity / hash 守卫 prompt-or-skip / 默认 gitignored。
4. 回归闸 → commit。

### 5.11 What I noticed（这次会话的思考方式）
- 你这次的模式 = 系统性把前沿仓库（TrustGraph→T12、caura-memclaw→fold、Trellis→T14）一个个喂进来、要求"完整内化" —— 在把工业最前沿小高峰持续收割进 vault-mind，不是零散借鉴。
- 你在我要直接落 TASK14 时打断说"先看文档" —— 宁可慢一步读真 docs 也不要凭 README 拍草案。**rigor over speed**，这跟你 §0 "markdown 唯一真值/不拍脑袋" 一脉。
- 收敛验证你接受得很快（Trellis ~80% 已有不重造）—— 不为"内化"而堆功能，只取真差异。

### 5.12 Reviewer note（inline adversarial，非 subagent）
- **风险1**：CLAUDE.md 已存在（vault-mind 自己的 CLAUDE.md 是手写的）—— 编译生成会撞名。**缓解**：生成到带标记的区块（`<!-- vault-mind:auto -->...<!-- /vault-mind:auto -->`）只刷该区块，或生成 `CLAUDE.local.md`；hash 守卫只盖自己的区块。**14A 必须先解决这个撞名**，否则踩用户手写 CLAUDE.md。
- **风险2**：载荷新鲜度 —— 静态文件在 compile 时刷，agent 若不重编译就读到旧真值。A 阶段可接受（observe），但要在文件头戳 `generated-at` + current-truth HEAD,让 agent 看得到新鲜度。

**Status：APPROVED**（用户批准见下一步 AUQ）—— 此处 APPROVED 指**设计评审通过**，非"已建造"；14A 尚无一行代码，整份文档的顶层状态见 §开头 DESIGNED。
