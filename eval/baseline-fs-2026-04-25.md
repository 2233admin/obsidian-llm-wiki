# Filesystem-only Retrieval Baseline

- **Date**: 2026-04-25
- **Adapter**: ripgrep over `memory/*.md` (top-level only), multi-token OR, rank by hit count
- **Gold set**: 25 queries from `retrieval-gold.jsonl`
- **Top-K**: 5

## Overall

| metric | value |
|---|---|
| recall@5 | **0.400** |
| MRR | **0.405** |

## Per group

| group | n | recall@5 | MRR |
|---|---|---|---|
| entity | 8 | 0.438 | 0.406 |
| concept | 6 | 0.528 | 0.472 |
| hybrid | 11 | 0.303 | 0.367 |

## Per query

| qid | grp | r@5 | MRR | gold | top-5 ranked |
|---|---|---|---|---|---|
| q01 | ent | 0.50 | 0.25 | gitea, backup-strategy | project_nas_gitea_frontend, feedback_gitea_repo_visibility, project_gitea_enh... |
| q02 | ent | 0.00 | 0.00 | gitea, nas-services-2026-03, backup-strategy | project_nas_gitea_frontend, nas-n8n-setup, infra-interfaces, project_backup_i... |
| q03 | ent | 1.00 | 1.00 | nas_astrbot_napcat | nas_astrbot_napcat, pitfall_aiocqhttp_xclientrole, reference_canvas_text_libs... |
| q04 | ent | 1.00 | 1.00 | project_mission_ops, project_mission_ops_runbook | project_mission_ops, project_toolchain_2026_04_02, feedback_obsidian_path, pr... |
| q05 | ent | 0.50 | 0.50 | gitea, backup-strategy | project_nas_gitea_frontend, backup-strategy, feedback_dreamtime_philosophy, p... |
| q06 | ent | 0.00 | 0.00 | project_fish_speech | reference_canvas_text_libs, feedback_openclaw_philosophy, feedback_ci_warning... |
| q07 | ent | 0.00 | 0.00 | project_ai_trading_loop | feedback_omc_invoke_directly, feedback_memory_date_aware, project_memu_migrat... |
| q08 | ent | 0.50 | 0.50 | python-toolkit, pitfall_windows_clipboard_encoding | feedback_use_free_tools, python-toolkit, project_clash_china_profile, feedbac... |
| q09 | con | 0.67 | 0.50 | project_sprachwelt_strategy, feedback_sprachwelt_infrastr... | llm-router-landscape, feedback_sprachwelt_infrastructure, project_obsidian_ll... |
| q10 | con | 0.00 | 0.00 | project_memu_reactivate, project_memory_executor_infra_20... | feedback_obsidian_path, project_expert_agent_rag, project_obsidian_vault_merg... |
| q11 | con | 0.50 | 0.33 | reference_skill_index, feedback_skill_usage_protocol | feedback_worker_cli_no_skills, reference_clawhub_publish, feedback_skill_usag... |
| q12 | con | 0.50 | 1.00 | project_hook_infrastructure, feedback_skill_usage_protocol | feedback_skill_usage_protocol, feedback_use_skills_not_mcp, reference_clawhub... |
| q13 | con | 0.50 | 0.50 | feedback_auto_session_wrapup, feedback_omc_invoke_directly | feedback_omc_preference, feedback_omc_invoke_directly, mcp-hub-wheel, agent-s... |
| q14 | con | 1.00 | 0.50 | feedback_codex_dual_verify, feedback_codex_exec_flags | feedback_worker_cli_no_skills, feedback_codex_exec_flags, feedback_multimodel... |
| q15 | hyb | 0.25 | 0.20 | project_p_risk_pipeline, quant_daily_pipeline, project_sh... | project_apex_cnaifree, feedback_engineering_vs_ux, feedback_timeline_explanat... |
| q16 | hyb | 0.25 | 1.00 | project_n8n_nas, feedback_obsidian_path, project_kb_compi... | project_n8n_nas, feedback_omc_invoke_directly, nas-n8n-setup, project_obsidia... |
| q17 | hyb | 0.50 | 0.50 | project_memu_migration, project_memu_reactivate, project_... | feedback_use_skills_not_mcp, project_memu_migration, project_memu_reactivate,... |
| q18 | hyb | 0.00 | 0.00 | project_llk_server_pentest, user_llk_identity | feedback_no_mcp_servers, feedback_proactive_gaps, project_ashare_mcp_adapter,... |
| q19 | hyb | 0.00 | 0.00 | pitfall_tdxw_cef_scraping, pitfall_winget_reparse_points | feedback_engineering_vs_ux, feedback_proactive_gaps, feedback_adversarial_ite... |
| q20 | hyb | 0.67 | 0.50 | project_my_code_machine, feedback_adapt_over_build, feedb... | feedback_adversarial_iteration, feedback_engineering_vs_ux, feedback_proactiv... |
| q21 | hyb | 0.50 | 0.50 | project_vault_mind_philosophy, project_obsidian_llm_wiki_... | feedback_vault_mind_no_embed, project_vault_mind_philosophy, feedback_high_fr... |
| q22 | hyb | 0.50 | 0.33 | reference_claude_code_source_analysis, project_my_code_ma... | feedback_dreamtime_philosophy, backup-strategy, reference_claude_code_source_... |
| q23 | hyb | 0.67 | 1.00 | feedback_openclaw_philosophy, openclaw-father, openclaw-x... | feedback_openclaw_philosophy, project_chainmiku_hub, project_memory_keeper_op... |
| q24 | hyb | 0.00 | 0.00 | project_my_code_machine, project_toolchain_2026_04_07 | feedback_parallel_agent_integration, tool_buddy_reroll, super-credentials, pi... |
| q25 | hyb | 0.00 | 0.00 | python-toolkit, pitfall_pixi_torch_nightly_setuptools, pi... | project_vault_mind_philosophy, feedback_omc_invoke_directly, feedback_tool_se... |

