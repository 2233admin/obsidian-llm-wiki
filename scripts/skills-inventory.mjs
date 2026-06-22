#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const MATT_ENGINEERING_SKILLS = [
  'ask-matt',
  'codebase-design',
  'diagnosing-bugs',
  'domain-modeling',
  'grill-with-docs',
  'implement',
  'improve-codebase-architecture',
  'prototype',
  'resolving-merge-conflicts',
  'setup-matt-pocock-skills',
  'tdd',
  'to-issues',
  'to-prd',
  'triage',
];

const KNOWN_PACKS = [
  {
    id: 'mattpocock/engineering',
    label: 'Matt Pocock engineering discipline',
    kind: 'engineering-discipline',
    skills: MATT_ENGINEERING_SKILLS,
  },
  {
    id: 'llmwiki/ingest',
    label: 'LLMwiki ingest bridges',
    kind: 'ingest-bridge',
    skills: ['chubbyskills', 'x-to-obsidian'],
  },
];

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    projectRoot: valueAfter(argv, '--project-root') ?? process.cwd(),
  };
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function skillRoots(projectRoot) {
  return [
    { id: 'agents', label: '.agents', path: join(homedir(), '.agents', 'skills'), scope: 'user' },
    { id: 'codex', label: '.codex', path: join(homedir(), '.codex', 'skills'), scope: 'user' },
    { id: 'project', label: 'project', path: join(projectRoot, 'skills'), scope: 'project' },
    { id: 'projectVendorMatt', label: 'project vendor mattpocock', path: join(projectRoot, 'skills', 'vendor', 'mattpocock', 'engineering'), scope: 'project' },
  ];
}

function readSkill(root, name) {
  const path = join(root.path, name, 'SKILL.md');
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf8');
  const frontmatter = parseFrontmatter(content);
  return {
    root: root.id,
    root_label: root.label,
    scope: root.scope,
    path,
    name: String(frontmatter.name ?? name),
    description: String(frontmatter.description ?? ''),
    disable_model_invocation: frontmatter['disable-model-invocation'] === 'true',
    mtime_ms: statSync(path).mtimeMs,
  };
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([^:#]+):\s*(.*)$/);
    if (!pair) continue;
    out[pair[1].trim()] = pair[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function listProjectSkills(projectRoot) {
  const root = join(projectRoot, 'skills');
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(root, name, 'SKILL.md')));
}

function inventory(projectRoot) {
  const resolvedProjectRoot = resolve(projectRoot);
  const roots = skillRoots(resolvedProjectRoot);
  const packs = KNOWN_PACKS.map((pack) => {
    const skills = pack.skills.map((name) => {
      const hits = roots.map((root) => readSkill(root, name)).filter(Boolean);
      const userInstalled = hits.some((hit) => hit.scope === 'user');
      const projectMirrored = hits.some((hit) => hit.scope === 'project');
      const available = userInstalled || projectMirrored;
      return {
        name,
        available,
        installed: userInstalled,
        project_mirrored: projectMirrored,
        status: userInstalled
          ? (projectMirrored ? 'installed_and_mirrored' : 'user_installed')
          : (projectMirrored ? 'project_mirrored' : 'missing'),
        roots: hits,
      };
    });
    return {
      ...pack,
      count: skills.length,
      available_count: skills.filter((skill) => skill.available).length,
      installed_count: skills.filter((skill) => skill.installed).length,
      mirrored_count: skills.filter((skill) => skill.project_mirrored).length,
      missing: skills.filter((skill) => !skill.available).map((skill) => skill.name),
      skills,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    project_root: resolvedProjectRoot,
    roots: roots.map((root) => ({ ...root, exists: existsSync(root.path) })),
    packs,
    project_local_skills: listProjectSkills(resolvedProjectRoot),
  };
}

function printHuman(report) {
  console.log(`Skill inventory for ${report.project_root}`);
  console.log('');
  console.log('Roots:');
  for (const root of report.roots) {
    console.log(`- ${root.id}: ${root.path} (${root.exists ? 'exists' : 'missing'})`);
  }
  console.log('');

  for (const pack of report.packs) {
    console.log(`${pack.label} [${pack.id}]`);
    console.log(`- available: ${pack.available_count}/${pack.count}`);
    console.log(`- installed: ${pack.installed_count}/${pack.count}`);
    console.log(`- mirrored: ${pack.mirrored_count}/${pack.count}`);
    if (pack.missing.length) console.log(`- missing: ${pack.missing.join(', ')}`);
    for (const skill of pack.skills) {
      const roots = skill.roots.map((hit) => hit.root).join(',') || 'none';
      console.log(`  ${skill.name}: ${skill.status} (${roots})`);
    }
    console.log('');
  }

  console.log('Project-local skills:');
  for (const skill of report.project_local_skills) {
    console.log(`- ${skill}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const report = inventory(args.projectRoot);

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHuman(report);
}
