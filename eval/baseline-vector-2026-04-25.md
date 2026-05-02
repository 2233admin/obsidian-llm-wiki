# Vault-file Vector Baseline

- **Date**: 2026-04-25
- **Embedding model**: `qwen3-embedding:0.6b` (1024-dim, ollama localhost:11434, same as memU)
- **Corpus**: 185 files in `memory/*.md` top-level (excludes ['MEMORY.md', 'README.md'])
- **Chunking**: first 2000 chars per file (single-chunk, no overlap)
- **Gold**: 25 queries from `retrieval-gold.jsonl`
- **Ranking**: cosine similarity, top-5

## Overall vs filesystem baseline

| metric | vector | fs (ripgrep+density) | delta |
|---|---|---|---|
| recall@5 | **0.547** | 0.400 | +0.147 |
| MRR | **0.570** | 0.405 | +0.165 |

## Per group

| group | n | vector r@5 | vector MRR |
|---|---|---|---|
| entity | 8 | 0.750 | 0.625 |
| concept | 6 | 0.639 | 0.611 |
| hybrid | 11 | 0.348 | 0.508 |

## Per query

| qid | grp | r@5 | MRR | gold | top-5 |
|---|---|---|---|---|---|
| q01 | ent | 1.00 | 1.00 | gitea, backup-strategy | backup-strategy, gitea, project_gitea_enhancement_2026_03_28, project_backup_... |
| q02 | ent | 1.00 | 0.50 | gitea, nas-services-2026-03, backup-strategy | project_backup_infrastructure_todo, gitea, backup-strategy, project_gitea_enh... |
| q03 | ent | 1.00 | 1.00 | nas_astrbot_napcat | nas_astrbot_napcat, feedback_node_roles, super-platform, project_mission_ops_... |
| q04 | ent | 1.00 | 0.50 | project_mission_ops, project_mission_ops_runbook | feedback_high_freq_triggers, project_mission_ops_runbook, feedback_honesty_id... |
| q05 | ent | 1.00 | 1.00 | gitea, backup-strategy | backup-strategy, reference_claude_code_source_analysis, gitea, feedback_use_f... |
| q06 | ent | 1.00 | 1.00 | project_fish_speech | project_fish_speech, reference_relay_station_models, unicom-yuanjing-api, fee... |
| q07 | ent | 0.00 | 0.00 | project_ai_trading_loop | feedback_obsidian_trading_path, feedback_adapt_over_build, feedback_research_... |
| q08 | ent | 0.00 | 0.00 | python-toolkit, pitfall_windows_clipboard_encoding | winforge-project, feedback_tool_selection_filter, feedback_no_mcp_servers, fe... |
| q09 | con | 1.00 | 1.00 | project_sprachwelt_strategy, feedback_sprachwelt_infrastr... | feedback_sprachwelt_infrastructure, project_sprachwelt_strategy, feedback_mul... |
| q10 | con | 0.33 | 0.50 | project_memu_reactivate, project_memory_executor_infra_20... | project_memory_system_upgrade, feedback_memory_architecture, feedback_adapt_o... |
| q11 | con | 1.00 | 0.50 | reference_skill_index, feedback_skill_usage_protocol | feedback_worker_cli_no_skills, feedback_skill_usage_protocol, reference_skill... |
| q12 | con | 0.50 | 1.00 | project_hook_infrastructure, feedback_skill_usage_protocol | feedback_skill_usage_protocol, feedback_worker_cli_no_skills, feedback_use_sk... |
| q13 | con | 0.50 | 0.33 | feedback_auto_session_wrapup, feedback_omc_invoke_directly | feedback_omc_preference, reference_omc_unexplored_features, feedback_omc_invo... |
| q14 | con | 0.50 | 0.33 | feedback_codex_dual_verify, feedback_codex_exec_flags | feedback_worker_cli_no_skills, feedback_multimodel_roles_sprachwelt, feedback... |
| q15 | hyb | 0.25 | 1.00 | project_p_risk_pipeline, quant_daily_pipeline, project_sh... | project_itransformer_mvp, gpu-investment-ladder, feedback_use_own_quant_syste... |
| q16 | hyb | 0.25 | 0.25 | project_n8n_nas, feedback_obsidian_path, project_kb_compi... | feedback_adapt_over_build, notion, nas-n8n-setup, feedback_obsidian_path, fee... |
| q17 | hyb | 0.75 | 1.00 | project_memu_migration, project_memu_reactivate, project_... | project_memu_migration, project_memu_reactivate, feedback_use_skills_not_mcp,... |
| q18 | hyb | 0.00 | 0.00 | project_llk_server_pentest, user_llk_identity | feedback_no_mcp_servers, feedback_node_roles, project_fish_speech, super-prox... |
| q19 | hyb | 0.50 | 0.33 | pitfall_tdxw_cef_scraping, pitfall_winget_reparse_points | pitfall_msys_junction, pitfall_ds718_nas_operations, pitfall_tdxw_cef_scrapin... |
| q20 | hyb | 0.00 | 0.00 | project_my_code_machine, feedback_adapt_over_build, feedb... | feedback_use_skills_not_mcp, feedback_no_mcp_servers, feedback_omc_preference... |
| q21 | hyb | 0.25 | 0.50 | project_vault_mind_philosophy, project_obsidian_llm_wiki_... | feedback_vault_mind_no_embed, project_vault_mind_philosophy, feedback_adapt_o... |
| q22 | hyb | 0.50 | 1.00 | reference_claude_code_source_analysis, project_my_code_ma... | reference_claude_code_source_analysis, backup-strategy, feedback_dreamtime_ph... |
| q23 | hyb | 1.00 | 1.00 | feedback_openclaw_philosophy, openclaw-father, openclaw-x... | feedback_openclaw_philosophy, openclaw-father, openclaw-xiaofeixiang, project... |
| q24 | hyb | 0.00 | 0.00 | project_my_code_machine, project_toolchain_2026_04_07 | feedback_use_free_tools, reference_omc_unexplored_features, project_mo_next_s... |
| q25 | hyb | 0.33 | 0.50 | python-toolkit, pitfall_pixi_torch_nightly_setuptools, pi... | feedback_use_free_tools, python-toolkit, feedback_tool_selection_filter, refe... |