## Failures (recall@5 = 0)

### q02 (entity)
- **Q**: Gitea 跟 /volume1/K-project/backups/duckdb/ 本身就都在NAS山 我感觉备份两份是没问题 但是gitea 你不是更好用?
- **Tokens**: `Gitea, volume1, project, backups, duckdb, 本身, 身就, NAS, 我感, 感觉, 觉备, 备份, 份两, 两份, 份是, 没问, 问题, gitea, 是更, 更好, 好用`
- **Gold**: gitea.md, nas-services-2026-03.md, backup-strategy.md
- **Got**: project_nas_gitea_frontend.md, nas-n8n-setup.md, infra-interfaces.md, project_backup_infrastructure_todo.md, project_gitea_enhancement_2026_03_28.md

### q06 (entity)
- **Q**: 我们本地文字语音识别用的什么模型?
- **Tokens**: `们本, 本地, 地文, 文字, 字语, 语音, 音识, 识别, 别用, 用的, 的什, 什么, 么模, 模型`
- **Gold**: project_fish_speech.md
- **Got**: reference_canvas_text_libs.md, feedback_openclaw_philosophy.md, feedback_ci_warnings_before_workflow.md, project_agent_voice.md, feedback_proactive_gaps.md

### q07 (entity)
- **Q**: 能不能直接改 TradingView的收藏夹 ?
- **Tokens**: `能直, 直接, 接改, TradingView, 的收, 收藏, 藏夹, 的收藏夹`
- **Gold**: project_ai_trading_loop.md
- **Got**: feedback_omc_invoke_directly.md, feedback_memory_date_aware.md, project_memu_migration.md, feedback_ci_warnings_before_workflow.md, feedback_timeline_explanation.md

### q10 (concept)
- **Q**: obsidian 先收口了 我觉得记忆系统得更新调整研究下?
- **Tokens**: `obsidian, 先收, 收口, 口了, 先收口了, 我觉, 觉得, 得记, 记忆, 忆系, 系统, 统得, 得更, 更新, 新调, 调整, 整研, 研究, 究下`
- **Gold**: project_memu_reactivate.md, project_memory_executor_infra_2026_04_24.md, feedback_memory_architecture.md
- **Got**: feedback_obsidian_path.md, project_expert_agent_rag.md, project_obsidian_vault_merge.md, feedback_use_free_tools.md, project_bridge_architecture_v2.md

### q18 (hybrid)
- **Q**: Server is up on 127.0.0.1:8765 为什么一定要部署?
- **Tokens**: `Server, 8765, 为什, 什么, 么一, 一定, 定要, 要部, 部署`
- **Gold**: project_llk_server_pentest.md, user_llk_identity.md
- **Got**: feedback_no_mcp_servers.md, feedback_proactive_gaps.md, project_ashare_mcp_adapter.md, project_mo_next_session.md, feedback_engineering_vs_ux.md

### q19 (hybrid)
- **Q**: 有个问题 为什么C盘是爆炸的C:\new_tdx64 C:\new_tdx64
- **Tokens**: `个问, 问题, 有个问题, 为什, 什么, 为什么, 盘是, 是爆, 爆炸, 炸的, new_tdx64`
- **Gold**: pitfall_tdxw_cef_scraping.md, pitfall_winget_reparse_points.md
- **Got**: feedback_engineering_vs_ux.md, feedback_proactive_gaps.md, feedback_adversarial_iteration.md, experiment_hmc_ontological_gap.md, feedback_research_digest.md

### q24 (hybrid)
- **Q**: 要不要用我们今天开发的CC管家来整理下 ?
- **Tokens**: `要用, 用我, 们今, 今天, 天开, 开发, 发的, CC, 管家, 家来, 来整, 整理, 理下`
- **Gold**: project_my_code_machine.md, project_toolchain_2026_04_07.md
- **Got**: feedback_parallel_agent_integration.md, tool_buddy_reroll.md, super-credentials.md, pitfall_gsd_sdk_silent_fail.md, project_openalice_integration.md

### q25 (hybrid)
- **Q**: Python 工具链 我们推 CC 但其他也要支持 怎么设计?
- **Tokens**: `Python, 工具, 具链, 工具链, 们推, 我们推, CC, 但其, 其他, 要支, 支持, 怎么, 么设, 设计, 怎么设计`
- **Gold**: python-toolkit.md, pitfall_pixi_torch_nightly_setuptools.md, pitfall_windows_clipboard_encoding.md
- **Got**: project_vault_mind_philosophy.md, feedback_omc_invoke_directly.md, feedback_tool_selection_filter.md, infra_tokyo_tools.md, project_toolchain_2026_04_02.md

