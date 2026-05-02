# Retrieval Gold Candidates — Claude 人工预筛

**生成**: 2026-04-25, 从 310 条机器抓取候选里挑 30 条
**任务**: 下面 30 个问题都是 Curry 真实问过的（语气、entity、对话脉络都符合）。
每个配了推荐 gold docs（从 MEMORY.md 索引反推），按 retrieval 风格分 3 组。
你的活: 过一遍，**接受/拒绝/修改 gold list**，产出 `retrieval-gold.jsonl`。

## 分组依据

- **entity-explicit** (10): 问题里有明确 project/tool 名。filesystem grep 应该赢。
- **concept-implicit** (10): 实体隐含，需要理解语义。vector/semantic 应该赢。
- **hybrid** (10): 实体 + 概念混合。RRF 融合应该赢。

如果这组 30 在真实 vault 上**看不到上述 expected pattern**，说明你的 vault 跟"通用 RAG benchmark"不同，triage 需要按你的 pattern 重订。

---

## Group A: entity-explicit (10)

```
1. q: "这个 我们gitea不能备份吗?"
   gold: gitea.md, backup-strategy.md
   why: Direct entities "gitea" + "备份"

2. q: "Gitea 跟 /volume1/K-project/backups/duckdb/ 本身就都在NAS山 我感觉备份两份是没问题 但是gitea 你不是更好用?"
   gold: gitea.md, nas-services-2026-03.md, backup-strategy.md
   why: 多实体 entity, 路径也可 grep

3. q: "astrbot dashboard 上 X.R 这个 platform 显示在线？"
   gold: nas_astrbot_napcat.md
   why: entity "astrbot" + "X.R"

4. q: "3 个 mission 是不同 project 还是同 team 下 label？"
   gold: project_mission_ops.md, project_mission_ops_runbook.md
   why: entity "mission" 是 MEMORY.md 里明确项目

5. q: "为什么这个持有期 + A 股场景适合 Mamba？"
   gold: project_p_risk_pipeline.md, quant_daily_pipeline.md
   why: "A 股" + "Mamba" 是 quant 上下文

6. q: "还有个问题 .claude 文件 或者告诉你是clade同志的文件你备份gitea了吗 为什么我找不到 备份下?"
   gold: gitea.md, backup-strategy.md
   why: "备份" + "gitea" + ".claude"

7. q: "我们本地文字语音识别用的什么模型 HMC文件夹在哪儿?"
   gold: project_fish_speech.md
   why: "语音识别" + "HMC" specific entities

8. q: "能不能直接改 TradingView的收藏夹 ?"
   gold: project_ai_trading_loop.md
   why: "TradingView" entity

9. q: "Windows ML stack 那就 3.12 但是其他代码开发 是可以用 3.13吧?"
   gold: python-toolkit.md, pitfall_windows_clipboard_encoding.md
   why: Python 版本 + Windows 明确

10. q: "为啥obsidian 不能直接自动搞 一定得N8N?"
    gold: project_n8n_nas.md, feedback_obsidian_path.md
    why: "obsidian" + "N8N" double entity
```

## Group B: concept-implicit (10)

```
11. q: "也就是说,Sprachwelt 相对于'裸 LLM 对话'到底好在哪,是用什么东西测的?"
    gold: project_sprachwelt_strategy.md, feedback_sprachwelt_infrastructure.md, project_sprachwelt_memory_arch.md
    why: 表面有 Sprachwelt 实体但真问题是"eval metric/测量方法"—需要语义

12. q: "obsidian 先收口了 我觉得记忆系统得更新调整研究下?"
    gold: project_memu_reactivate.md, project_memory_executor_infra_2026_04_24.md, feedback_memory_architecture.md
    why: "记忆系统"是统称，要 map 到多个具体项目

13. q: "如果是你有什么建议你能做你会怎么做"
    gold: feedback_capabilities_first_prompting.md
    why: 纯 meta-prompt, 需要理解这是 Curry 的惯用 capabilities-first 提问

14. q: "OpenViking 早删掉了 为什么每次都复活 3. memU 和 memorix 的边界：都能 store/search，什么情况走哪个？"
    gold: project_memu_migration.md, project_memu_reactivate.md, project_sprachwelt_memory_arch.md
    why: 边界问题 = 需要 compare/contrast semantic

15. q: "纯粹好奇能不能搞 还有什么 HUD能开的 另外表情能开就开 windios的问题我们修好了"
    gold: MEMORY.md 里 HUD 相关 + pitfall_windows_clipboard_encoding.md
    why: "HUD" 抽象 + "windios 问题" 需要理解是 Windows 编码坑

16. q: "你觉得还缺什么 SN是什么功能平常就看 5H WK SN 不常看"
    gold: feedback_capabilities_first_prompting.md + (HUD?)
    why: "SN/5H/WK" 是 HUD 缩写, 需要语义推

17. q: "还有什么skiil 可以在 cli里面画图 我记得还有个K线的"
    gold: reference_skill_index.md, feedback_skill_usage_protocol.md
    why: 需要 retrieve "cli-charts"/"K线" skill 元信息

18. q: "那我们这个东西算skiil 还是hook?"
    gold: project_hook_infrastructure.md, feedback_skill_usage_protocol.md
    why: 需要理解 skill vs hook 的架构区别

19. q: "用OMC持续 推进 一直到 需要 我们去做实际测试为止 我中间不想去确认 W1 W2不足以满足 可能得自动化GSD 用本地 模型 CODEX GEMINI 分工去做 按需调用SIIILL 无人值守模式 懂?"
    gold: feedback_codex_dual_verify.md, feedback_codex_exec_flags.md, feedback_auto_session_wrapup.md
    why: 长问题含多个概念, 需要 semantic 拆解

20. q: "所以是做新的 还是缝合到哪儿了?"
    gold: feedback_adapt_over_build.md
    why: 纯方法论问题, 必须语义理解"做新的 vs 缝合"
```

