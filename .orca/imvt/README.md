# IMVT — Intelligent Machine Validation & Testing

> **I am waiting** — 让机器帮你盯着，你只管解决问题。

IMVT 是一套可复用的 Orca 自动化模块系统，通过定时触发让 AI Agent 自动执行开发运维、知识管理、记忆追踪等任务。

## 安装

### 方式一：Clone 后应用

```bash
# 克隆 IMVT 模板仓库
git clone https://git.xart.top:8418/Curry/imvt.git ~/.imvt

# 或下载到项目
git clone https://git.xart.top:8418/Curry/imvt.git .orca/imvt
```

### 方式二：从现有项目复制

```bash
# 复制到你的 Orca 项目
cp -r ~/.imvt/orca/imvt /your/project/.orca/

# 安装依赖（如需要）
cd /your/project
npm install yaml --save-dev
```

## 快速开始

```bash
# 1. 列出所有模块
node .orca/imvt/orca-imvt.js list

# 2. 预览将创建的自动化（不实际创建）
node .orca/imvt/orca-imvt.js apply --all --dry-run

# 3. 应用所有模块到项目
node .orca/imvt/orca-imvt.js apply --all

# 4. 应用指定模块
node .orca/imvt/orca-imvt.js apply build-verify session-resume
```

## 是什么

IMVT 是一个**自动化模块模板库**，每个模块定义了：

- **触发时间** (cron 表达式)
- **检查项** (checks)
- **输出格式** (output)
- **Prompt 模板** (AI 指令)

```yaml
# 示例：build-verify 模块
build-verify:
  name: "构建验证"
  trigger: "0 8:30 * * 1-5"  # 工作日 08:30
  checks:
    - type: build
      dirs: ["mcp-server", "obsidian-plugin"]
      cmd: "npm run build"
```

## 模块列表

### 开发运营 (Development)

| 模块 | 触发 | 描述 |
|------|------|------|
| `build-verify` | 工作日 08:30 | 验证项目构建 |
| `morning-summary` | 工作日 09:00 | 晨间开发摘要 |
| `incremental-check` | 每 4 小时 | 开发增量巡检 |
| `nightly-regression` | 工作日 20:00 | 夜间回归验证 |
| `dep-audit` | 每周一 10:00 | 依赖与安全审计 |
| `arch-drift` | 每周五 10:00 | 架构与文档漂移 |

### 记忆追踪 (Memory — "I am waiting")

| 模块 | 触发 | 描述 |
|------|------|------|
| `session-resume` | 工作日 09:00 | 提醒继续未完成的 session 工作 |
| `inbox-to-issue` | 工作日 10:00 | 将 inbox 待办转成 project issue |
| `project-followup` | 每周一 10:00 | 检查已完成项目，追问效果 |
| `commit-from-session` | 工作日 22:00 | 从 session 提取改动，提示 commit |

### 同步工具 (Sync)

| 模块 | 触发 | 描述 |
|------|------|------|
| `session-sync` | 每 30 分钟 | 归档 Claude Code sessions 到 Obsidian |
| `vault-sync-memu` | 每小时 | Obsidian vault → MemU 向量数据库 |
| `vault-health` | 每周日 10:00 | Vault 健康检查与清理 |

### 报告 (Reporting)

| 模块 | 触发 | 描述 |
|------|------|------|
| `daily-report` | 工作日 21:00 | 汇总所有自动化结果写入 Obsidian |
| `project-health` | 工作日 18:00 | 项目健康日报 |
| `skills-update` | 工作日 10:00 | Skills 包更新维护 |

## 自定义模块

### 添加新模块

1. 编辑 `template.yaml`：

```yaml
modules:
  my-module:
    name: "我的模块"
    trigger: "0 10 * * *"
    description: "模块描述"
    checks:
      - type: custom_check
        cmd: "npm run my-check"
```

2. 在 `orca-imvt.js` 添加对应 prompt：

```javascript
'my-module': `你是自定义 agent。请执行任务...

输出格式：
## 我的模块 [日期]

...
`
```

3. 应用到项目：

```bash
node .orca/imvt/orca-imvt.js apply my-module
```

### 覆盖默认设置

在项目根目录创建 `.orca/imvt/template.yaml`：

```yaml
version: "1.0"
defaults:
  timezone: "UTC"  # 覆盖时区

modules:
  build-verify:
    trigger: "0 12 * * *"  # 覆盖触发时间
    checks:
      - type: build
        cmd: "make build"  # 覆盖命令
```

## CLI 参考

```
IMVT CLI — Intelligent Machine Validation & Testing

用法:
  orca-imvt list              # 列出所有模块
  orca-imvt apply <模块>...   # 应用模块到项目
  orca-imvt diff <模块>       # 显示模块配置
  orca-imvt --dry-run         # 预览不创建

示例:
  orca-imvt list
  orca-imvt apply build-verify morning-summary
  orca-imvt apply --all --dry-run
  orca-imvt diff session-resume
```

## 常见问题

### Q: Orca 自动化是什么？

A: Orca 的自动化是基于定时触发（cron）运行的 Claude Code sessions。每个自动化会在指定时间自动启动一个 Claude session 执行任务。

### Q: IMVT 和 Orca 自动化有什么区别？

A: Orca 自动化需要手动创建和配置。IMVT 是**模板**，通过 YAML 定义模块，一行命令批量生成 Orca 自动化。

### Q: 如何查看已创建的自动化？

```bash
orca automations list
```

### Q: 如何删除不需要的自动化？

```bash
orca automations remove <automation-id>
```

## 贡献

欢迎贡献新模块！

1. Fork 仓库
2. 添加模块到 `template.yaml`
3. 添加对应的 prompt 到 `orca-imvt.js`
4. 更新本 README
5. PR

## License

MIT
