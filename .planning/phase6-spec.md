# Phase 6: Distribution + Skills -- Task Spec

## Goal
一键安装，skills 迁入适配 unified query，新增 vault-health + vault-reconcile。

## Context
- Repo: `D:/projects/vault-mind/`
- MCP server: `mcp-server/src/index.ts`
- 现有 skills 在:
  - `D:/projects/obsidian-vault-bridge/skills/` (vault-save, vault-world, vault-challenge, vault-emerge, vault-connect)
  - `~/.claude/skills/vault-brain/commands/` (vault-save.md, vault-world.md)
- Vault path: `E:/knowledge/`

## Deliverables

### 1. `setup.sh` (项目根目录)
- 检测 Node.js >= 20, Python >= 3.11, Claude Code
- `npm install` (mcp-server/)
- `pip install -e .` 或检测 compiler 依赖
- 交互式: 询问 vault path，生成 `vault-mind.yaml`
- 注册 MCP server 到 Claude Code (`~/.claude/settings.json` mcpServers)
- 可选: 注册 skills
- 可选: 注册 cron hooks
- 幂等: 重复运行不出错

### 2. Skills 迁入 (`skills/` 目录)
- 复制现有 5 个 vault-* skills 到 `skills/` 目录
- 适配: vault-challenge 引用 `_contradictions.md`
- 适配: vault-world L1 调 adapter 上下文 (query.unified)
- 适配: vault-save 用 vault.create/modify MCP method
- 每个 skill 文件头部加 `# Requires: vault-mind MCP server`

### 3. `vault-health` skill (新建 `skills/vault-health.md`)
8 类审计:
- 孤儿页面 (no inbound links)
- 死链 (broken wikilinks)
- Stale 页面 (> 90 days no edit)
- 未解决矛盾 (_contradictions.md unresolved count)
- 低覆盖度概念 (< 2 sources)
- 缺失 frontmatter (configurable required fields)
- 重复标题
- 风格不一致 (heading levels, tag format)

输出格式: 按严重度排序的 issue 列表 + 统计摘要

### 4. `vault-reconcile` skill (新建 `skills/vault-reconcile.md`)
矛盾调和工作流:
- 读 `_contradictions.md` 中 unresolved 条目
- 对每个矛盾: 展示 Claim A vs Claim B + sources
- 引导用户选择: 保留 A / 保留 B / 两者都对(标注条件) / 需要更多数据
- 写入 resolution 到 `_contradictions.md`
- 更新相关 concept 页面

### 5. README.md 更新
- 安装: 3 步 (clone, setup.sh, done)
- 使用: 常用 MCP tools 列表
- 架构图: 四层 (MCP -> Adapter -> Compiler -> Agent)
- 竞品对比: vs obsidian-second-brain, vs obsidian-local-rest-api

## Constraints
- setup.sh: bash, 兼容 Git Bash on Windows
- Skills: markdown 格式, Claude Code skill 规范
- 不修改 mcp-server/src/ 代码 (Phase 5 负责 agent wiring)
- README 简洁, 不超过 200 行

## Definition of Done
- `bash setup.sh --help` 显示用法
- 5 个迁入 skills 可被 Claude Code 识别
- vault-health 能在 E:/knowledge/ 上跑出报告
- vault-reconcile 能读 _contradictions.md
- README 有安装步骤 + 架构图
