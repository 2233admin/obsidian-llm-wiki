// Generate docs/mcp-tools-reference.md from operations.ts.
//
// Single source of truth: mcp-server/src/core/operations.ts.
// Run via `npm run generate-tools-doc` after `npm run build`.
//
// Handlers are never invoked — we pass null-cast stub deps to
// makeAllOperations() purely to collect metadata (name/description/
// params/mutating/namespace). No runtime side effects.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeAllOperations, type AllOperationsDeps } from '../core/operations.js';
import type { Operation, ParamDef } from '../core/types.js';

const _thisDir = dirname(fileURLToPath(import.meta.url));
// dist/scripts/ -> dist/ -> mcp-server/ -> repo root
const _repoRoot = join(_thisDir, '..', '..', '..');
const OUTPUT_PATH = join(_repoRoot, 'docs', 'mcp-tools-reference.md');

const NAMESPACE_ORDER: Operation['namespace'][] = ['vault', 'query', 'compile', 'recipe', 'agent'];

function stubDeps(): AllOperationsDeps {
  // Handlers close over these but are never called by the generator.
  // A cast avoids reaching into CompileTrigger / AdapterRegistry internals.
  return {
    compileTrigger: null as never,
    registry: null as never,
    defaultWeights: undefined,
    python: 'python',
    compilerPath: '',
    vaultPath: '',
    configPath: undefined,
  };
}

function formatParam(name: string, def: ParamDef): string {
  const bits: string[] = [`\`${name}\` (${def.type}`];
  bits.push(def.required ? ', required' : ', optional');
  if (def.default !== undefined) bits.push(`, default: \`${JSON.stringify(def.default)}\``);
  if (def.enum) bits.push(`, enum: ${def.enum.map((e) => `\`${e}\``).join(' | ')}`);
  const head = bits.join('') + ')';
  const desc = def.description ? ` — ${def.description}` : '';
  return `- ${head}${desc}`;
}

function formatOperation(op: Operation): string {
  const lines: string[] = [];
  lines.push(`### \`${op.name}\``);
  lines.push('');
  lines.push(op.description);
  lines.push('');
  lines.push(`**Mutating:** ${op.mutating ? 'yes' : 'no'}`);
  lines.push('');
  const paramEntries = Object.entries(op.params);
  if (paramEntries.length === 0) {
    lines.push('**Parameters:** none');
  } else {
    lines.push('**Parameters:**');
    lines.push('');
    for (const [name, def] of paramEntries) lines.push(formatParam(name, def));
  }
  lines.push('');
  return lines.join('\n');
}

function formatNamespace(ns: string, ops: Operation[]): string {
  const lines: string[] = [`## \`${ns}.*\` (${ops.length})`, ''];
  const sorted = [...ops].sort((a, b) => a.name.localeCompare(b.name));
  for (const op of sorted) lines.push(formatOperation(op));
  return lines.join('\n');
}

export function renderDoc(ops: Operation[]): string {
  const byNs = new Map<string, Operation[]>();
  for (const op of ops) {
    if (!byNs.has(op.namespace)) byNs.set(op.namespace, []);
    byNs.get(op.namespace)!.push(op);
  }

  const header = [
    '# MCP Tools Reference',
    '',
    '> Auto-generated from `mcp-server/src/core/operations.ts`.',
    '> Run `npm run generate-tools-doc` to regenerate. Do not edit by hand.',
    '',
    `Total: **${ops.length}** operations across **${byNs.size}** namespaces.`,
    '',
  ].join('\n');

  const sections: string[] = [header];
  for (const ns of NAMESPACE_ORDER) {
    const nsOps = byNs.get(ns);
    if (nsOps && nsOps.length > 0) sections.push(formatNamespace(ns, nsOps));
  }
  // Any namespace not in the predefined order (future-proofing).
  for (const [ns, nsOps] of byNs) {
    if (!NAMESPACE_ORDER.includes(ns as Operation['namespace'])) sections.push(formatNamespace(ns, nsOps));
  }
  return sections.join('\n');
}

export function generate(): { path: string; content: string } {
  const ops = makeAllOperations(stubDeps());
  const content = renderDoc(ops);
  return { path: OUTPUT_PATH, content };
}

function main(): void {
  const { path, content } = generate();
  writeFileSync(path, content, 'utf8');
  console.log(`wrote ${path} (${content.length} chars, ${content.split('\n').length} lines)`);
}

// Run main() when invoked directly via `node dist/scripts/generate-tools-doc.js`.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
