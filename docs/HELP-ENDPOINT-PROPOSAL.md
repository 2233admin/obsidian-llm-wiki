# vault-mind /help Endpoint Proposal

> Date: 2026-04-25
> Source: EvoMap.ai `/a2a/skill?topic=X` + Smart Error Correction (`21-anti-hallucination.md`)
> Status: proposal, not implemented
> Repo: `D:/projects/obsidian-llm-wiki/`

## 1. 问题

vault-mind MCP server 现有 `vault_search` / `vault_read` 工具. agent 想找一个 concept (e.g. "GitNexus") 时, 必须:

1. `vault_search "GitNexus"` 拿 file paths
2. `vault_read` 完整 markdown (整篇 100-300 行)
3. LLM 自己摘要

每次烧 5-10K context, 慢, 概念之间的 cross-link 没有 graph 跳转.

EvoMap 的 `/a2a/skill?topic=X` 解决同样问题: 返回 < 2KB 的结构化 micro-doc, 含 `related_concepts` + `related_endpoints`. 实测让 agent first-call success 从 40% 上到 95%.

## 2. 方案

新增 MCP tool `query_help` (alternatively HTTP-style `GET /help?q=X` for non-MCP clients).

输入: keyword (concept name / vault note title / endpoint path).
输出: 结构化 JSON, < 2KB:

```typescript
interface HelpResult {
  type: 'concept' | 'endpoint' | 'note' | 'not_found';
  matched: string;                     // exact key matched
  title: string;
  summary: string;                     // 1-2 sentence
  content: string;                     // full markdown body, capped at 8000 chars
  related_concepts: Array<{ key: string; title: string }>;
  related_endpoints?: Array<{ method: string; path: string; description: string }>;
  docs_url?: string;                   // obsidian:// or vault path
  source_file: string;                 // absolute vault path
  last_validated_at?: string;          // frontmatter field, not LLM-generated
}
```

**性能目标**: < 10ms p95 (零 LLM 调用).

## 3. 实现

### 3.1 索引层 (Python, `kb_meta.py` 已有基础)

vault-mind 已有 `kb_meta.py` 扫 frontmatter. 扩展加两层 index:

```python
# D:/projects/obsidian-llm-wiki/python/help_index.py
# zero-dep, runs on startup + on file change
import json, os, re, hashlib
from pathlib import Path

VAULT_ROOT = Path(os.environ.get('VAULT_ROOT', 'E:/knowledge'))
INDEX_PATH = VAULT_ROOT / '.vault-mind' / 'help_index.json'

def build_help_index():
    index = {
        'concepts': {},   # key -> {title, summary, source_file, related, frontmatter}
        'endpoints': {},  # path -> {method, description, source_file}
        'aliases': {},    # alias -> canonical key (case-insensitive)
    }
    for md in VAULT_ROOT.rglob('*.md'):
        if any(p.startswith('.') for p in md.parts):
            continue
        text = md.read_text(encoding='utf-8')
        fm, body = _parse_frontmatter(text)
        title = fm.get('title') or md.stem
        key = title.lower()

        summary = fm.get('summary') or _extract_first_paragraph(body)
        related = fm.get('related', []) or _extract_wikilinks(body)

        index['concepts'][key] = {
            'title': title,
            'summary': summary[:300],
            'source_file': str(md.relative_to(VAULT_ROOT)),
            'related': related,
            'last_validated_at': fm.get('last_validated_at'),
        }

        # aliases from frontmatter `aliases:` field
        for alias in fm.get('aliases', []):
            index['aliases'][alias.lower()] = key

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding='utf-8')
    return index


def _parse_frontmatter(text):
    if not text.startswith('---\n'):
        return {}, text
    end = text.find('\n---\n', 4)
    if end < 0:
        return {}, text
    fm_block = text[4:end]
    body = text[end + 5:]
    fm = {}
    for line in fm_block.split('\n'):
        if ':' in line:
            k, _, v = line.partition(':')
            fm[k.strip()] = v.strip().strip('"\'')
    return fm, body


def _extract_first_paragraph(body):
    body = body.strip()
    end = body.find('\n\n')
    return body[:end] if end > 0 else body[:300]


def _extract_wikilinks(body, limit=5):
    return list(set(re.findall(r'\[\[([^\]|]+)', body)))[:limit]
```

