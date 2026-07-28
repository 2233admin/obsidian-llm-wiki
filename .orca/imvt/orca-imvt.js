#!/usr/bin/env node
/**
 * orca-imvt -- Apply IMVT template to create/update Orca automations
 *
 * Usage:
 *   node orca-imvt.js apply [--project PROJECT] [--modules a,b,c] [--dry-run]
 *   node orca-imvt.js list
 *   node orca-imvt.js diff [--module MODULE]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yaml from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

// IMVT Prompt Templates
const PROMPT_TEMPLATES = {
  'build-verify': `你是构建验证 agent。请验证项目构建状态：

1. 对以下目录运行 npm run build：
   - mcp-server/
   - obsidian-plugin/
   - packages/

2. 检查构建产物是否生成

3. 输出格式：
## 构建验证 [日期]

### ✅ 通过
- [目录]: [产物路径]

### ❌ 失败
- [目录]: [错误]

约束：只报告，不自动修复`,

  'morning-summary': `你是开发摘要 agent。请执行晨间摘要：

1. git status --short（未提交改动）
2. git worktree list（活跃 worktree）
3. 检查失败测试

输出格式：
## 晨间开发摘要 [日期]

### 未提交改动
- [文件]: [改动]

### 活跃 worktree
- [路径]: [分支]

### 当天前三项
1. [优先项]
2. [优先项]
3. [优先项]

约束：简洁、直接`,

  'nightly-regression': `你是回归验证 agent。请执行完整验证：

1. 创建临时 worktree
2. 运行：
   - npm run lint
   - npm run typecheck
   - npm run build
   - npm test (timeout: 180s)
   - cargo test (如果有 Rust 项目)

3. 只报告失败根因

4. 清理临时 worktree

输出格式：
## 夜间回归验证 [日期]

### ✅ 通过
- [项目]: [通过项]

### ❌ 失败
- [项目]: [失败根因]

### 总结
总通过: X/Y 项目`,

  'dep-audit': `你是安全审计 agent。请执行依赖检查：

1. 运行：
   - npm outdated
   - npm audit --audit-level=high
   - cargo outdated
   - cargo audit

2. 按优先级分组：
   - 安全补丁（必须升级）
   - Major 更新（说明风险）
   - 其他更新

输出格式：
## 依赖与安全审计 [日期]

### 🔴 必须升级（安全）
- [项目]: [依赖] - [问题]

### 🟡 建议升级
- [项目]: [依赖] v[X] → v[Y]

约束：只提建议，不自动升级`,

  'arch-drift': `你是架构审计 agent。请检查文档漂移：

1. 检查 README 命令是否与实际匹配
2. 检查代码是否符合架构文档
3. 检查测试覆盖率

输出格式：
## 架构与文档漂移 [日期]

### 📖 文档问题
- [文档]: [问题]

### 🏗️ 架构违规
- [模块]: [描述]

约束：只报告，不自动修复`,

  'session-sync': `你是 vault 同步 agent。请归档 Claude sessions：

1. 读取 ~/.claude-mem/claude-mem.db
2. 检查 ~/.vault-mind/claude-mem-sync/state.json
3. 归档新 sessions 到 vault

输出：静默，错误记录日志`,

  'vault-sync-memu': `你是 vault → MemU 同步 agent：

1. 读取 vault 状态
2. 计算 hash diff
3. 同步变化到 MemU

命令：
cd D:/projects/obsidian-llm-wiki
python -m compiler.memu_sync --vault "D:/Obsidian Vault"

输出：静默运行`,

  'vault-health': `你是 vault 维护 agent。请执行健康检查：

1. 扫描超过 7 天无更新的活跃项目
2. 检查超过 30 天的 inbox 笔记
3. 扫描悬空引用
4. 检查模板完整性

输出格式：
## Vault 健康检查 [日期]

### 问题
- [类型]: [描述]

### 清理
- [操作]: [结果]

约束：只归档，不删除`,

  'daily-report': `你是报告 agent。请汇总自动化结果：

1. 读取 C:/Users/Administrator/AppData/Roaming/orca/profiles/local-default/orca-data.json
2. 提取今日自动化运行结果
3. 写入 vault 报告

输出路径：06-Daily/[日期]-自动化报告.md`,

  'project-health': `你是健康报告 agent。请汇总项目状态：

检查项目：
- obsidian-llm-wiki
- oh-my-claudecode
- omc-hub-rs

输出格式：
## 项目健康日报 [日期]

### 项目状态
- [项目]: [状态]`,

  'skills-update': `你是 skills 维护 agent。请检查 skills 更新：

1. 检查 skills 包最新版本
2. 运行 skills-diff
3. 报告更新

输出格式：
## Skills 更新 [日期]

### 可用更新
- [skill]: [版本变化]`,

  'incremental-check': `你是增量巡检 agent。请检查变化：

1. 读取上次巡检状态
2. git log --since=[上次时间]
3. 检查失败项状态

输出格式：
## 增量巡检 [时间]

### 新增改动
- [N] commits

### 失败项状态
- [项]: [状态]`
};

function loadTemplate(templatePath) {
  const content = readFileSync(templatePath, 'utf-8');
  return yaml.parse(content);
}

function getCronForModule(module) {
  return module.trigger || '0 9 * * 1-5';
}

function generatePrompt(module, template) {
  if (PROMPT_TEMPLATES[module.name]) {
    return PROMPT_TEMPLATES[module.name];
  }
  return module.description || `执行 ${module.name} 任务`;
}

function runOrca(args) {
  const result = spawnSync('orca', args, { encoding: 'utf-8', stdio: 'pipe' });
  return result;
}

async function applyModules(projectId, modules, dryRun = false) {
  const template = loadTemplate(join(__dirname, 'template.yaml'));

  console.log(`\n📦 IMVT: Applying ${modules.length} modules to ${projectId}`);
  console.log(`   Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}\n`);

  for (const moduleName of modules) {
    const module = template.modules[moduleName];
    if (!module) {
      console.log(`⚠️  Module not found: ${moduleName}`);
      continue;
    }

    const trigger = getCronForModule(module);
    const prompt = generatePrompt(module, template);

    console.log(`\n📤 Creating: ${module.name} (${trigger})`);

    if (dryRun) {
      console.log(`   [DRY-RUN] Would create with prompt length: ${prompt.length}`);
      continue;
    }

    const args = [
      'automations', 'create',
      '--name', module.name,
      '--trigger', trigger,
      '--timezone', template.defaults.timezone,
      '--provider', template.defaults.provider,
      '--prompt', prompt,
      '--project-host-setup', projectId,
      '--workspace-mode', template.defaults.workspace_mode,
      '--json'
    ];

    const result = runOrca(args);

    try {
      const output = JSON.parse(result.stdout);
      if (output.ok) {
        console.log(`   ✅ Created: ${output.result.automation.id}`);
      } else {
        console.log(`   ❌ Error: ${output.error?.message || output.error}`);
      }
    } catch {
      console.log(`   ⚠️  Parse error: ${result.stdout.slice(0, 200)}`);
    }
  }
}

async function listModules() {
  const template = loadTemplate(join(__dirname, 'template.yaml'));

  console.log('\n📋 IMVT Modules\n');

  for (const [name, module] of Object.entries(template.modules)) {
    console.log(`  ${name}`);
    console.log(`    Name: ${module.name}`);
    console.log(`    Trigger: ${module.trigger || 'inherit from template'}`);
    console.log(`    Description: ${module.description}`);
    console.log();
  }
}

// CLI
const [,, cmd, ...args] = process.argv;

if (cmd === 'list') {
  listModules();
} else if (cmd === 'apply') {
  const dryRun = args.includes('--dry-run');
  const projectId = args.find(a => !a.startsWith('--')) || '463f35a8-899c-4122-9331-6643ac153505';
  const modules = args.includes('--all')
    ? Object.keys(loadTemplate(join(__dirname, 'template.yaml')).modules)
    : args.filter(a => !a.startsWith('--'));

  applyModules(projectId, modules.length ? modules : ['build-verify', 'morning-summary'], dryRun);
} else if (cmd === 'diff') {
  const template = loadTemplate(join(__dirname, 'template.yaml'));
  const moduleName = args.find(a => !a.startsWith('--'));

  if (moduleName && template.modules[moduleName]) {
    console.log(yaml.stringify(template.modules[moduleName]));
  }
} else {
  console.log(`
IMVT - Intelligent Machine Validation & Testing

Usage:
  orca-imvt list              # List all modules
  orca-imvt apply [modules]   # Apply modules to project
  orca-imvt diff <module>    # Show module config

Options:
  --dry-run    Preview without creating
  --all       Apply all modules

Examples:
  orca-imvt list
  orca-imvt apply build-verify morning-summary
  orca-imvt apply --all --dry-run
  `);
}