## Group C: hybrid (10)

```
21. q: "Server is up on 127.0.0.1:8765 为什么一定要部署?"
    gold: project_llk_server_pentest.md
    why: "127.0.0.1:8765" 可 grep, 但"为什么一定要部署"是概念

22. q: "有个问题 为什么C盘是爆炸的C:\\new_tdx64 C:\\new_tdx64"
    gold: pitfall_tdxw_cef_scraping.md, dev-env-standards (见 rules/common)
    why: 路径 entity + "爆炸"是非字面描述

23. q: "实际上这就是 MMC 的短板 为什么MMC没发现这个问题 ?"
    gold: project_my_code_machine.md
    why: "MMC" entity + "短板/为什么没发现"是 reasoning

24. q: "你确定obs生态就这些插件 如果用户没装怎么办 ?"
    gold: feedback_adapt_over_build.md, project_kb_compiler.md
    why: "obs 生态" entity + "用户没装怎么办"是 fallback 语义

25. q: "vault-mind 是那个项目 ?"
    gold: project_vault_mind_philosophy.md, project_obsidian_llm_wiki_branding.md
    why: entity "vault-mind" 但问"是那个项目"含 rebranding 历史 (vault-mind → obsidian-llm-wiki)

26. q: "claude 同志的配置文件在哪儿 ?"
    gold: reference_claude_code_source_analysis.md, project_my_code_machine.md
    why: "claude 同志" entity + "配置文件"泛指 (CLAUDE.md / .claude/ / ~/.claude/rules)

27. q: "为啥不能让 openclaw 去实现呢 ?"
    gold: feedback_openclaw_philosophy.md, openclaw-father.md, openclaw-xiaofeixiang.md
    why: "openclaw" entity + "为啥不能"是 reasoning

28. q: "为啥一定是 Telegram bot 我们不能支持其他的吗 ?"
    gold: configure-notifications 相关 (见 MEMORY.md)
    why: "Telegram bot" entity + "其他"抽象

29. q: "Python 我觉得我们这个不只是CC可以用 其他的也能用 但是我主要推CC 热度高 但是不代表我们不知支持 其他的感觉项目不大 OMC做 还是GSD?"
    gold: python-toolkit.md, (OMC vs GSD 归属?)
    why: "Python/CC" entities + "OMC vs GSD" 归属概念

30. q: "要不要用我们今天开发的CC管家来整理下 ?"
    gold: project_my_code_machine.md
    why: "CC 管家" 是 MMC 的昵称, 需要关联 (semantic) + "整理"功能 (grep)
```

---

## Your job (~30 min)

对每条问题做决定:
- **[accept as-is]** — gold 没错, 直接用
- **[edit: +x.md -y.md]** — 改 gold list, 列增删
- **[reject]** — 这条不适合 (gold 不在 vault / 问题太模糊)
- **[replace]** — 给个更好的 gold

保存到 `D:/projects/obsidian-llm-wiki/eval/retrieval-gold.jsonl`, 格式:

```jsonl
{"id":"q01","q":"这个 我们gitea不能备份吗?","gold":["gitea.md","backup-strategy.md"],"group":"entity"}
{"id":"q02","q":"...","gold":[...],"group":"concept"}
```

**gold 路径**: 相对于 `~/.claude/projects/C--Users-Administrator/memory/`. 如果指向别处 (e.g., `~/.claude/rules/common/dev-env-standards.md`), 用绝对路径或完整相对路径。

完成后告诉我 "gold 筛好了" 或 "gold set saved", 我开始写 eval runner (Phase C)。

---

## 完整 310 条候选

在: `C:/Users/Administrator/.claude/scripts/gold-candidates-2026-04-25.tsv`
如果觉得我预筛的 30 个漏了好问题, 从 TSV 补。