启动时 build_help_index. file watcher (chokidar in TS layer) 触发增量更新.

### 3.2 查询层 (TS, MCP tool)

```typescript
// D:/projects/obsidian-llm-wiki/src/tools/help.ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface HelpIndex {
  concepts: Record<string, ConceptEntry>;
  endpoints: Record<string, EndpointEntry>;
  aliases: Record<string, string>;
}

interface ConceptEntry {
  title: string;
  summary: string;
  source_file: string;
  related: string[];
  last_validated_at?: string;
}

interface EndpointEntry {
  method: string;
  description: string;
  source_file: string;
}

const VAULT_ROOT = process.env.VAULT_ROOT ?? 'E:/knowledge';
const INDEX_PATH = join(VAULT_ROOT, '.vault-mind', 'help_index.json');

let _index: HelpIndex | null = null;
let _index_mtime = 0;

function loadIndex(): HelpIndex {
  if (!existsSync(INDEX_PATH)) {
    throw new Error(`help_index.json missing. Run python build_help_index first.`);
  }
  const stat = require('node:fs').statSync(INDEX_PATH);
  if (_index && stat.mtimeMs === _index_mtime) return _index;
  _index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  _index_mtime = stat.mtimeMs;
  return _index!;
}

export interface HelpResult {
  type: 'concept' | 'endpoint' | 'note' | 'not_found';
  matched: string;
  title: string;
  summary: string;
  content: string;
  related_concepts: Array<{ key: string; title: string }>;
  related_endpoints?: Array<{ method: string; path: string; description: string }>;
  source_file: string;
  last_validated_at?: string;
}

export function queryHelp(q: string, opts: { include_content?: boolean } = {}): HelpResult {
  const index = loadIndex();
  const key = q.toLowerCase().trim();

  // 1. exact concept match
  let canonical = index.concepts[key] ? key : index.aliases[key];
  if (canonical && index.concepts[canonical]) {
    const entry = index.concepts[canonical];
    return buildResult('concept', canonical, entry, index, opts.include_content !== false);
  }

  // 2. endpoint path match
  if (index.endpoints[q]) {
    const ep = index.endpoints[q];
    return {
      type: 'endpoint',
      matched: q,
      title: `${ep.method} ${q}`,
      summary: ep.description,
      content: opts.include_content !== false
        ? readFileSync(join(VAULT_ROOT, ep.source_file), 'utf8').slice(0, 8000)
        : '',
      related_concepts: [],
      source_file: ep.source_file,
    };
  }

  // 3. fuzzy fallback: substring against title
  const fuzzy = Object.entries(index.concepts).find(([k]) => k.includes(key) || key.includes(k));
  if (fuzzy) {
    return buildResult('concept', fuzzy[0], fuzzy[1], index, opts.include_content !== false);
  }

  return {
    type: 'not_found',
    matched: q,
    title: '',
    summary: `No concept or endpoint matched "${q}". Try vault_search for full-text fallback.`,
    content: '',
    related_concepts: [],
    source_file: '',
  };
}

function buildResult(
  type: 'concept' | 'note',
  key: string,
  entry: ConceptEntry,
  index: HelpIndex,
  include_content: boolean
): HelpResult {
  const related_concepts = entry.related
    .map(r => {
      const k = r.toLowerCase();
      const canonical = index.concepts[k] ? k : index.aliases[k];
      if (!canonical || !index.concepts[canonical]) return null;
      return { key: canonical, title: index.concepts[canonical].title };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return {
    type,
    matched: key,
    title: entry.title,
    summary: entry.summary,
    content: include_content
      ? readFileSync(join(VAULT_ROOT, entry.source_file), 'utf8').slice(0, 8000)
      : '',
    related_concepts,
    source_file: entry.source_file,
    last_validated_at: entry.last_validated_at,
  };
}
```

### 3.3 MCP tool 注册

