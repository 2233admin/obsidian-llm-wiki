# LLMwiki 使用指南

> 🌐 **语言**：[English](GUIDE.md) · 简体中文（本页）

一份实用走读：安装 → 编译 raw research → 带引用提问 → 把有价值的 AI 输出放进 review。

遇到问题直接跳到 [故障排查](#故障排查)，或者去 [issues](https://github.com/2233admin/obsidian-llm-wiki/issues) 开一个。

---

## 这东西到底给你什么

你会看这份指南，是因为你的团队已经丢过知识。

不是没人写。大家写了。问题是笔记、代码发现、agent 回答没有状态：没有出处，没人审核，没有晋升路径。

**LLMwiki** 把它变成一条简单闭环：

```
收集 -> 编译 -> 提问 -> 归档 -> 审核 -> 晋升
```

原始笔记变成摘要和概念页。有价值的 agent 回答先变成待审核草稿。只有审核过的结论，才成为团队记忆。

它不是 AI companion。它是团队 vault 的知识编译器：`raw/` 变成 `wiki/`，带引用回答进入 `00-Inbox/AI-Output/`，可长期使用的团队知识通过 review 晋升。

支持 **Claude Code、Codex、OpenCode、Gemini CLI** 四种 agent host。Obsidian 可选，不开也能用——filesystem adapter 独立工作。

---

## 30 秒装好

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git ~/obsidian-llm-wiki-src
cd ~/obsidian-llm-wiki-src && ./setup
```

**Windows PowerShell：**

```powershell
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git "$HOME\obsidian-llm-wiki-src"
cd "$HOME\obsidian-llm-wiki-src"; .\setup.ps1
```

**指定 host：**

```bash
./setup --host claude     # 默认
./setup --host codex
./setup --host opencode
./setup --host gemini
```

setup 跑完会打两个片段给你贴——一个进 `.mcp.json`，一个进 `CLAUDE.md`（或等价的 host 指令文件）。贴完重启 agent host，MCP 注册才生效。

更细的每 host 路径、手工安装、卸载流程在 [INSTALL.md](INSTALL.md)。

---

## 第一次成功路径

先别碰真实 vault。用内置 demo vault 跑通产品闭环。

当前 compiler 按 topic 目录运行。这个 demo 里，`examples/collab-vault/research-compiler/` 有自己的 `raw/` 和 `wiki/`：

```bash
python compiler/compile.py examples/collab-vault/research-compiler --tier haiku --dry-run
python scripts/knowledge_health.py --vault examples/collab-vault --json
python scripts/llmwiki_doctor.py --vault examples/collab-vault --json
```

compiler dry-run 使用 stub extraction，不需要 API key。`knowledge_health.py` 检查 raw sources、compiled wiki artifacts、AI-Output 和 promoted memory 是否对齐。`llmwiki_doctor.py` 检查 runtime、policy、lint 和 governance。

把这些文件并排打开：

| 看什么 | 路径 |
|---|---|
| Source material | `examples/collab-vault/research-compiler/raw/team-memory-os.md` |
| Compiled summary | `examples/collab-vault/research-compiler/wiki/summaries/team-memory-os.md` |
| Filed AI draft | `examples/collab-vault/00-Inbox/AI-Output/codex/project-setup-proposal.md` |
| Reviewed memory | `examples/collab-vault/20-Decisions/2026-05-16-gitea-reviewed-vault.md` |

闭环就是：

```
raw/ -> wiki/ -> query -> 00-Inbox/AI-Output/ -> reviewed/promoted
```

完整操作和技术模型见 [RESEARCH_COMPILER_LOOP.md](RESEARCH_COMPILER_LOOP.md)。

---

## 第一次 agent session

安装后，把 `VAULT_PATH` 指向一个真实 markdown vault，然后重启 agent host。

### 1. 先确认通路——问个计数

在 Claude Code（或任何你的 agent host）里输入：

```
/vault-librarian 我的 vault 里有几条笔记
```

应该回你一个数字加几条最近的笔记路径。如果这步工作，说明 MCP 通了、vault 也读到了。

### 2. 问一个真问题

```
/vault-librarian 我关于 <一个你真的写过的主题> 都写过什么
```

librarian 会搜索、读取 top 命中、带引用给你答案。如果说"没结果"，换个更宽的主题——librarian 只引用，不编造。

### 3. 看哪些笔记是孤岛

```
/vault-curator 找出没有任何链接指向的笔记
```

curator 调 `vault.lint`，列出孤岛 + 断链。很棒的第一轮清理起点。

### 4. 理解一个概念在上下文里的位置

```
/vault-teacher 解释 [[你的某条笔记名]]
```

teacher 读取目标笔记，拉出它的双向链接，告诉你它在你的知识图里的位置。

### 5. 回顾上个月在想什么

```
/vault-historian 三月份我在想些什么
```

historian 按 frontmatter 日期 + mtime 检索，按主题聚合。

agent 侧闭环就是这样：带引用查询、归档有价值输出，再 review 哪些值得成为团队记忆。

---

## 知识工种

| 工种 | 最适合 | 读 | 写 |
|---|---|---|---|
| **vault-librarian** | "我了解 X 吗"——带引用的答案 | ✅ | — |
| **vault-architect** | 概念图编译 + 重构建议 | ✅ | 只提议 |
| **vault-curator** | 健康报告：孤岛、断链、重复 | ✅ | — |
| **vault-teacher** | 在图谱上下文里解释一条笔记 | ✅ | — |
| **vault-historian** | "X 日期我在想什么" | ✅ | — |
| **vault-janitor** | 带 dry-run 审阅的清理计划 | ✅ | 默认 dry-run |
| **vault-gardener** | 空 vault 播种 + 定期健康巡检 | ✅ | 默认 dry-run |

**所有写操作默认 dry-run。** 你先看到计划，磁盘什么都不会动，直到你确认。

每个知识工种的具体约束在安装后的 `skills/vault-*.md` 里。

---

## AI-Output 归档

每次知识工种做出有意义的分析，都可以存到：

```
{vault}/00-Inbox/AI-Output/{role}/YYYY-MM-DD-{slug}.md
```

每条保存的分析都带 provenance frontmatter：

```yaml
---
generated-by: vault-architect
generated-at: 2026-04-21T14:32:00.000Z
agent: claude-opus-4-7
parent-query: "重构 authentication 模块"
source-nodes:
  - "[[auth-architecture]]"
  - "[[session-tokens]]"
status: draft
scope: project
quarantine-state: new
---
```

### 为什么这件事重要

不做这件事，有价值的 agent 工作会在 session 结束时蒸发。做了之后，vault 保存带引用和 review 状态的候选输出。下次你问 `/vault-librarian architect role 上次对 auth 说了什么`，它能找到。

### 生命周期标记

- `draft`（默认，写入时自动）——新产出，未审阅
- `reviewed`——你手动翻牌，确认有用
- `stale`——gardener 自动翻牌，条件：超过阈值天数 + 没有来自人写笔记的反向链接
- `superseded`——同一组 source-nodes 有了更新的分析（gardener 建议候选，你确认）
- `quarantine-state: promoted`——持久知识已经移动或重写到经过 review 的团队路径

### 怎么审阅

打开 `00-Inbox/AI-Output/{role}/` 目录，值得保留的在 frontmatter 里把 `status: draft` 改成 `reviewed`。长期有效的结论通过 review 移动或重写到 `20-Decisions/`、`30-Architecture/`、`40-Runbooks/`。不想管的也不用动——gardener 会按工种阈值报告 stale 候选。

完整细节：[ai-output-convention.md](ai-output-convention.md)。

---

## 可选 Obsidian 图谱检查

有了真实 AI-Output 笔记之后，在 Obsidian 里打开一条，把 Local Graph 调到 depth `2`。你应该看到 draft 连到它的 `source-nodes` 和 review tags。这只是视觉检查；产品不变量仍然是文件系统状态：

```
source note -> cited AI-Output draft -> reviewed durable note
```

---

## Vault 结构

你**不需要**重新组织你的 vault。LLMwiki 直接在你现有结构上工作。

它只会在知识工种写产出时新建一个目录：

```
your-vault/
├── （你原来的笔记，原样不动）
└── 00-Inbox/
    └── AI-Output/
        ├── vault-architect/
        ├── vault-gardener/
        └── ...
```

不想让 AI-Output 出现在 vault 根目录？把 `.mcp.json` 里的 `VAULT_PATH` 指向真正 vault 下的一个子目录即可——MCP server 把 `VAULT_PATH` 当根，不会越界写出去。

---

## 常用提问速查

| 你想要 | 这么说 |
|---|---|
| 带事实引用的答案 | `/vault-librarian <问题>` |
| 清理一轮 | `/vault-curator 哪里坏了` |
| 解释某条笔记 | `/vault-teacher 解释 [[笔记名]]` |
| 某段时间回顾 | `/vault-historian <月份> 我在想什么` |
| 结构重组想法 | `/vault-architect 建议一些重构` |
| 安全清理执行 | `/vault-janitor 清理孤岛，先 dry-run` |
| 新 vault 播种 | `/vault-gardener 帮我围绕 <主题> 建立笔记骨架` |

---

## 故障排查

### role command 没反应

重启 agent host。MCP 注册只在启动时读取。还不行就看 host 的 MCP 日志，应该有一行 `obsidian-llm-wiki: server running (stdio ...)`。

### `vault.search` 啥都搜不到，但 vault 里明明有文件

`.mcp.json` 里的 `VAULT_PATH` 基本是错的或者是相对路径。必须是**绝对路径**，且指向一个含 `.md` 的目录。

### agent 写到了错的地方

再检查 `VAULT_PATH`。MCP server 拒绝写出这个路径之外——如果写到了奇怪位置，说明你的路径本身就是奇怪的。

### 我不想让 AI-Output 出现在 vault 根里

两条路：(a) 把 `VAULT_PATH` 指向一个专用的草稿目录；(b) 用完之后把有价值的 AI-Output 手动挪到合适的主题目录，其余删掉。

### `node` 命令报 "stdin is not a tty"

Git Bash (Windows) 下 `node` 被 alias 成 `winpty node.exe`，winpty 在非交互 shell 里会炸。非交互脚本里用 `node.exe` 直接调。跟运行 MCP server 无关——agent host 会正确调 node。

### `generated-at` 时间戳看着不对

server 用 UTC 统一时间。你的本地时钟可能差了一个时区。vault 内所有时间戳都是 UTC，保持一致。

### 安装相关的问题

安装/卸载专项故障排查在 [INSTALL.md § Troubleshooting](INSTALL.md#troubleshooting)。

---

## FAQ

### 必须用 Obsidian 吗？

不。filesystem adapter 独立工作。Obsidian 配合 `obsidian-vault-bridge` 插件可以带来实时同步，但那是可选的。

### 用了 embeddings / 向量库吗？

没有。搜索基于关键词 + wikilink 图。如果你有 10 万条以上笔记需要语义搜索，可以可选启用 `memU` adapter (pgvector)，默认关闭。

### 我的 vault 有一万多条笔记怎么办？

编译阶段在内存里建图，一万条笔记第一次跑大概 30–60 秒。之后的查询很快。真正规模化（十万+）时启用可选的 pgvector adapter。

### 怎么升级？

`cd ~/obsidian-llm-wiki-src && git pull && ./setup`——setup 会重新把最新 bundle 拷过去。

### 对真实 vault 安全吗？

安全。所有修改操作默认 `dryRun: true`。server 拒绝 `VAULT_PATH` 之外的路径，也默认屏蔽 `.obsidian/`、`.trash/`、`.git/`、`node_modules/`。AI-Output 写入只落在一个可整目录删除的子目录里。

### 能换我自己的模型吗？

知识工种不关心模型——它们是 MCP 工具上的 prompt。你的 agent host（Claude Code / Codex / ...）决定模型。

### MCP 工具列表在哪？

自动生成的参考：[mcp-tools-reference.md](mcp-tools-reference.md)。5 个命名空间下 38 个工具。有 CI drift 检查保证文档不过期。

---

## 相关阅读

- [INSTALL.md](INSTALL.md) —— 每个 host 的安装、手工安装、卸载
- [ai-output-convention.md](ai-output-convention.md) —— 沉淀系统的 schema 和生命周期
- [WHY_NOT_JUST_GREP.md](WHY_NOT_JUST_GREP.md) —— 为什么比 grep 强
- [mcp-tools-reference.md](mcp-tools-reference.md) —— 完整工具目录
- [philosophy.md](philosophy.md) —— 设计原则

---

GPL-3.0 协议。见 [LICENSE](../LICENSE)。
