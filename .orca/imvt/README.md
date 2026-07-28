# IMVT — Intelligent Machine Validation & Testing

可复用的 Orca 自动化模块模板系统。

## 快速开始

```bash
# 列出所有模块
node .orca/imvt/orca-imvt.js list

# 预览将创建的自动化（不实际创建）
node .orca/imvt/orca-imvt.js apply build-verify morning-summary --dry-run

# 应用模块到项目
node .orca/imvt/orca-imvt.js apply build-verify nightly-regression --all
```

## 模块列表

| 模块 | 名称 | 触发 | 描述 |
|------|------|------|------|
| `build-verify` | 构建验证 | 工作日 08:30 | 验证项目构建 |
| `morning-summary` | 晨间开发摘要 | 工作日 09:00 | 汇总未完成事项 |
| `incremental-check` | 开发增量巡检 | 每 4 小时 | 检查新改动 |
| `nightly-regression` | 夜间回归验证 | 工作日 20:00 | 完整验证 |
| `dep-audit` | 依赖与安全审计 | 每周一 10:00 | 检查依赖更新 |
| `arch-drift` | 架构与文档漂移 | 每周五 10:00 | 检查文档准确性 |
| `session-sync` | Session 同步到 Vault | 每 30 分钟 | 归档 Claude sessions |
| `vault-sync-memu` | Vault 同步到 MemU | 每小时 | vault → 向量数据库 |
| `vault-health` | Vault 健康检查 | 每周日 10:00 | 清理整理 vault |
| `daily-report` | 每日报告写入 Obsidian | 工作日 21:00 | 汇总到 vault |
| `project-health` | 项目健康日报 | 工作日 18:00 | 项目状态汇总 |
| `skills-update` | Skills 更新维护 | 工作日 10:00 | skills 包更新 |

## 自定义模板

编辑 `.orca/imvt/template.yaml` 添加/修改模块：

```yaml
modules:
  my-custom-module:
    name: "我的自定义模块"
    trigger: "0 10 * * *"  # cron 表达式
    description: "模块描述"
    checks:
      - type: build
        cmd: "npm run build"
    output:
      format: markdown
```

## 项目特定配置

在不同项目创建 `.orca/imvt/template.yaml` 覆盖默认设置：

```yaml
version: "1.0"
defaults:
  timezone: "UTC"  # 覆盖时区

modules:
  build-verify:
    trigger: "0 10 * * *"  # 覆盖触发时间
    checks:
      - type: build
        cmd: "make build"  # 覆盖构建命令
```

## CLI 选项

```
orca-imvt list              # 列出所有模块
orca-imvt apply <modules>   # 应用指定模块
orca-imvt apply --all      # 应用所有模块
orca-imvt diff <module>    # 显示模块配置
--dry-run                  # 预览不创建
```

## 模板规范

### 检查类型 (checks.type)

| 类型 | 描述 | 参数 |
|------|------|------|
| `build` | 构建检查 | `dirs`, `cmd` |
| `test` | 测试运行 | `cmd`, `timeout` |
| `lint` | Lint 检查 | `cmd` |
| `typecheck` | 类型检查 | `cmd` |
| `git_status` | Git 状态 | `pattern` |
| `git_log` | Git 日志 | `since` |
| `worktree_count` | Worktree 数量 | `max` |
| `npm_outdated` | npm 过期依赖 | - |
| `npm_audit` | npm 安全审计 | `level` |
| `cargo_outdated` | Cargo 过期依赖 | - |
| `cargo_audit` | Cargo 安全审计 | - |
| `session_summary` | Session 归档 | `db`, `vault` |
| `vault_walk` | Vault 遍历 | `path`, `skip` |
| `stale_projects` | 停滞项目 | `days` |
| `old_inbox` | 过期 inbox | `days` |
| `broken_links` | 悬空引用 | - |
| `automation_summary` | 自动化汇总 | `read_from` |

### 输出格式 (output.format)

| 格式 | 描述 |
|------|------|
| `markdown` | Markdown 格式报告 |
| `structured` | 结构化 JSON |
| `summary` | 简短摘要 |
| `session_note` | Session 笔记 |
| `daily_note` | 每日笔记 |

## 扩展 IMVT

添加新的检查类型：

1. 在 `template.yaml` 添加新模块
2. 在 `orca-imvt.js` 添加对应 prompt
3. 运行 `orca-imvt.js apply <new-module>`

## 状态

- ✅ IMVT 模板系统
- ✅ 13 个预置模块
- ✅ CLI 工具
- ⏳ Orca 原生集成（未来）
