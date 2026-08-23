# obsidian-llm-wiki — 工作交接 (handoff)

> 给下一个 session 的自包含简报。读完这一份就能接着干，不需要回看旧对话。

## 0. 怎么跑 / 在哪

- **代码**：`D:\projects\obsidian-llm-wiki`
- **Git remote**：`gitea` = `https://git.xart.top:8418/Curry/obsidian-llm-wiki.git`
  （`imvt` remote 指向 IMVT 仓 `Curry/imvt.git`，不在本仓使用）
- **当前分支**：`codex/chatindex-knowledge-provider`
- **HEAD**：`f2227ca` （freetoken-eval: capture 2026-08-23 host survey）
- **工作树状态**：clean，前方 5 commits 待 push 或后续工作
- **真实 vault**：`D:\knowledge` （用户私有，不进仓；gitea 备份已授权）
- **OS**：Windows 11，Python 3.10/3.11/3.13 共存（编译缓存常见多版本混存，需 gitignored）

### Python 测试（必须带 `PYTHONUTF8=1`，Windows GBK 会坏 UTF-8）

```bash
PYTHONUTF8=1 python -m pytest tests/ --ignore=tests/test_memu_sync_settings.py
```

`test_memu_sync_settings.py` 因 `compiler` 模块路径 bug 当前需 `--ignore`。880 个其余测试通过。

### Node（mcp-server / obsidian-plugin）

```bash
cd mcp-server && npm run typecheck
cd obsidian-plugin && npm run typecheck
```

`npm test` 当前因 bun shim 指向 `C:/Users/Administrator/.x-cmd.root/.../bun.exe`（缺失）**坏掉**。
workaround：`x-cmd pkg install bun` 修复 bun，或 `npx --no-install tsc --noEmit` 跑 typecheck。

### Bundle 重建（bundle.js 不再 tracked）

```bash
cd mcp-server && npm run rebuild    # tsc + esbuild bundle
cd obsidian-plugin && npm run build  # tsc + esbuild production
```

## 1. 仓库脊柱

```
obsidian-llm-wiki/
├── mcp-server/         # @obsidian-llm-wiki/mcp  v0.4.0-beta.3 (ESM strict TS)
├── obsidian-plugin/    # Obsidian control plane   v0.4.0-beta.5 (GPL-3.0-only)
├── packages/           # 5 个 shared TS packages (workspaces)
│   ├── settings-platform/
│   ├── agent-domain/
│   ├── visual-workspace/
│   ├── problem-intake/
│   └── agent-wiki-contracts/
├── compiler/           # Python: capture/promote/compile, kb_meta, currency
├── openspec/           # 设计契约 + archived changes
├── docs/               # 文档 + samples + designs
├── fixtures/           # 测试用 sample vault
├── tests/              # Python 测试
├── scripts/            # CLI 工具（lmvk-*, verify-*, doctor, probe）
├── skills/             # agent skills
├── recipes/            # agent recipes
├── hooks/              # capture hook
├── fleet/              # fleet mode 代码
├── creatures/          # vault-* persona prompts
├── terrariums/         # vault-wiki-team.yaml 团队编排
├── eval/  viewer/  deploy/  examples/  obc/  recipes/
└── 01-Projects/        # 工作-OS issue notes (canonical work state)
    └── obsidian-llm-wiki/issues/   # 23 个 issue，15 todo + 7 done + 1 canceled
```

## 2. §0 不变量（仓库范围）

1. **Markdown 是唯一真值**：派生物（canvas/md 总表）永不是源；可重建、gitignore、字节稳定、永不回改源
2. **机器路径永不进共享/提交内容**：仅入 gitignored 的 `.vault-mind/local-bindings.json`
3. **promote 仅经 git PR 闸**：base-head 乐观锁 → HEAD_MISMATCH，永不 last-write-wins
4. **无 runtime / daemon / webhook / cloud / 新 LLM 服务**：取概念，丢运行时
5. **token 只从 env**：只进 header，任何错误路径都不外泄
6. **bundle 产物不入仓**：`npm run rebuild` 重新生成
7. **Components/ 用户私有 vault 不入仓**：licensed samples 走 `docs/samples/components/`

