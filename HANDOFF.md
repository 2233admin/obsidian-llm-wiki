# obsidian-llm-wiki — 工作交接 (handoff)

> 给下一个 session 的自包含简报。读完这一份就能接着干，不需要回看旧对话。

## 0. 怎么跑 / 在哪

- **代码**：`D:\projects\obsidian-llm-wiki`
- **Git remote**：`gitea` = `https://git.xart.top:8418/Curry/obsidian-llm-wiki.git`
  （`imvt` remote 指向 IMVT 仓 `Curry/imvt.git`，不在本仓使用）
- **当前分支**：`feat/session-archiver-multi-source`
- **HEAD**：`db116f9`（`feat: complete Obsidian Recovery Flow action`）
- **工作树状态**：有一个用户已有未跟踪研究文件 `00-Inbox/Sources/github/obsidian-components-implementation-research.md`；不要覆盖或删除
- **真实 vault**：`D:\knowledge`（用户私有，不进仓；gitea 备份已授权）
- **OS**：Windows 11，Python 3.10/3.11/3.13 共存（编译缓存常见多版本混存，需 gitignored）

### Python 测试（Windows 可带 `PYTHONUTF8=1`）

```bash
PYTHONUTF8=1 python -m pytest tests/ --ignore=tests/test_memu_sync_settings.py
```

Full root run on 2026-08-29: 282 passed, 1 skipped.

The Python worker boundary is implemented in TypeScript for named compiler,
trigger, MemU, and agent callers. No production direct Python callsites remain;
direct Python calls are confined to test-only coverage.

### Node（mcp-server / obsidian-plugin）

```bash
cd mcp-server && npm run typecheck && npm test
cd obsidian-plugin && npm run typecheck && npm test
```

Current verified totals: MCP 858 passed / 18 skipped / 0 failed; Obsidian plugin
98 passed / 0 failed; root Python 282 passed / 1 skipped; Fleet verifier 17
passed / 0 failed. S08 remains in progress with acceptance item 30 open;
Foundation exit is not claimed.
SkillWatcher’s Node/browser timer flake is resolved: the lifecycle harness lacked
`window.setTimeout`/`window.clearTimeout`; `obsidian-plugin/src/agentfiles/watcher.ts`
now uses the Node-safe timer boundary. Three consecutive plugin runs each passed
98/98; plugin typecheck and production build also passed.

### Bundle 重建（bundle.js 不再 tracked）

```bash
cd mcp-server && npm run rebuild    # tsc + esbuild, includes recovery-flow-cli.js
cd obsidian-plugin && npm run build # tsc + esbuild production
```

The setup surface is TS-owned by `mcp-server/src/scripts/setup.ts`; `setup`
and `setup.ps1` are thin launchers that invoke the generated setup CLI.

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
    └── obsidian-llm-wiki/issues/   # 当前 21 个 issue，16 todo + 4 done + 1 canceled
```

## 2. §0 不变量（仓库范围）

1. **Markdown 是唯一真值**：派生物（canvas/md 总表）永不是源；可重建、gitignore、字节稳定、永不回改源
2. **机器路径永不进共享/提交内容**：仅入 gitignored 的 `.vault-mind/local-bindings.json`
3. **promote 仅经 git PR 闸**：base-head 乐观锁 → HEAD_MISMATCH，永不 last-write-wins
4. **无 runtime / daemon / webhook / cloud / 新 LLM 服务**：取概念，丢运行时
5. **token 只从 env**：只进 header，任何错误路径都不外泄
6. **bundle 产物不入仓**：`npm run rebuild` 重新生成
7. **Components/ 用户私有 vault 不入仓**：licensed samples 走 `docs/samples/components/`

## 3. 现状（2026-08-29）

### 产品方向已重新定级

- LLM Wiki 是 Obsidian-first 产品；Obsidian plugin 是主产品和人类控制面。
- MCP server 和 CLI 是 Agent / 自动化接入面，不拥有主产品生命周期。
- Python compiler、`kb_meta`、MemU、Graph 等是可选 capability worker，不应成为隐式安装前提。
- 产品脊柱和边界记录在 `30-Architecture/llm-wiki-product-spine.md`。
- Foundation 阶段优先于新 MCP 工具、adapter、Fleet 和其他扩展功能。

### 最近已完成的代码工作

- **Plugin 0.4.0-beta.5**：Ask Mate、Agentfiles、governed workflow。
- **Project Memory Loop MVP**：`project-context/v1` + `session-record/v1`。
- **IMVT session capture adapter**：兼容性 adapter 交付。
- **Session archiver**：多来源 session 归档、按项目路径、脱敏、幂等状态、独立 bundle。
- **UX audit Area A/B/C**：MCP、插件 UX、setup 的第一轮修复。
- **仓库清理**：Components 移除、bundle untrack、sample vault 归档、TS strict / ESLint flat / Prettier 工件。

### 当前 Foundation 阶段

- [x] Obsidian-first onboarding and vault binding; the plugin now exposes a
  resumable Getting Started state machine and actionable capability actions.
- [x] Capability health and remediation guide; optional workers degrade without
  blocking filesystem search.
- [x] TypeScript-owned Python / external worker boundary for named compiler,
  trigger, MemU, and agent callers; no production direct Python callsites remain.
- [x] Plugin, MCP, CLI, and vault truth ownership is documented and the dedicated
  Recovery Flow CLI uses the shared Operation dispatcher.
- [x] Roadmap, Work-OS issues, branch, and handoff are aligned with the product
  milestone.
- [ ] S08 Foundation exit remains blocked; acceptance item 30 is still open.

Current verification evidence is recorded in
`01-Projects/obsidian-llm-wiki/issues/p0-s08-recovery-loop-acceptance.md`.

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

1. Complete the remaining S08 durable-store fixture breadth and close
   acceptance item 30.
2. Keep direct Python subprocess calls confined to test-only coverage; do not
   widen provider scope.
3. After S08 is accepted, reopen the Plugin 0.4.0 GA safety backlog and schedule
   deferred extension work.

---

> 本文件取代历史 `vault-mind` handoff。当前仓库已经从 `vault-mind` 改名为 `obsidian-llm-wiki`，详见 git log `283021e`（chore: publish plugin beta.5）以前的更名历史。
