import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import type { JsonRpcResponse } from './ws-transport.js';

const VERSION = '0.4.0-beta.1';

const PROTECTED_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

// ReDoS guard: reject regex patterns with nested quantifiers
function rejectDangerousRegex(pattern: string): void {
  if (/(\([^)]*[+*}]\s*\))[+*{]/.test(pattern))
    throw { code: -32602, message: 'regex rejected: nested quantifiers (ReDoS risk)' };
  if (/\([^)]*\|[^)]*\)[+*{]/.test(pattern) && /(\w)\|.*\1/.test(pattern))
    throw { code: -32602, message: 'regex rejected: overlapping alternation (ReDoS risk)' };
}

interface FrontmatterValue {
  [key: string]: unknown;
}

interface WikiLink {
  link: string;
  displayText: string;
}

interface Heading {
  heading: string;
  level: number;
  position: { line: number };
}

interface BatchOperation {
  method: string;
  params?: Record<string, unknown>;
}

export class FsTransport {
  private vault: string;
  private realVault: string;

  constructor(vaultPath: string) {
    this.vault = path.resolve(vaultPath || '');
    this.realVault = fs.realpathSync(this.vault);
  }

  get vaultPath(): string { return this.vault; }

  normalizeVaultPath(p: string, opts: { allowRoot?: boolean } = {}): string {
    if (typeof p !== 'string') throw { code: -32602, message: 'path required' };
    const raw = p.trim();
    if (opts.allowRoot && (raw === '' || raw === '.' || raw === '/' || raw === './' || raw === '.\\')) {
      return '';
    }
    if (!raw) throw { code: -32602, message: 'path required' };
    if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('//') || path.isAbsolute(raw))
      throw { code: -32602, message: 'path traversal blocked' };
    const normalized = raw.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (normalized.split('/').some((s: string) => s === '..' || s === '.'))
      throw { code: -32602, message: 'path traversal blocked' };
    const topSegment = normalized.split('/')[0];
    if (PROTECTED_DIRS.has(topSegment))
      throw { code: -32602, message: `protected path: ${topSegment}` };
    return normalized;
  }

  resolve(p: string, opts: { allowRoot?: boolean } = {}): string {
    const normalized = this.normalizeVaultPath(p, opts);
    const full = path.resolve(this.vault, normalized);
    const rel = path.relative(this.vault, full);
    if (rel.startsWith('..') || path.isAbsolute(rel))
      throw { code: -32602, message: 'path escapes vault' };
    this.assertRealPathInsideVault(full);
    return full;
  }

  private assertRealPathInsideVault(full: string): void {
    const realTarget = fs.existsSync(full)
      ? fs.realpathSync(full)
      : this.realpathExistingAncestor(path.dirname(full));
    const rel = path.relative(this.realVault, realTarget);
    if (rel.startsWith('..') || path.isAbsolute(rel))
      throw { code: -32602, message: 'path traversal blocked' };
  }

  private realpathExistingAncestor(start: string): string {
    let current = start;
    while (!fs.existsSync(current)) {
      const parent = path.dirname(current);
      if (parent === current)
        throw { code: -32602, message: 'path traversal blocked' };
      current = parent;
    }
    return fs.realpathSync(current);
  }

  parseFrontmatter(content: string): FrontmatterValue | null {
    if (!content.startsWith('---')) return null;
    const end = content.indexOf('\n---', 3);
    if (end === -1) return null;
    const block = content.slice(4, end);
    const fm: FrontmatterValue = {};
    let currentKey: string | null = null;
    let inArray = false;
    let arrayItems: unknown[] = [];
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (inArray && trimmed.startsWith('- ')) {
        arrayItems.push(this._parseYamlValue(trimmed.slice(2).trim()));
        continue;
      }
      if (inArray) { fm[currentKey!] = arrayItems; inArray = false; arrayItems = []; }
      const colon = trimmed.indexOf(':');
      if (colon === -1) continue;
      const key = trimmed.slice(0, colon).trim();
      const rawVal = trimmed.slice(colon + 1).trim();
      currentKey = key;
      if (rawVal === '') { inArray = true; arrayItems = []; continue; }
      if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        fm[key] = rawVal.slice(1, -1).split(',').map((s: string) => this._parseYamlValue(s.trim()));
      } else {
        fm[key] = this._parseYamlValue(rawVal);
      }
    }
    if (inArray) fm[currentKey!] = arrayItems;
    return fm;
  }

  _parseYamlValue(s: string): unknown {
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '~') return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
    return s;
  }

  parseWikilinks(content: string): WikiLink[] {
    const links: WikiLink[] = [];
    const re = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      links.push({ link: m[1], displayText: m[2] || m[1] });
    }
    return links;
  }

  parseTags(content: string): string[] {
    const cleaned = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    const tags: string[] = [];
    const re = /(?:^|\s)#([a-zA-Z_\u4e00-\u9fff][\w/\u4e00-\u9fff-]*)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      tags.push('#' + m[1]);
    }
    return [...new Set(tags)];
  }

  parseHeadings(content: string): Heading[] {
    const headings: Heading[] = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const hm = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (hm) headings.push({ heading: hm[2].trim(), level: hm[1].length, position: { line: i } });
    }
    return headings;
  }

  call(method: string, params: Record<string, unknown> | undefined, id: string | number): Promise<JsonRpcResponse> {
    try {
      const result = this.dispatch(method, params || {});
      return Promise.resolve({ jsonrpc: '2.0' as const, id, result });
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      return Promise.resolve({
        jsonrpc: '2.0' as const, id,
        error: { code: e.code || -32000, message: e.message || String(err) }
      });
    }
  }

  dispatch(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'vault.read': {
        const full = this.resolve(p['path'] as string);
        if (!fs.existsSync(full)) throw { code: -32001, message: `Not found: ${p['path']}` };
        const out: { content: string; currency?: { marker: string; reasons: string[] } } =
          { content: fs.readFileSync(full, 'utf-8') };
        const c = this.currencyByNote().get(((p['path'] as string) || '').replace(/\\/g, '/'));
        if (c) out.currency = c;
        return out;
      }
      case 'vault.exists': {
        const existsPath = this.normalizeVaultPath((p['path'] as string) ?? '', { allowRoot: true });
        return { exists: fs.existsSync(this.resolve(existsPath, { allowRoot: true })) };
      }
      case 'vault.list': {
        const listPath = this.normalizeVaultPath((p['path'] as string) ?? '', { allowRoot: true });
        const dir = this.resolve(listPath, { allowRoot: true });
        if (!fs.existsSync(dir)) throw { code: -32001, message: `Not found: ${p['path']}` };
        const hidden = new Set(['.obsidian', '.trash', 'node_modules']);
        const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => !hidden.has(e.name));
        return {
          files: entries.filter(e => e.isFile()).map(e => path.posix.join(listPath, e.name)).sort(),
          folders: entries.filter(e => e.isDirectory()).map(e => path.posix.join(listPath, e.name)).sort(),
        };
      }
      case 'vault.stat': {
        const statPath = this.normalizeVaultPath((p['path'] as string) ?? '', { allowRoot: true });
        const full = this.resolve(statPath, { allowRoot: true });
        if (!fs.existsSync(full)) throw { code: -32001, message: `Not found: ${p['path']}` };
        const st = fs.statSync(full);
        const displayName = statPath === '' ? path.basename(this.vaultPath) : path.basename(statPath);
        if (st.isDirectory()) return { type: 'folder', path: statPath, name: displayName, children: fs.readdirSync(full).length };
        return { type: 'file', path: statPath, name: displayName, ext: path.extname(statPath).slice(1), size: st.size, ctime: st.ctimeMs, mtime: st.mtimeMs };
      }
      case 'vault.create': {
        const full = this.resolve(p['path'] as string);
        if (fs.existsSync(full)) throw { code: -32002, message: `Already exists: ${p['path']}` };
        if (p['dryRun'] !== false) return { dryRun: true, action: 'create', path: p['path'] };
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, (p['content'] as string) || '', 'utf-8');
        return { ok: true, path: p['path'] };
      }
      case 'vault.modify': {
        const full = this.resolve(p['path'] as string);
        if (!fs.existsSync(full)) throw { code: -32001, message: `Not found: ${p['path']}` };
        if (p['dryRun'] !== false) return { dryRun: true, action: 'modify', path: p['path'] };
        fs.writeFileSync(full, p['content'] as string, 'utf-8');
        return { ok: true, path: p['path'] };
      }
      case 'vault.append': {
        const full = this.resolve(p['path'] as string);
        if (!fs.existsSync(full)) throw { code: -32001, message: `Not found: ${p['path']}` };
        if (p['dryRun'] !== false) return { dryRun: true, action: 'append', path: p['path'] };
        fs.appendFileSync(full, p['content'] as string, 'utf-8');
        return { ok: true, path: p['path'] };
      }
      case 'vault.delete': {
        const full = this.resolve(p['path'] as string);
        if (!fs.existsSync(full)) throw { code: -32001, message: `Not found: ${p['path']}` };
        if (p['dryRun'] !== false) return { dryRun: true, action: 'delete', path: p['path'] };
        fs.rmSync(full, { recursive: true });
        return { ok: true, path: p['path'] };
      }
      case 'vault.mkdir': {
        const full = this.resolve(p['path'] as string);
        if (fs.existsSync(full)) throw { code: -32002, message: `Already exists: ${p['path']}` };
        if (p['dryRun'] !== false) return { dryRun: true, action: 'mkdir', path: p['path'] };
        fs.mkdirSync(full, { recursive: true });
        return { ok: true, path: p['path'] };
      }
      case 'vault.rename': {
        const from = this.resolve(p['from'] as string);
        const to = this.resolve(p['to'] as string);
        if (!fs.existsSync(from)) throw { code: -32001, message: `Not found: ${p['from']}` };
        if (fs.existsSync(to)) throw { code: -32002, message: `Already exists: ${p['to']}` };
        if (p['dryRun'] !== false) return { dryRun: true, action: 'rename', from: p['from'], to: p['to'] };
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
        return { ok: true, from: p['from'], to: p['to'] };
      }
      case 'vault.search': {
        const results: Array<{ path: string; matches: Array<{ line: number; text: string }>; currency?: { marker: string; reasons: string[] } }> = [];
        const max = (p['maxResults'] as number) || 50;
        let total = 0;
        if (typeof p['query'] !== 'string' || (p['query'] as string).length > 500)
          throw { code: -32602, message: 'query must be a string under 500 chars' };
        const flags = p['caseSensitive'] ? 'g' : 'gi';
        let pattern: RegExp;
        try {
          if (p['regex']) rejectDangerousRegex(p['query'] as string);
          pattern = p['regex']
            ? new RegExp(p['query'] as string, flags)
            : new RegExp((p['query'] as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
        } catch (e: unknown) {
          const err = e as { code?: number; message?: string };
          throw { code: err.code || -32602, message: err.message || `Invalid regex: ${err.message}` };
        }
        let rgUsed = false;
        if (!p['regex']) {
        const rgResult = this.searchVaultWithRipgrep(
          p['query'] as string,
          max,
          Boolean(p['caseSensitive']),
          typeof p['glob'] === 'string' ? (p['glob'] as string) : undefined,
        );
        if (rgResult) {
          // ripgrep fast path: adopt its results, then fall through to currency
          // annotation below instead of returning raw (Task 3 markers must apply).
          for (const r of rgResult.results) results.push(r);
          total = rgResult.totalMatches;
          rgUsed = true;
        }
      }

      if (!rgUsed) this.walkMd(this.vault, (relPath: string, content: string) => {
          if (total >= max) return;
          if (p['glob'] && !this.matchGlob(relPath, p['glob'] as string)) return;
          const lines = content.split('\n');
          const matches: Array<{ line: number; text: string }> = [];
          for (let i = 0; i < lines.length && total < max; i++) {
            pattern.lastIndex = 0;
            if (pattern.test(lines[i])) {
              matches.push({ line: i + 1, text: lines[i] });
              total++;
            }
          }
          if (matches.length) results.push({ path: relPath, matches });
        });
        // Task 3: inline currency markers from the compiled report. Ranking/order
        // unchanged -- we only annotate. Node never recomputes.
        const currency = this.currencyByNote();
        if (currency.size) {
          for (const r of results) {
            const c = currency.get(r.path);
            if (c) r.currency = c;
          }
        }
        return { results, totalMatches: total };
      }
      case 'vault.init': {
        if (typeof p['methodology'] === 'string') {
          const scaffolds: Record<string, Array<[string, string]>> = {
            generic: [
              ['00-Inbox', 'Capture zone for unprocessed notes'],
              ['Daily', 'Daily notes (YYYY-MM-DD.md)'],
              ['People', 'Person notes with relationships and context'],
              ['Projects', 'Project notes with status and milestones'],
              ['Decisions', 'Decision logs (ADRs)'],
              ['Meetings', 'Meeting notes with attendees and actions'],
              ['Research', 'Research notes and findings'],
              ['Knowledge', 'Distilled evergreen knowledge'],
              ['Wiki', 'Compiled wiki articles and indexes'],
            ],
            para: [
              ['1-Projects', 'Active projects with goals and deadlines'],
              ['2-Areas', 'Ongoing areas of responsibility'],
              ['3-Resources', 'Topics and references of lasting interest'],
              ['4-Archive', 'Inactive items from the other categories'],
              ['00-Inbox', 'Capture zone for unprocessed notes'],
            ],
            lyt: [
              ['Atlas', 'Maps of Content (MOCs) linking ideas together'],
              ['Calendar', 'Time-based notes (daily, weekly, reviews)'],
              ['Cards', 'Atomic idea notes'],
              ['Extras', 'Templates, attachments, and supporting files'],
              ['00-Inbox', 'Capture zone for unprocessed notes'],
            ],
            zettelkasten: [
              ['fleeting', 'Quick transient captures awaiting processing'],
              ['literature', 'Notes on sources in your own words'],
              ['permanent', 'Evergreen atomic ideas linked into the web'],
              ['references', 'Bibliographic metadata for sources'],
              ['00-Inbox', 'Capture zone for unprocessed notes'],
            ],
          };
          const methodologyNotes: Record<string, string> = {
            generic: 'Generic second-brain layout: inbox capture, daily logs, and typed notes (people, projects, decisions, meetings) feeding research, knowledge, and wiki layers.',
            para: 'PARA (Tiago Forte): organize by actionability -- Projects (active), Areas (ongoing), Resources (interesting), Archive (inactive).',
            lyt: 'LYT (Nick Milo): Atlas holds Maps of Content that link Cards (atomic notes); Calendar anchors notes in time.',
            zettelkasten: 'Zettelkasten (Luhmann): fleeting captures get processed into literature notes, then distilled into permanent atomic notes linked into a web.',
          };
          const methodology = p['methodology'] as string;
          const scaffold = scaffolds[methodology];
          if (!scaffold) throw { code: -32602, message: `methodology must be one of ${Object.keys(scaffolds).join('|')}` };
          const dryRun = p['dryRun'] !== false;
          const created: string[] = [];
          const skipped: string[] = [];
          const today = new Date().toISOString().slice(0, 10);
          for (const [dir] of scaffold) {
            const full = this.resolve(dir);
            if (fs.existsSync(full)) { skipped.push(dir); continue; }
            if (!dryRun) fs.mkdirSync(full, { recursive: true });
            created.push(dir);
          }
          const folderLines = scaffold.map(([dir, purpose]) => `- [[${dir}/README|${dir}]] -- ${purpose}`).join('\n');
          const homeContent = `---\ntype: index\nai-first: true\nmethodology: ${methodology}\ncreated: ${today}\n---\n\n# Home\n\n## For future Claude\n${methodologyNotes[methodology]}\n\n## Folders\n\n${folderLines}\n`;
          const homeFull = this.resolve('Home.md');
          if (fs.existsSync(homeFull)) {
            skipped.push('Home.md');
          } else {
            if (!dryRun) fs.writeFileSync(homeFull, homeContent, 'utf-8');
            created.push('Home.md');
          }
          return { ok: true, dryRun, methodology, created, skipped, summary: `Created ${created.length}, skipped ${skipped.length}` };
        }
        if (!p['topic'] || typeof p['topic'] !== 'string') throw { code: -32602, message: 'topic or methodology required' };
        if ((p['topic'] as string).split('/').some((s: string) => s === '..' || s === '.')) throw { code: -32602, message: 'path traversal blocked' };
        const created: string[] = [], skipped: string[] = [];
        const base = p['topic'] as string;
        const now = new Date().toISOString().slice(0, 10);
        const ensureDir = (rel: string) => {
          const full = this.resolve(rel);
          if (fs.existsSync(full)) { skipped.push(rel); return; }
          fs.mkdirSync(full, { recursive: true });
          created.push(rel);
        };
        const ensureFile = (rel: string, content: string) => {
          const r = rel.endsWith('.md') ? rel : rel + '.md';
          const full = this.resolve(r);
          if (fs.existsSync(full)) { skipped.push(r); return; }
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, content, 'utf-8');
          created.push(r);
        };
        ensureDir(base);
        for (const sub of ['raw', 'raw/articles', 'raw/papers', 'raw/notes', 'raw/transcripts', 'wiki', 'wiki/summaries', 'wiki/concepts', 'wiki/queries', 'schema']) ensureDir(`${base}/${sub}`);
        ensureFile(`${base}/wiki/_index.md`, `---\ntopic: "${p['topic']}"\nupdated: ${now}\n---\n\n# ${p['topic']} -- Knowledge Index\n\nNo articles compiled yet.\n`);
        ensureFile(`${base}/wiki/_sources.md`, `---\ntopic: "${p['topic']}"\nupdated: ${now}\n---\n\n# Sources\n\nNo sources compiled yet.\n`);
        ensureFile(`${base}/wiki/_categories.md`, `---\ntopic: "${p['topic']}"\nupdated: ${now}\n---\n\n# Categories\n\nAuto-generated during compilation.\n`);
        ensureFile(`${base}/Log.md`, `# ${p['topic']} -- Operation Log\n\n- ${now}: KB initialized\n`);
        ensureFile(`${base}/schema/CLAUDE.md`, `# ${p['topic']} -- KB Schema\n\nFollows llm-wiki opinionated workflow.\nSee root CLAUDE.md for full documentation.\n`);
        const yamlPath = `${base}/kb.yaml`;
        if (fs.existsSync(this.resolve(yamlPath))) { skipped.push(yamlPath); }
        else { fs.writeFileSync(this.resolve(yamlPath), `topic: "${p['topic']}"\nvault_path: "${this.vault.replace(/\\\\/g, '/')}"\ncreated: ${now}\n`, 'utf-8'); created.push(yamlPath); }
        return { ok: true, topic: p['topic'], created, skipped, summary: `Created ${created.length}, skipped ${skipped.length}` };
      }
      case 'vault.getMetadata': {
        const full = this.resolve(p['path'] as string);
        if (!fs.existsSync(full)) throw { code: -32001, message: `Not found: ${p['path']}` };
        const content = fs.readFileSync(full, 'utf-8');
        const out: Record<string, unknown> = {};
        const links = this.parseWikilinks(content);
        if (links.length) out['links'] = links.map((l: WikiLink) => ({ link: l.link, displayText: l.displayText }));
        const tags = this.parseTags(content);
        if (tags.length) out['tags'] = tags.map((t: string) => ({ tag: t }));
        const headings = this.parseHeadings(content);
        if (headings.length) out['headings'] = headings;
        const fm = this.parseFrontmatter(content);
        if (fm) out['frontmatter'] = fm;
        return out;
      }
      case 'vault.searchByTag': {
        if (!p['tag']) throw { code: -32602, message: 'tag required' };
        const bare = (p['tag'] as string).startsWith('#') ? (p['tag'] as string).slice(1) : (p['tag'] as string);
        const hashTag = '#' + bare;
        const files: string[] = [];
        this.walkMd(this.vault, (relPath: string, content: string) => {
          const tags = this.parseTags(content);
          if (tags.includes(hashTag)) { files.push(relPath); return; }
          const fm = this.parseFrontmatter(content);
          const fmTags = (fm?.['tags'] ?? fm?.['tag']) as unknown;
          if (Array.isArray(fmTags) && (fmTags as unknown[]).includes(bare)) { files.push(relPath); }
          else if (typeof fmTags === 'string' && fmTags === bare) { files.push(relPath); }
        });
        return { files: files.sort() };
      }
      case 'vault.searchByFrontmatter': {
        if (!p['key']) throw { code: -32602, message: 'key required' };
        const op = (p['op'] as string) || 'eq';
        const validOps = ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'regex', 'exists'];
        if (!validOps.includes(op)) throw { code: -32602, message: `Unknown op: ${op}. Valid: ${validOps.join(', ')}` };
        const results: Array<{ path: string; value: unknown }> = [];
        this.walkMd(this.vault, (relPath: string, content: string) => {
          const fm = this.parseFrontmatter(content);
          if (!fm) return;
          if (op === 'exists') {
            if ((p['key'] as string) in fm) results.push({ path: relPath, value: fm[p['key'] as string] });
            return;
          }
          if (!(p['key'] as string in fm)) return;
          const v = fm[p['key'] as string];
          let match = false;
          switch (op) {
            case 'eq': match = v === p['value']; break;
            case 'ne': match = v !== p['value']; break;
            case 'gt': match = typeof v === 'number' && typeof p['value'] === 'number' && v > (p['value'] as number); break;
            case 'lt': match = typeof v === 'number' && typeof p['value'] === 'number' && v < (p['value'] as number); break;
            case 'gte': match = typeof v === 'number' && typeof p['value'] === 'number' && v >= (p['value'] as number); break;
            case 'lte': match = typeof v === 'number' && typeof p['value'] === 'number' && v <= (p['value'] as number); break;
            case 'contains': match = typeof v === 'string' && typeof p['value'] === 'string' && v.includes(p['value'] as string); break;
            case 'regex':
              try {
                if (typeof p['value'] === 'string') rejectDangerousRegex(p['value'] as string);
                match = typeof v === 'string' && typeof p['value'] === 'string' && new RegExp(p['value'] as string).test(v);
              } catch { match = false; }
              break;
            default: match = v === p['value'];
          }
          if (match) results.push({ path: relPath, value: v });
        });
        return { files: results.sort((a, b) => a.path.localeCompare(b.path)) };
      }
      case 'vault.graph': {
        const type = (p['type'] as string) || 'both';
        const nodeSet = new Set<string>();
        const edgeMap = new Map<string, number>();
        const inbound = new Set<string>();
        this.walkMd(this.vault, (relPath: string, content: string) => {
          nodeSet.add(relPath);
          const links = this.parseWikilinks(content);
          for (const l of links) {
            if (l.link.startsWith('#')) continue;
            let target = l.link.split('#')[0];
            if (!target) continue;
            if (!target.includes('/')) {
              const withMd = target.endsWith('.md') ? target : target + '.md';
              if (fs.existsSync(this.resolve(withMd))) target = withMd;
            }
            if (!target.endsWith('.md')) target += '.md';
            nodeSet.add(target);
            inbound.add(target);
            const key = relPath + '\0' + target;
            edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
          }
        });
        const edges: Array<{ from: string; to: string; count: number }> = [];
        for (const [key, count] of edgeMap) {
          const [from, to] = key.split('\0');
          edges.push({ from, to, count });
        }
        const nodes = Array.from(nodeSet).sort().map(nodePath => ({
          path: nodePath, exists: fs.existsSync(this.resolve(nodePath))
        }));
        const orphans = type === 'resolved' || type === 'both'
          ? nodes.filter(n => n.exists && n.path.endsWith('.md') && !inbound.has(n.path)).map(n => n.path)
          : [];
        return { nodes, edges, orphans };
      }
      case 'vault.backlinks': {
        if (!p['path']) throw { code: -32602, message: 'path required' };
        const target = (p['path'] as string).endsWith('.md') ? (p['path'] as string) : (p['path'] as string) + '.md';
        const targetBase = path.basename(target, '.md');
        const results: Array<{ from: string; count: number }> = [];
        this.walkMd(this.vault, (relPath: string, content: string) => {
          if (relPath === target) return;
          const links = this.parseWikilinks(content);
          let count = 0;
          for (const l of links) {
            const linkPath = l.link.split('#')[0];
            if (!linkPath) continue;
            if (linkPath === target || linkPath === targetBase || linkPath + '.md' === target) count++;
          }
          if (count > 0) results.push({ from: relPath, count });
        });
        return { backlinks: results.sort((a, b) => a.from.localeCompare(b.from)) };
      }
      case 'vault.batch': {
        if (!Array.isArray(p['operations'])) throw { code: -32602, message: 'operations must be an array' };
        const results: Array<{ index: number; ok: boolean; result?: unknown; error?: { code: number; message: string } }> = [];
        let succeeded = 0, failed = 0;
        const operations = p['operations'] as BatchOperation[];
        for (let i = 0; i < operations.length; i++) {
          const op = operations[i];
          if (!op.method?.startsWith('vault.')) throw { code: -32602, message: `Batch only supports vault.* methods (index ${i})` };
          if (op.method === 'vault.batch') throw { code: -32602, message: 'Recursive batch not allowed' };
          try {
            const params: Record<string, unknown> = { ...(op.params || {}) };
            if (p['dryRun'] !== undefined) params['dryRun'] = p['dryRun'];
            const result = this.dispatch(op.method, params);
            results.push({ index: i, ok: true, result });
            succeeded++;
          } catch (err: unknown) {
            const e = err as { code?: number; message?: string };
            results.push({ index: i, ok: false, error: { code: e.code || -32000, message: e.message || String(err) } });
            failed++;
          }
        }
        return { results, summary: { total: operations.length, succeeded, failed } };
      }
      case 'vault.lint': {
        const requiredFm = Array.isArray(p['requiredFrontmatter']) ? p['requiredFrontmatter'] as string[] : [];
        const allFiles: Array<{ path: string; size: number; content: string }> = [];
        const linkMap = new Map<string, Map<string, number>>();
        const inbound = new Set<string>();
        this.walkMd(this.vault, (relPath: string, content: string) => {
          const st = fs.statSync(this.resolve(relPath));
          allFiles.push({ path: relPath, size: st.size, content });
          const links = this.parseWikilinks(content);
          const targets = new Map<string, number>();
          for (const l of links) {
            const t = l.link.endsWith('.md') ? l.link : l.link + '.md';
            targets.set(t, (targets.get(t) || 0) + 1);
          }
          linkMap.set(relPath, targets);
          for (const t of targets.keys()) inbound.add(t);
        });
        const orphans = allFiles.filter(f => !inbound.has(f.path)).map(f => f.path).sort();
        const brokenLinks: Array<{ from: string; to: string }> = [];
        for (const [from, targets] of linkMap) {
          for (const [to] of targets) {
            if (!fs.existsSync(this.resolve(to))) brokenLinks.push({ from, to });
          }
        }
        const emptyFiles = allFiles.filter(f => f.size === 0).map(f => f.path).sort();
        const missingFm: Array<{ path: string; missing: string[] }> = [];
        if (requiredFm.length > 0) {
          for (const f of allFiles) {
            const fm = this.parseFrontmatter(f.content) || {};
            const missing = requiredFm.filter((k: string) => !(k in fm));
            if (missing.length > 0) missingFm.push({ path: f.path, missing });
          }
        }
        const titleMap = new Map<string, string[]>();
        for (const f of allFiles) {
          const t = path.basename(f.path, '.md').toLowerCase();
          const arr = titleMap.get(t) || [];
          arr.push(f.path);
          titleMap.set(t, arr);
        }
        const duplicates = Array.from(titleMap.entries())
          .filter(([, paths]) => paths.length > 1)
          .map(([title, files]) => ({ title, files: files.sort() }));
        let totalLinks = 0;
        for (const targets of linkMap.values()) for (const c of targets.values()) totalLinks += c;
        return {
          orphans, brokenLinks, emptyFiles, missingFrontmatter: missingFm, duplicateTitles: duplicates,
          stats: { totalFiles: allFiles.length, totalLinks, totalOrphans: orphans.length, totalBroken: brokenLinks.length, totalEmpty: emptyFiles.length, totalDuplicates: duplicates.length }
        };
      }
      case 'vault.externalSearch':
        return { available: false, message: 'No external search engine configured' };
      case 'listCapabilities':
        return { methods: ['vault.read', 'vault.create', 'vault.modify', 'vault.append', 'vault.delete', 'vault.rename', 'vault.mkdir', 'vault.search', 'vault.list', 'vault.stat', 'vault.exists', 'vault.init', 'vault.getMetadata', 'vault.searchByTag', 'vault.searchByFrontmatter', 'vault.graph', 'vault.backlinks', 'vault.batch', 'vault.lint', 'vault.externalSearch'], version: VERSION };
      default:
        throw { code: -32601, message: `Unknown method: ${method}` };
    }
  }

  // Currency layer (Task 3): read the compiled report(s) the Python passes emit
  // at <topic>/wiki/_currency.json and map note_id -> verdict. Pure read; the
  // connector never recomputes. Missing/corrupt report -> no annotation, no throw.
  currencyByNote(): Map<string, { marker: string; reasons: string[] }> {
    const out = new Map<string, { marker: string; reasons: string[] }>();
    try {
      for (const ent of fs.readdirSync(this.vault, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const reportPath = path.join(this.vault, ent.name, 'wiki', '_currency.json');
        if (!fs.existsSync(reportPath)) continue;
        let data: { byNote?: Record<string, { marker?: string; reasons?: string[] }> };
        try { data = JSON.parse(fs.readFileSync(reportPath, 'utf-8')); }
        catch { continue; }  // corrupt report -> skip, never break search
        for (const [noteId, info] of Object.entries(data.byNote ?? {})) {
          const marker = info?.marker;
          if (!marker) continue;
          const existing = out.get(noteId);
          // across topics a non-OK verdict wins over OK so staleness is not masked
          if (!existing || (existing.marker === 'OK' && marker !== 'OK')) {
            out.set(noteId, { marker, reasons: info.reasons ?? [] });
          }
        }
      }
    } catch { /* vault root unreadable -> no annotation */ }
    return out;
  }

  private searchVaultWithRipgrep(
    query: string,
    max: number,
    caseSensitive: boolean,
    glob?: string,
  ): { results: Array<{ path: string; matches: Array<{ line: number; text: string }> }>; totalMatches: number } | null {
    if (!query) return null;

    const args = ["--files-with-matches", "--fixed-strings", "--max-count", "1"];
    if (!caseSensitive) args.push("-i");
    if (glob) args.push("--glob", glob);
    args.push("--", query, this.vault);

    let stdout = "";
    try {
      stdout = execFileSync("rg", args, { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
    } catch (err: unknown) {
      const code = (err as { status?: number; code?: number | string }).status ?? (err as { code?: number | string }).code;
      if (code === 1) return { results: [], totalMatches: 0 };
      return null;
    }

    const results: Array<{ path: string; matches: Array<{ line: number; text: string }> }> = [];
    let total = 0;
    for (const filePath of stdout.split(/\r?\n/).filter(Boolean)) {
      if (total >= max) break;
      const full = path.resolve(filePath);
      const rel = path.relative(this.vault, full).replace(/\\/g, "/");
      if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
      if (glob && !this.matchGlob(rel, glob)) continue;

      let content = "";
      try {
        content = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }

      const matches = this.findLiteralMatches(content, query, max - total, caseSensitive);
      if (matches.length > 0) {
        total += matches.length;
        results.push({ path: rel, matches });
      }
    }

    return { results, totalMatches: total };
  }

  private findLiteralMatches(
    content: string,
    query: string,
    max: number,
    caseSensitive: boolean,
  ): Array<{ line: number; text: string }> {
    if (max <= 0) return [];
    const needle = caseSensitive ? query : query.toLowerCase();
    const lines = content.split(/\r?\n/);
    const matches: Array<{ line: number; text: string }> = [];

    for (let i = 0; i < lines.length && matches.length < max; i++) {
      const haystack = caseSensitive ? lines[i] : lines[i].toLowerCase();
      if (haystack.includes(needle)) matches.push({ line: i + 1, text: lines[i] });
    }

    return matches;
  }

  walkMd(dir: string, fn: (relPath: string, content: string) => void): void {
    const visited = new Set<string>();
    const insideVault = (realPath: string): boolean => {
      const rel = path.relative(this.realVault, realPath);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    };

    const walk = (d: string) => {
      let realDir: string;
      try {
        realDir = fs.realpathSync(d);
      } catch {
        return;
      }
      if (!insideVault(realDir) || visited.has(realDir)) return;
      visited.add(realDir);

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }

      for (const ent of entries) {
        if (PROTECTED_DIRS.has(ent.name)) continue;
        const full = path.join(d, ent.name);

        let st: fs.Stats;
        try {
          st = fs.lstatSync(full);
        } catch {
          continue;
        }
        if (st.isSymbolicLink()) continue;

        if (st.isDirectory()) {
          let realChild: string;
          try {
            realChild = fs.realpathSync(full);
          } catch {
            continue;
          }
          if (insideVault(realChild)) walk(full);
        } else if (st.isFile() && ['.md', '.canvas', '.base'].includes(path.extname(ent.name))) {
          const rel = path.relative(this.vault, full).replace(/\\/g, '/');
          fn(rel, fs.readFileSync(full, 'utf-8'));
        }
      }
    };
    walk(dir);
  }

  matchGlob(p: string, glob: string): boolean {
    const re = new RegExp('^' + glob.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '$');
    return re.test(p);
  }

  async execute(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.dispatch(method, params);
  }

  close(): void {}
}
