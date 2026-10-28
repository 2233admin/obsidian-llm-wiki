#!/usr/bin/env node
// Set the product version everywhere it is recorded. The Obsidian plugin and
// the MCP server share one version, and a release is the tag with that exact
// name (no `v` prefix), as Obsidian's community plugin directory requires.
// Usage: node scripts/bump-version.mjs 2.9.0

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('usage: node scripts/bump-version.mjs <semver, e.g. 2.9.0>');
  process.exit(1);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const path = (file) => join(root, file);
const readJson = (file) => JSON.parse(readFileSync(path(file), 'utf-8'));
const writeJson = (file, value, indent = 2) => writeFileSync(path(file), JSON.stringify(value, null, indent) + '\n');

const manifest = readJson('obsidian-plugin/manifest.json');
manifest.version = version;
const versions = { ...readJson('obsidian-plugin/versions.json'), [version]: manifest.minAppVersion };
for (const dir of ['', 'obsidian-plugin/']) {
  writeJson(`${dir}manifest.json`, manifest);
  writeJson(`${dir}versions.json`, versions);
}

for (const pkg of ['obsidian-plugin', 'mcp-server']) {
  const packageJson = readJson(`${pkg}/package.json`);
  packageJson.version = version;
  writeJson(`${pkg}/package.json`, packageJson);
  const lock = readJson(`${pkg}/package-lock.json`);
  lock.version = version;
  lock.packages[''].version = version;
  writeJson(`${pkg}/package-lock.json`, lock);
}

const versionTs = path('mcp-server/src/version.ts');
writeFileSync(versionTs, readFileSync(versionTs, 'utf-8').replace(/VERSION = "[^"]*"/, `VERSION = "${version}"`));

console.log(`version set to ${version}; commit, then tag ${version} to release`);
