# obsidian-llm-wiki — 工作交接 (handoff)

> 给下一个 session 的自包含简报。读完这一份就能接着干，不需要回看旧对话。

## 0. 怎么跑 / 在哪

- **代码**：`D:\projects\obsidian-llm-wiki`
- **Git remote**：`gitea` = `https://git.xart.top:8418/Curry/obsidian-llm-wiki.git`
  （`imvt` remote 指向 IMVT 仓 `Curry/imvt.git`，不在本仓使用）
- **当前分支**：`feat/session-archiver-multi-source`
- **HEAD**：`d854b45` （fix(setup.ps1): restore $SkillName escaping; use $result.ok for doctor check）
- **工作树状态**：clean；相对 `main` 落后 38 commits、领先 2 commits
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

## 3. 现状（2026-08-24）

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

1. Obsidian-first onboarding 和 vault binding
2. Capability health 和可行动 remediation
3. TypeScript-owned Python / external worker boundary
4. Plugin、MCP、CLI、vault truth 的 ownership 对齐
5. Roadmap、issue、branch、handoff 按产品 milestone 对齐

当前 issue 真值在 `01-Projects/obsidian-llm-wiki/issues/`：21 个 issue，16 todo、4 done、1 canceled。现有 feature backlog 在 Foundation 之后恢复。

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

1. **完成 Foundation 设计**：以 `30-Architecture/llm-wiki-product-spine.md` 为基线，补齐 onboarding、capability health、TS/Python boundary 和 ownership contract。
2. **重新归类 issue**：Core Product、Product Infrastructure、Compatibility Workers、Later / Experimental；暂停无关 feature 扩张。
3. **重做安装与首次使用路径**：Obsidian-first；setup 退为 headless / developer / CI 入口，消除普通用户的 PowerShell、Python 和手动复制粘贴前置条件。
4. **收敛 Python 边界**：把 compiler、`kb_meta`、MemU、Graph 变成 TS 管理的 capability，不做一次性全量 Python 重写。
5. **基础设计通过后**：再处理 Plugin 0.4.0 GA 的数据安全、Promote UX 和测试门禁。
6. **最后恢复扩展线**：Session Archiver、Fleet、Gitea federation、其他 adapters 按新的产品 taxonomy 排期。
7. bun shim、全量测试和 doctor 绿灯属于后续执行门禁，不改变当前 Foundation 优先级。

---

> 本文件取代历史 `vault-mind` handoff。当前仓库已经从 `vault-mind` 改名为 `obsidian-llm-wiki`，详见 git log `283021e`（chore: publish plugin beta.5）以前的更名历史。