```typescript
// D:/projects/obsidian-llm-wiki/src/server.ts (existing file, add tool)
import { queryHelp } from './tools/help.js';

server.tool(
  'query_help',
  'Sub-second concept lookup against vault. Returns structured {type, title, summary, content, related_concepts}. Zero LLM calls. Use this BEFORE vault_search when user asks about a known concept by name.',
  {
    q: { type: 'string', description: 'concept name, note title, or endpoint path' },
    include_content: { type: 'boolean', description: 'include full markdown body (default true)', default: true },
  },
  async ({ q, include_content }) => {
    const result = queryHelp(q, { include_content });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);
```

## 4. 性能 budget

- index 加载: < 5ms (一次, mtime cache)
- query: O(1) hash lookup -> O(n) fuzzy fallback (n = concept count, 估计 < 2000)
- content read: 一个 markdown 文件 read, < 5ms
- 总计 p95 < 10ms

如果 fuzzy fallback 慢 (vault > 5000 notes), 加 trigram index. 现在 911 md, 不需要.

## 5. 跟现有 vault_search 的关系

| 工具 | 何时用 |
|------|--------|
| `query_help(q)` | 用户/agent 知道精确 concept 名 ("查 GitNexus") |
| `vault_search(q)` | 不确定哪个文件 / 模糊搜全文 ("找含 'circuit breaker' 的笔记") |

互补不替换. agent system prompt 加一行: "Before vault_search, try query_help(q) first if q looks like a concept name."

## 6. frontmatter 约定

为了 index 准确, vault 里的 concept 笔记建议加:

```yaml
---
title: GitNexus
aliases: [git-nexus, GitNexus MCP]
summary: 代码图谱 MCP server, 提供 detect_changes/impact/api_impact 等工具用于改前依赖分析
related: [GSD, Code-Review-Workflow]
last_validated_at: 2026-04-22
---
```

不强制, 缺字段 fallback 到 first-paragraph extraction. 但 `last_validated_at` 是用户/agent 显式标的, 不让 LLM 编 "production-ready" / "verified" 这种字符串 (反模式见主档 4.5).

## 7. 不做的事

- **不内嵌 LLM summary**. EvoMap `/a2a/skill/search` 有 `mode=full` 加 LLM summary 收 10 credits, 这破坏"亚秒级零 LLM"核心价值. 永远不接 LLM.
- **不实现 web search fallback**. EvoMap web mode 收 5 credits 调 bocha/gemini -- 单机不需要, web search 走 `vault_externalSearch` 已有工具.
- **不实现 hash chain audit**. vault 在 git 下, 已经有 hash chain. 不重复造.
- **不实现 trust_tier voting**. 单机无 vote. 用 `last_validated_at` + 用户手动维护即可.
- **不写 docstring 和复杂 type annotation**. Python 端 zero-dep 保持. TS 端只写必要的 interface.

## 8. Migration plan

1. **Phase 1** (1 session): `help_index.py` + 单元测试 + CLI `vault-mind index-help`
2. **Phase 2** (1 session): TS `queryHelp` + MCP tool 注册 + e2e test
3. **Phase 3** (后续): file watcher 增量更新 (现在每次 startup rebuild 也够, 911 md 估计 < 200ms)
4. **Phase 4** (后续): vault frontmatter 批量回填 `last_validated_at` 用 user input 不用 LLM 编

## 9. Unresolved Questions

- `aliases` 字段冲突时怎么办 (两个 concept 同一个 alias)? 倾向 last-write-wins + 启动时 warn.
- `content` cap 8000 chars 够不够? EvoMap 用 8000, vault-mind 笔记普遍更长 (Curry 习惯写长文). 扩到 16000?
- 是否要支持 `query_help` 返回多结果 (top-k)? 现在只返回 best match. 简单优先.
- file watcher 用 chokidar 还是 Bun's `Bun.file().watch()`? 后者更快但 vault-mind TS 层是 Node SDK, 兼容性问题.
- python kb_meta.py 已有的 frontmatter parser 跟 help_index.py 重复, 是否应合并? 当前 separation 是 concern 不同 (kb_meta 是 vault-wide stat, help_index 是 lookup index). 等真重复跨 100 行再合.
