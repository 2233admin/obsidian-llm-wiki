#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

const GSTACK_WORKFLOW_SKILLS = [
  'gstack',
  { name: 'autoplan', aliases: ['autoplan', 'gstack-autoplan'] },
  { name: 'plan-ceo-review', aliases: ['plan-ceo-review', 'gstack-plan-ceo-review'] },
  { name: 'plan-design-review', aliases: ['plan-design-review', 'gstack-plan-design-review'] },
  { name: 'plan-devex-review', aliases: ['plan-devex-review', 'gstack-plan-devex-review'] },
  { name: 'plan-eng-review', aliases: ['plan-eng-review', 'gstack-plan-eng-review'] },
  { name: 'review', aliases: ['review', 'gstack-review'] },
  { name: 'qa', aliases: ['qa', 'gstack-qa'] },
  { name: 'qa-only', aliases: ['qa-only', 'gstack-qa-only'] },
  { name: 'ship', aliases: ['ship', 'gstack-ship'] },
  { name: 'land-and-deploy', aliases: ['land-and-deploy', 'gstack-land-and-deploy'] },
  { name: 'context-save', aliases: ['context-save', 'gstack-context-save'] },
  { name: 'context-restore', aliases: ['context-restore', 'gstack-context-restore'] },
  { name: 'handoff', aliases: ['handoff'] },
  { name: 'investigate', aliases: ['investigate', 'gstack-investigate'] },
  { name: 'spec', aliases: ['spec', 'gstack-spec'] },
];

const KNOWN_PACKS = [
  {
    id: 'gstack/workflow',
    label: 'gstack workflow orchestration',
    kind: 'workflow-orchestration',
    authority: 'execution plans, reviews, QA, ship/deploy flow, handoffs, and workflow artifacts',
    artifacts: '~/.gstack plus any project-local gstack artifacts or handoff summaries',
    llmwiki_mode: 'index, link, and summarize reviewed gstack outputs; do not own workflow state',
    do_not_own: 'gstack config, execution state, artifact sync, checkpointing, or skill routing decisions',
    skills: GSTACK_WORKFLOW_SKILLS,
  },
  {
    id: 'mattpocock/engineering',
    label: 'Matt Pocock engineering discipline',
    kind: 'engineering-discipline',
    authority: 'issue tracker setup, triage label vocabulary, domain docs, TDD, and TypeScript engineering discipline',
    artifacts: 'docs/agents/*.md plus issue tracker state selected by setup-matt-pocock-skills',
    llmwiki_mode: 'read and cite engineering setup docs; prompt setup-matt-pocock-skills when missing',
    do_not_own: 'issue tracker choice, triage vocabulary, domain document layout, or TDD workflow rules',
    skills: MATT_ENGINEERING_SKILLS,
  },
  {
    id: 'llmwiki/ingest',
    label: 'LLMwiki ingest bridges',
    kind: 'ingest-bridge',
    authority: 'local capture and import workflows that feed markdown evidence into a vault',
    artifacts: 'skills/chubbyskills, skills/x-to-obsidian, source notes, and evidence notes',
    llmwiki_mode: 'own bridge documentation and vault-side evidence records',
    do_not_own: 'upstream provider internals, browser session state, or media transcription dependencies',
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
    { id: 'projectSkills', label: 'project skills', path: join(projectRoot, 'skills'), scope: 'project' },
    { id: 'projectAgents', label: 'project .agents', path: join(projectRoot, '.agents', 'skills'), scope: 'project' },
    { id: 'projectCodex', label: 'project .codex', path: join(projectRoot, '.codex', 'skills'), scope: 'project' },
    { id: 'projectClaude', label: 'project .claude', path: join(projectRoot, '.claude', 'skills'), scope: 'project' },
    {
      id: 'projectVendorMatt',
      label: 'project vendor mattpocock',
      path: join(projectRoot, 'skills', 'vendor', 'mattpocock', 'engineering'),
      scope: 'project',
    },
  ];
}

function readSkill(root, name) {
  const skillPath = join(root.path, name, 'SKILL.md');
  if (!existsSync(skillPath)) return undefined;
  const text = readFileSync(skillPath, 'utf8');
  const frontmatter = parseFrontmatter(text);
  return {
    root: root.id,
    root_label: root.label,
    scope: root.scope,
    path: skillPath,
    name,
    description: frontmatter.description ?? '',
    disable_model_invocation: frontmatter['disable-model-invocation'] === 'true',
    mtime_ms: statSync(skillPath).mtimeMs,
  };
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function normalizeSkillEntry(entry) {
  if (typeof entry === 'string') return { name: entry, aliases: [entry] };
  return { name: entry.name, aliases: entry.aliases ?? [entry.name] };
}

function uniqueHits(hits) {
  const seen = new Set();
  return hits.filter((hit) => {
    if (!hit || seen.has(hit.path)) return false;
    seen.add(hit.path);
    return true;
  });
}

function listProjectSkills(projectRoot) {
  const roots = skillRoots(projectRoot).filter((root) => root.scope === 'project' && existsSync(root.path));
  const skills = new Set();
  for (const root of roots) {
    for (const entry of readdirSync(root.path, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(join(root.path, entry.name, 'SKILL.md'))) skills.add(entry.name);
    }
  }
  return [...skills].sort();
}

function inventory(projectRoot) {
  const resolvedProjectRoot = resolve(projectRoot);
  const roots = skillRoots(resolvedProjectRoot);
  const packs = KNOWN_PACKS.map((pack) => {
    const skills = pack.skills.map((entry) => {
      const skill = normalizeSkillEntry(entry);
      const hits = uniqueHits(
        skill.aliases.flatMap((alias) => roots.map((root) => readSkill(root, alias)).filter(Boolean)),
      );
      const userInstalled = hits.some((hit) => hit.scope === 'user');
      const projectMirrored = hits.some((hit) => hit.scope === 'project');
      const available = userInstalled || projectMirrored;
      return {
        name: skill.name,
        aliases: skill.aliases,
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
    console.log(`- kind: ${pack.kind}`);
    console.log(`- authority: ${pack.authority}`);
    console.log(`- artifacts: ${pack.artifacts}`);
    console.log(`- llmwiki-mode: ${pack.llmwiki_mode}`);
    console.log(`- do-not-own: ${pack.do_not_own}`);
    console.log(`- available: ${pack.available_count}/${pack.count}`);
    console.log(`- installed: ${pack.installed_count}/${pack.count}`);
    console.log(`- mirrored: ${pack.mirrored_count}/${pack.count}`);
    if (pack.missing.length) console.log(`- missing: ${pack.missing.join(', ')}`);
    for (const skill of pack.skills) {
      const roots = skill.roots.map((hit) => hit.root).join(',') || 'none';
      const aliases = skill.aliases.length > 1 ? ` aliases=${skill.aliases.join(',')}` : '';
      console.log(`  ${skill.name}: ${skill.status} (${roots})${aliases}`);
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
