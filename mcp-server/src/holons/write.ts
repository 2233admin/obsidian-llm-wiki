import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Operation } from '../core/types.js';
import type { ContextCoreLoader } from './loader.js';

function safePath(vaultPath: string, relPath: string): string | null {
  const clean = relPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some(p => p === '..' || p === '.')) return null;
  return join(vaultPath, clean);
}

export function makeVaultWriteOps(vaultPath: string, loader: ContextCoreLoader): Operation[] {
  return [
    {
      name: 'vault.write',
      namespace: 'vault' as Operation['namespace'],
      description:
        'Create or overwrite a Markdown note in the vault. ' +
        'Use to write LLM-inferred conclusions, summaries, or AI-generated notes back into the knowledge base.',
      mutating: true,
      params: {
        path:      { type: 'string',  required: true,  description: 'Vault-relative path, e.g. "notes/summary.md"' },
        content:   { type: 'string',  required: true,  description: 'Full Markdown content of the note' },
        overwrite: { type: 'boolean', required: false, description: 'Allow overwriting an existing file (default: false)', default: false },
      },
      handler: async (_ctx, params) => {
        const relPath   = params.path    as string;
        const content   = params.content as string;
        const overwrite = (params.overwrite as boolean | undefined) ?? false;

        const full = safePath(vaultPath, relPath);
        if (!full) return { error: 'Invalid path — must be vault-relative with no ".."' };
        if (!overwrite && existsSync(full)) {
          return { error: `File already exists: ${relPath}. Pass overwrite:true to replace.` };
        }
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content, 'utf-8');
        return { ok: true, path: relPath, bytes: Buffer.byteLength(content, 'utf-8') };
      },
    },

    {
      name: 'vault.annotate',
      namespace: 'vault' as Operation['namespace'],
      description:
        'Append an AI-generated section to an existing vault note. ' +
        'Accepts a holon ID (resolves source_path automatically) or a vault-relative path. ' +
        'Adds a timestamped callout block under the given heading.',
      mutating: true,
      params: {
        id:      { type: 'string', required: false, description: 'Holon ID — used to locate the source .md file automatically' },
        path:    { type: 'string', required: false, description: 'Vault-relative path (alternative to id)' },
        content: { type: 'string', required: true,  description: 'Markdown text to append' },
        heading: { type: 'string', required: false, description: 'Section heading (default: "## AI Notes")', default: '## AI Notes' },
      },
      handler: async (_ctx, params) => {
        const id      = params.id      as string | undefined;
        const relPath = params.path    as string | undefined;
        const content = params.content as string;
        const heading = (params.heading as string | undefined) ?? '## AI Notes';

        let targetRel: string;
        if (id) {
          const holon = loader.byId(id);
          if (!holon) return { error: `Holon not found: ${id}` };
          // Holon id is vault-relative path without extension, e.g. "concepts/attention"
          targetRel = `${holon.id}.md`;
        } else if (relPath) {
          targetRel = relPath;
        } else {
          return { error: 'Either id or path is required' };
        }

        const full = safePath(vaultPath, targetRel);
        if (!full) return { error: `Invalid path: ${targetRel}` };
        if (!existsSync(full)) return { error: `File not found: ${targetRel}` };

        const existing = readFileSync(full, 'utf-8');
        const date = new Date().toISOString().slice(0, 10);
        const block = `\n\n${heading}\n\n> [!AI] ${date}\n${content.split('\n').map(l => `> ${l}`).join('\n')}\n`;
        writeFileSync(full, existing + block, 'utf-8');
        return { ok: true, path: targetRel, appended_bytes: Buffer.byteLength(block, 'utf-8') };
      },
    },
  ];
}