## 3. 现状（2026-08-23）

### 已完成

- **v2.8.0-beta.3 fleet acceptance** (2026-07-25)：federated agent rooms + fleet control plane 落地
- **Plugin 0.4.0-beta.5** (2026-08-18)：Ask Mate + Agentfiles 内化 + governed workflow
- **project-context/v1 + session-record/v1** (2026-08-19)：Project Memory Loop MVP
- **IMVT session capture adapter** (2026-08-19)：兼容性 adapter 交付
- **仓库清理 (2026-08-23)**：Components/ 276MB 清除、4 个 bundle untrack、3 个 LICENSE-bearing vault 移到 `docs/samples/components/`、TS strict + ESLint flat + Prettier 工件加齐
- **5 commits 已 push** 到 `gitea/codex/chatindex-knowledge-provider`

### 在跑的 15 个 todo（按优先级）

**P1（5 条，都是 plugin 数据/迁移/UX 缺陷）**：
- `plugin-migration-data-loss`：legacy settings migration 事务性破裂
- `fleet-agent-discovery-transports`：NetBird-only 硬编码，需 pluggable
- `host-install-registration-wheel`：setup 脚本互相矛盾，需一站式安装
- `plugin-promote-frontmatter-gate`：Promote 应基于 frontmatter gate
- `gitea-federation-adapter`：gitea issue 与 work-OS 并行注册（Task 9 gap）

**P2（6 条 plugin 健壮性 + 工作流）**：
- `plugin-legacy-assignment-precedence`、`plugin-main-ts-test-coverage`（0 测试覆盖是数据丢失 bug 漏过的根因）、`plugin-promote-view-refresh`、`plugin-python-path-batch-cmd`、`temporal-graph-index-search-accelerator`

**P3（4 条 plugin UX）**：
- `plugin-binding-editor-noop-callback`、`plugin-low-hygiene-batch`、3 个 promote 体验细节

完整 issue 列表见 `01-Projects/obsidian-llm-wiki/issues/`。

## 4. 工具链

### 规范
- TS strict（`tsconfig.json` in `mcp-server/`、`obsidian-plugin/`、`packages/*/tsconfig.json`）
- ESLint v9 flat config：根 `eslint.config.js`，type-aware rules
- Prettier：根 `.prettierrc.json`（100 col、double quotes、trailing-all）
- EditorConfig：根 `.editorconfig`（LF / 2-space）

### 关键路径
- `.gitignore` 已 cover：`Components/`、`vault/`、4 个 bundle、4 个 Python cache 规则
- 工作-OS：`01-Projects/<project>/issues/<slug>.md` 是 canonical；`Projects/<slug>.md` 是 shared registry
- 源注册：`_llmwiki/source-registry.json` + `00-Inbox/Sources/<platform>/<source-slug>.md`

## 5. 构建 cadence（沿用）

每个 issue：**draft（先写文档定 §0）→ Wave-based parallel agents build → 验证 → atomic commit → push**。
教训：subagent 的窄测试命令会漏过跨测试，全量 typecheck 必须由主会话跑。

## 6. 下一步建议

1. **修 bun shim**（`x-cmd pkg install bun`），让 `npm test` 重新可用 — 不修这个 13 条 plugin todo 全是盲改
2. **`plugin-migration-data-loss` (P1)**：唯一会 brick 用户数据的缺陷
3. **`host-install-registration-wheel` (P1)**：前天手动做过一次，最有体感
4. **`scripts/` / `tests/` / `fixtures/` 三个目录审计**：已经完成，均为产品代码无杂质
5. **`ROADMAP.md` 续写**：当前停在 v2.5.0（2026-07-13），需要加 beta.3/beta.5 段落
6. **10 个 `TASK*-DRAFT-*.md` 归档**：移到 `docs/archive/task-drafts/` + README

---

> 本文件取代历史 `vault-mind` handoff。当前仓库已经从 `vault-mind` 改名为 `obsidian-llm-wiki`，详见 git log `283021e`（chore: publish plugin beta.5）以前的更名历史。
