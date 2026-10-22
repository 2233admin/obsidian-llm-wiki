---
tags:
  - bug
  - recipe
priority: p2
created: 2026-09-02
status: open
source: incremental-inspection
responsible: 
---

# 修复 notebooklm-to-vault.md 配方格式错误

## 问题

`recipes/notebooklm-to-vault.md` 中的配方定义格式错误：

```yaml
requires: "vault-path"   # ❌ 错误：必须是数组
```

YAML schema 要求 `requires` 必须是字符串数组，而非单个字符串。这导致配方在测试时被跳过。

## 修复

将 `requires` 改为数组格式：

```yaml
requires:
  - "vault-path"
```

## 验证

```bash
# 运行配方测试确认修复
cd mcp-server && npm test -- --grep "notebooklm-to-vault"
```

## 影响

- 当前：配方被跳过测试
- 修复后：配方通过验证，可用于自动化导入流程

**Why:** 配方格式错误会导致导入工作流在运行时静默失败，影响用户使用体验。

**How to apply:** 直接修改 `recipes/notebooklm-to-vault.md` 的 YAML frontmatter。
