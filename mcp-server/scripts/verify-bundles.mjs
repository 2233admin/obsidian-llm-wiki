#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';

const bundles = [
  'bundle.js',
  'agent-domain-cli.js',
  'memu-query.js',
  'usage-cli.js',
  'session-archiver.js',
];
for (const bundle of bundles) {
  if (statSync(new URL(`../${bundle}`, import.meta.url)).size === 0) {
    throw new Error(`generated bundle is empty: ${bundle}`);
  }
}

const result = spawnSync(
  'git',
  ['status', '--porcelain=v1', '--untracked-files=all', '--', ...bundles],
  { cwd: new URL('..', import.meta.url), encoding: 'utf-8', windowsHide: true },
);
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr || 'failed to inspect generated bundles\n');
  process.exit(result.status ?? 1);
}
if (result.stdout.trim()) {
  process.stderr.write(`generated bundles are missing or stale:\n${result.stdout}`);
  process.exit(1);
}
process.stdout.write(`verified ${bundles.length} generated bundles; tracked bundles are current\n`);
