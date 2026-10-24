#!/usr/bin/env node
// Assemble the installable plugin into dist/plugin (published to the `plugin`
// branch by .github/workflows/plugin.yml). Run `npm run rebuild` in mcp-server first.
//
// Layout: the Claude Code plugin root and the checkout other MCP hosts clone.
//   .claude-plugin/plugin.json, .mcp.json, README.md   <- plugin/
//   mcp-server/bundle.js                               <- mcp-server/
//   skills/<name>/SKILL.md, commands/*.md              <- skills/, commands/
//   package.json + package-lock.json                   <- bundle.js externals only

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(root, 'dist', 'plugin');
const bundle = join(root, 'mcp-server', 'bundle.js');

if (!existsSync(bundle)) {
  console.error('mcp-server/bundle.js is missing; run `cd mcp-server && npm ci && npm run rebuild` first');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'mcp-server'), { recursive: true });
cpSync(join(root, 'plugin'), out, { recursive: true });
cpSync(bundle, join(out, 'mcp-server', 'bundle.js'));
cpSync(join(root, 'commands'), join(out, 'commands'), { recursive: true });
cpSync(join(root, 'LICENSE'), join(out, 'LICENSE'));

// Hosts discover skills as <skills>/<name>/SKILL.md; flat skills/<name>.md become that shape.
for (const entry of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
  const src = join(root, 'skills', entry.name);
  if (entry.isDirectory()) {
    cpSync(src, join(out, 'skills', entry.name), { recursive: true });
  } else if (entry.name.endsWith('.md')) {
    const dir = join(out, 'skills', entry.name.slice(0, -'.md'.length));
    mkdirSync(dir, { recursive: true });
    cpSync(src, join(dir, 'SKILL.md'));
  }
}

// bundle.js inlines everything except pglite (it loads its wasm/data files from
// its own package directory), so that is the only runtime dependency. Pin it to
// the version mcp-server is tested with.
const lock = JSON.parse(readFileSync(join(root, 'mcp-server', 'package-lock.json'), 'utf-8'));
const pglite = lock.packages['node_modules/@electric-sql/pglite'].version;
const server = JSON.parse(readFileSync(join(root, 'mcp-server', 'package.json'), 'utf-8'));
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'llmwiki-plugin',
      private: true,
      type: 'module',
      license: server.license,
      engines: server.engines,
      dependencies: { '@electric-sql/pglite': pglite },
    },
    null,
    2,
  ) + '\n',
);
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], {
  cwd: out,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

console.log(`plugin assembled at ${out}`);
