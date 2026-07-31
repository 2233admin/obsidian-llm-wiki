#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const skillsRoot = join(repoRoot, 'skills');

async function installedSkillSources() {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const sources = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      sources.push(join(skillsRoot, entry.name));
      continue;
    }

    if (entry.isDirectory()) {
      sources.push(join(skillsRoot, entry.name, 'SKILL.md'));
    }
  }

  return sources;
}

function parseFrontmatter(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0] !== '---') return undefined;

  const closingDelimiter = lines.indexOf('---', 1);
  if (closingDelimiter === -1) return undefined;

  const frontmatterLines = lines.slice(1, closingDelimiter);
  const values = new Map();
  for (const [index, line] of frontmatterLines.entries()) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (/^[>|][+-]?$/.test(value)) {
      const blockLines = [];
      for (const candidate of frontmatterLines.slice(index + 1)) {
        if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(candidate)) break;
        if (candidate.trim()) blockLines.push(candidate.trim());
      }
      value = blockLines.join(' ');
    }
    values.set(match[1], value);
  }
  return values;
}

const failures = [];
const sources = await installedSkillSources();
const names = new Map();

for (const source of sources) {
  let text;
  try {
    text = await readFile(source, 'utf8');
  } catch {
    failures.push(`${source}: missing SKILL.md`);
    continue;
  }

  const frontmatter = parseFrontmatter(text);
  if (!frontmatter) {
    failures.push(`${source}: missing YAML frontmatter`);
    continue;
  }

  const name = frontmatter.get('name')?.replace(/^['"]|['"]$/g, '');
  const description = frontmatter.get('description');
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    failures.push(`${source}: name must be a non-empty kebab-case slug`);
  } else if (names.has(name)) {
    failures.push(`${source}: duplicate skill name "${name}" also used by ${names.get(name)}`);
  } else {
    names.set(name, source);
  }
  if (!description) {
    failures.push(`${source}: description must not be empty`);
  }
}

if (failures.length > 0) {
  console.error(`Skill frontmatter validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${sources.length} installable skills.`);
}