## Failures (recall@5 = 0)

### q07 (entity)
- **Q**: 能不能直接改 TradingView的收藏夹 ?
- **Gold**: project_ai_trading_loop.md
- **Got**: feedback_obsidian_trading_path.md, feedback_adapt_over_build.md, feedback_research_digest.md, feedback_use_own_quant_system.md, feedback_use_free_tools.md

### q08 (entity)
- **Q**: Windows ML stack 那就 3.12 但是其他代码开发 是可以用 3.13吧?
- **Gold**: python-toolkit.md, pitfall_windows_clipboard_encoding.md
- **Got**: winforge-project.md, feedback_tool_selection_filter.md, feedback_no_mcp_servers.md, feedback_use_free_tools.md, feedback_adapt_over_build.md

### q18 (hybrid)
- **Q**: Server is up on 127.0.0.1:8765 为什么一定要部署?
- **Gold**: project_llk_server_pentest.md, user_llk_identity.md
- **Got**: feedback_no_mcp_servers.md, feedback_node_roles.md, project_fish_speech.md, super-proxy.md, project_aiproxy_deploy.md

### q20 (hybrid)
- **Q**: 实际上这就是 MMC 的短板 为什么MMC没发现这个问题 ?
- **Gold**: project_my_code_machine.md, feedback_adapt_over_build.md, feedback_engineering_vs_ux.md
- **Got**: feedback_use_skills_not_mcp.md, feedback_no_mcp_servers.md, feedback_omc_preference.md, mcp-consolidation.md, feedback_self_adversarial.md

### q24 (hybrid)
- **Q**: 要不要用我们今天开发的CC管家来整理下 ?
- **Gold**: project_my_code_machine.md, project_toolchain_2026_04_07.md
- **Got**: feedback_use_free_tools.md, reference_omc_unexplored_features.md, project_mo_next_session.md, mcp-consolidation.md, feedback_capabilities_first_prompting.md

