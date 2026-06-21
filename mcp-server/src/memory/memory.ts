import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Operation } from '../core/types.js';

interface MemoryEntry {
  key: string;
  value: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

type MemoryData = Record<string, MemoryEntry>;

class PersistentMemory {
  private readonly filePath: string;

  constructor(vaultPath: string) {
    this.filePath = join(vaultPath, '_ai_memory.json');
  }

  private read(): MemoryData {
    if (!existsSync(this.filePath)) return {};
    try { return JSON.parse(readFileSync(this.filePath, 'utf-8')) as MemoryData; }
    catch { return {}; }
  }

  private write(data: MemoryData): void {
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  set(key: string, value: string, tags: string[] = []): MemoryEntry {
    const data = this.read();
    const now  = new Date().toISOString();
    const entry: MemoryEntry = {
      key,
      value,
      tags,
      created_at: data[key]?.created_at ?? now,
      updated_at: now,
    };
    data[key] = entry;
    this.write(data);
    return entry;
  }

  get(key?: string, tag?: string): MemoryEntry[] {
    const entries = Object.values(this.read());
    if (key) return entries.filter(e => e.key === key);
    if (tag) return entries.filter(e => e.tags.includes(tag));
    return entries;
  }

  forget(key: string): boolean {
    const data = this.read();
    if (!(key in data)) return false;
    delete data[key];
    this.write(data);
    return true;
  }
}

export function makeMemoryOps(vaultPath: string): Operation[] {
  const mem = new PersistentMemory(vaultPath);
  return [
    {
      name: 'memory.set',
      namespace: 'memory' as Operation['namespace'],
      description:
        'Persist a named memory across MCP sessions. Use for inferences, user preferences, ' +
        'project state, or any context that should survive server restarts. ' +
        'Storage: <vault>/_ai_memory.json (excluded from holon compilation).',
      mutating: true,
      params: {
        key:   { type: 'string', required: true,  description: 'Unique memory key, e.g. "project/status" or "user_goal"' },
        value: { type: 'string', required: true,  description: 'Memory content (Markdown supported)' },
        tags:  { type: 'array',  required: false, description: 'Optional tags for grouping, e.g. ["project", "decision"]' },
      },
      handler: async (_ctx, params) => {
        const key   = params.key   as string;
        const value = params.value as string;
        const tags  = (params.tags  as string[] | undefined) ?? [];
        if (!key.trim()) return { error: 'key must not be empty' };
        return mem.set(key, value, tags);
      },
    },

    {
      name: 'memory.get',
      namespace: 'memory' as Operation['namespace'],
      description: 'Retrieve persisted memories by exact key or tag. Returns all memories if neither is specified.',
      mutating: false,
      params: {
        key: { type: 'string', required: false, description: 'Exact key to retrieve' },
        tag: { type: 'string', required: false, description: 'Tag to filter by' },
      },
      handler: async (_ctx, params) => {
        const key = params.key as string | undefined;
        const tag = params.tag as string | undefined;
        const entries = mem.get(key, tag);
        return { count: entries.length, memories: entries };
      },
    },

    {
      name: 'memory.list',
      namespace: 'memory' as Operation['namespace'],
      description: 'List all persisted memories (key, tags, preview, timestamp). Use memory.get to retrieve full values.',
      mutating: false,
      params: {},
      handler: async (_ctx, _params) => {
        const entries = mem.get();
        return {
          count: entries.length,
          memories: entries.map(e => ({
            key:        e.key,
            tags:       e.tags,
            // Defensive: the schema declares value as string, but list previews
            // must not throw if a non-string slipped in (e.g. via direct file
            // edit or older caller). Coerce before slicing.
            preview:    typeof e.value === 'string'
                          ? e.value.slice(0, 120)
                          : String(e.value).slice(0, 120),
            updated_at: e.updated_at,
          })),
        };
      },
    },

    {
      name: 'memory.forget',
      namespace: 'memory' as Operation['namespace'],
      description: 'Delete a persisted memory by key.',
      mutating: true,
      params: {
        key: { type: 'string', required: true, description: 'Key to delete' },
      },
      handler: async (_ctx, params) => {
        const key     = params.key as string;
        const deleted = mem.forget(key);
        return { ok: deleted, key, message: deleted ? 'Deleted' : `Key not found: ${key}` };
      },
    },
  ];
}
