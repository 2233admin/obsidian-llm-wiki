import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Operation, OperationContext } from '../core/types.js';
import { makeErr } from '../core/types.js';

const STAGES = ['intake', 'understand', 'plan', 'execute', 'review', 'verify', 'archive'] as const;
type WorkflowStage = (typeof STAGES)[number];

const CHECKPOINT_STATUSES = ['note', 'passed', 'failed', 'blocked'] as const;
type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number];

const AGENT_STAGES = ['think', 'plan', 'build', 'review', 'test', 'ship', 'reflect'] as const;
type AgentStage = (typeof AGENT_STAGES)[number];

const AGENT_STATUSES = ['active', 'blocked', 'done', 'archived'] as const;
type AgentStatus = (typeof AGENT_STATUSES)[number];

interface WorkflowState {
  project: string;
  stage: WorkflowStage;
  objective: string;
  branch: string;
  host: string;
  evidence: string[];
  updatedBy: string;
  updatedAt: string;
  path: string;
}

interface AgentLifetimeState {
  project: string;
  agent: string;
  role: string;
  host: string;
  stage: AgentStage;
  status: AgentStatus;
  objective: string;
  issue: string;
  evidence: string[];
  startedAt: string;
  updatedAt: string;
  path: string;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function projectKey(value: unknown): string {
  const key = slugify(String(value ?? ''));
  if (!key) throw makeErr(-32602, 'project must contain at least one [a-z0-9] character');
  return key;
}

function agentKey(value: unknown, fallback: string): string {
  const key = slugify(String(value ?? fallback));
  if (!key) throw makeErr(-32602, 'agent must contain at least one [a-z0-9] character');
  return key;
}

function safeSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    /^[A-Za-z]:/.test(trimmed) ||
    trimmed.startsWith('//')
  ) {
    throw makeErr(-32602, `${label} must be a single safe path segment`);
  }
  return trimmed;
}

function actorFromContext(ctx: OperationContext): string {
  return agentKey(undefined, ctx.config.collaboration?.actor || process.env.VAULT_MIND_ACTOR || 'agent');
}

function workflowRoot(project: string): string {
  return `01-Projects/${project}/workflow`;
}

function agentsRoot(project: string): string {
  return `01-Projects/${project}/agents`;
}

function agentRoot(project: string, agent: string): string {
  return `${agentsRoot(project)}/${agent}`;
}

function projectNotePath(project: string): string {
  return `01-Projects/${project}/_project.md`;
}

function issuesRoot(project: string): string {
  return `01-Projects/${project}/issues`;
}

function statePath(project: string): string {
  return `${workflowRoot(project)}/status.md`;
}

function checkpointsPath(project: string): string {
  return `${workflowRoot(project)}/checkpoints.md`;
}

function agentLifetimePath(project: string, agent: string): string {
  return `${agentRoot(project, agent)}/lifetime.md`;
}

function agentEventsPath(project: string, agent: string): string {
  return `${agentRoot(project, agent)}/events.md`;
}

function vaultJoin(vaultPath: string, relPath: string): string {
  return join(vaultPath, ...relPath.split('/'));
}

function writeVaultBytes(vaultPath: string, relPath: string, content: string): void {
  const fullPath = vaultJoin(vaultPath, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, Buffer.from(content, 'utf-8'));
}

function appendVaultBytes(vaultPath: string, relPath: string, content: string): void {
  const fullPath = vaultJoin(vaultPath, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  const existing = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8').replace(/\s+$/, '') + '\n\n' : '';
  writeFileSync(fullPath, Buffer.from(existing + content, 'utf-8'));
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function oneLine(value: unknown, max = 240): string {
  const text = optionalString(value).replace(/\r?\n/g, ' ');
  return text.length > max ? text.slice(0, max) : text;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function mergeStringLists(...lists: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const item of list) {
      if (!item || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function parseStage(value: unknown): WorkflowStage {
  const stage = optionalString(value) as WorkflowStage;
  if (!STAGES.includes(stage)) {
    throw makeErr(-32602, `stage must be one of: ${STAGES.join(', ')}`);
  }
  return stage;
}

function parseCheckpointStatus(value: unknown): CheckpointStatus {
  const status = (optionalString(value) || 'note') as CheckpointStatus;
  if (!CHECKPOINT_STATUSES.includes(status)) {
    throw makeErr(-32602, `status must be one of: ${CHECKPOINT_STATUSES.join(', ')}`);
  }
  return status;
}

function parseAgentStage(value: unknown, fallback?: AgentStage): AgentStage {
  const stage = (optionalString(value) || fallback || 'think') as AgentStage;
  if (!AGENT_STAGES.includes(stage)) {
    throw makeErr(-32602, `stage must be one of: ${AGENT_STAGES.join(', ')}`);
  }
  return stage;
}

function parseAgentStatus(value: unknown, fallback: AgentStatus = 'active'): AgentStatus {
  const status = (optionalString(value) || fallback) as AgentStatus;
  if (!AGENT_STATUSES.includes(status)) {
    throw makeErr(-32602, `status must be one of: ${AGENT_STATUSES.join(', ')}`);
  }
  return status;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function isoNow(): string {
  return new Date().toISOString();
}

function renderState(state: WorkflowState, notes: string): string {
  const evidenceLines = state.evidence.length
    ? state.evidence.map((item) => `- ${item}`).join('\n')
    : '- none';

  return [
    '---',
    'type: workflow-state',
    `entity: project/${state.project}/workflow/state`,
    `project: ${state.project}`,
    `stage: ${state.stage}`,
    `objective: ${yamlString(state.objective)}`,
    `branch: ${yamlString(state.branch)}`,
    `host: ${yamlString(state.host)}`,
    `evidence: ${JSON.stringify(state.evidence)}`,
    `updated-by: ${state.updatedBy}`,
    `updated-at: ${yamlString(state.updatedAt)}`,
    '---',
    '',
    `# Workflow State: ${state.project}`,
    '',
    '## Objective',
    '',
    state.objective || 'No objective recorded.',
    '',
    '## Current Branch',
    '',
    state.branch || 'No branch recorded.',
    '',
    '## Evidence',
    '',
    evidenceLines,
    '',
    '## Notes',
    '',
    notes || 'No notes recorded.',
    '',
  ].join('\n');
}

function parseState(project: string, path: string, content: string): WorkflowState {
  const fm = parseFrontmatter(content);
  const rawEvidence = fm.evidence;
  const evidence = Array.isArray(rawEvidence) ? rawEvidence.filter((item): item is string => typeof item === 'string') : [];
  const stage = STAGES.includes(fm.stage as WorkflowStage) ? (fm.stage as WorkflowStage) : 'intake';

  return {
    project,
    stage,
    objective: typeof fm.objective === 'string' ? fm.objective : '',
    branch: typeof fm.branch === 'string' ? fm.branch : '',
    host: typeof fm.host === 'string' ? fm.host : '',
    evidence,
    updatedBy: typeof fm['updated-by'] === 'string' ? fm['updated-by'] : '',
    updatedAt: typeof fm['updated-at'] === 'string' ? fm['updated-at'] : '',
    path,
  };
}

function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith('---\n')) return {};
  const end = content.indexOf('\n---', 4);
  if (end === -1) return {};
  const fm: Record<string, unknown> = {};
  for (const line of content.slice(4, end).split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (!key) continue;
    fm[key] = parseYamlScalar(raw);
  }
  return fm;
}

function parseYamlScalar(raw: string): unknown {
  if (!raw) return '';
  if ((raw.startsWith('"') && raw.endsWith('"')) || raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.replace(/^"|"$/g, '');
    }
  }
  return raw;
}

function readState(vaultPath: string, project: string): WorkflowState | null {
  const path = statePath(project);
  const fullPath = vaultJoin(vaultPath, path);
  if (!existsSync(fullPath)) return null;
  return parseState(project, path, readFileSync(fullPath, 'utf-8'));
}

function checkpointHeader(project: string): string {
  return [
    '---',
    'type: workflow-checkpoints',
    `entity: project/${project}/workflow/checkpoints`,
    `project: ${project}`,
    '---',
    '',
    `# Workflow Checkpoints: ${project}`,
    '',
  ].join('\n');
}

function renderAgentLifetime(state: AgentLifetimeState, notes: string): string {
  const evidenceLines = state.evidence.length
    ? state.evidence.map((item) => `- ${item}`).join('\n')
    : '- none';

  return [
    '---',
    'type: agent-lifetime',
    `entity: project/${state.project}/agent/${state.agent}/lifetime`,
    `project: ${state.project}`,
    `agent: ${state.agent}`,
    `role: ${yamlString(state.role)}`,
    `host: ${yamlString(state.host)}`,
    `stage: ${state.stage}`,
    `status: ${state.status}`,
    `objective: ${yamlString(state.objective)}`,
    `issue: ${yamlString(state.issue)}`,
    `evidence: ${JSON.stringify(state.evidence)}`,
    `started-at: ${yamlString(state.startedAt)}`,
    `updated-at: ${yamlString(state.updatedAt)}`,
    '---',
    '',
    `# Agent Lifetime: ${state.agent}`,
    '',
    `- project: ${state.project}`,
    `- role: ${state.role || 'agent'}`,
    `- host: ${state.host || 'unknown'}`,
    `- stage: ${state.stage}`,
    `- status: ${state.status}`,
    `- issue: ${state.issue || 'none'}`,
    '',
    '## Objective',
    '',
    state.objective || 'No objective recorded.',
    '',
    '## Evidence',
    '',
    evidenceLines,
    '',
    '## Notes',
    '',
    notes || 'No notes recorded.',
    '',
  ].join('\n');
}

function parseAgentLifetime(project: string, agent: string, path: string, content: string): AgentLifetimeState {
  const fm = parseFrontmatter(content);
  const rawEvidence = fm.evidence;
  const evidence = Array.isArray(rawEvidence) ? rawEvidence.filter((item): item is string => typeof item === 'string') : [];
  const stage = AGENT_STAGES.includes(fm.stage as AgentStage) ? (fm.stage as AgentStage) : 'think';
  const status = AGENT_STATUSES.includes(fm.status as AgentStatus) ? (fm.status as AgentStatus) : 'active';
  const now = isoNow();

  return {
    project,
    agent,
    role: typeof fm.role === 'string' ? fm.role : 'agent',
    host: typeof fm.host === 'string' ? fm.host : 'unknown',
    stage,
    status,
    objective: typeof fm.objective === 'string' ? fm.objective : '',
    issue: typeof fm.issue === 'string' ? fm.issue : '',
    evidence,
    startedAt: typeof fm['started-at'] === 'string' ? fm['started-at'] : now,
    updatedAt: typeof fm['updated-at'] === 'string' ? fm['updated-at'] : now,
    path,
  };
}

function readAgentLifetime(vaultPath: string, project: string, agent: string): AgentLifetimeState | null {
  const path = agentLifetimePath(project, agent);
  const fullPath = vaultJoin(vaultPath, path);
  if (!existsSync(fullPath)) return null;
  return parseAgentLifetime(project, agent, path, readFileSync(fullPath, 'utf-8'));
}

function agentEventsHeader(project: string, agent: string): string {
  return [
    '---',
    'type: agent-lifetime-events',
    `entity: project/${project}/agent/${agent}/events`,
    `project: ${project}`,
    `agent: ${agent}`,
    '---',
    '',
    `# Agent Lifetime Events: ${agent}`,
    '',
  ].join('\n');
}

function appendAgentEvent(
  vaultPath: string,
  state: AgentLifetimeState,
  event: { kind: string; summary: string; evidence?: string[]; next?: string; actor: string },
): string {
  const path = agentEventsPath(state.project, state.agent);
  const fullPath = vaultJoin(vaultPath, path);
  const evidence = event.evidence ?? [];
  const evidenceLines = evidence.length ? evidence.map((item) => `  - ${item}`).join('\n') : '  - none';
  const block = [
    existsSync(fullPath) ? '' : agentEventsHeader(state.project, state.agent),
    `## ${isoNow()} - ${event.kind} - ${event.actor}`,
    '',
    `- stage: ${state.stage}`,
    `- status: ${state.status}`,
    `- summary: ${event.summary}`,
    '- evidence:',
    evidenceLines,
    `- next: ${event.next || 'none'}`,
    '',
  ]
    .filter((part) => part !== '')
    .join('\n');

  appendVaultBytes(vaultPath, path, block);
  return path;
}

function canTransitionAgentStage(from: AgentStage, to: AgentStage): boolean {
  if (from === to) return true;
  if ((from === 'review' || from === 'test') && to === 'build') return true;
  return AGENT_STAGES.indexOf(to) === AGENT_STAGES.indexOf(from) + 1;
}

function assertAgentTransition(current: AgentLifetimeState, nextStage: AgentStage, nextEvidence: string[]): void {
  if (current.status === 'archived') {
    throw makeErr(-32602, `${current.agent} is archived; join again before changing stage`);
  }
  if (!canTransitionAgentStage(current.stage, nextStage)) {
    throw makeErr(-32602, `invalid agent stage transition: ${current.stage} -> ${nextStage}`);
  }
  if (nextStage === 'ship' && nextEvidence.length === 0) {
    throw makeErr(-32602, 'ship stage requires evidence');
  }
}

function workflowDoctor(vaultPath: string, project: string): Record<string, unknown> {
  const checks = [
    { name: 'project-anchor', path: projectNotePath(project), required: true },
    { name: 'issues-dir', path: issuesRoot(project), required: true },
    { name: 'workflow-state', path: statePath(project), required: true },
    { name: 'workflow-checkpoints', path: checkpointsPath(project), required: false },
    { name: 'source-registry', path: '_llmwiki/source-registry.json', required: false },
  ].map((check) => ({ ...check, ok: existsSync(vaultJoin(vaultPath, check.path)) }));

  const missing = checks.filter((check) => check.required && !check.ok).map((check) => check.path);
  const warnings = checks.filter((check) => !check.required && !check.ok).map((check) => check.path);

  return {
    ok: missing.length === 0,
    project,
    checks,
    missing,
    warnings,
  };
}

function agentDoctor(vaultPath: string, project: string, agent: string): Record<string, unknown> {
  const lifetime = readAgentLifetime(vaultPath, project, agent);
  const lifetimePath = agentLifetimePath(project, agent);
  const eventsPath = agentEventsPath(project, agent);
  const checks = [
    { name: 'agent-lifetime', path: lifetimePath, required: true, ok: lifetime !== null },
    { name: 'agent-events', path: eventsPath, required: false, ok: existsSync(vaultJoin(vaultPath, eventsPath)) },
  ];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (lifetime) {
    if (!AGENT_STAGES.includes(lifetime.stage)) errors.push(`invalid stage: ${lifetime.stage}`);
    if (!AGENT_STATUSES.includes(lifetime.status)) errors.push(`invalid status: ${lifetime.status}`);
    if (lifetime.stage === 'ship' && lifetime.evidence.length === 0) errors.push('ship stage requires evidence');
    if (lifetime.status === 'active' && lifetime.stage === 'reflect') warnings.push('reflect stage usually closes with status=done');
  }

  const missing = checks.filter((check) => check.required && !check.ok).map((check) => check.path);
  warnings.push(...checks.filter((check) => !check.required && !check.ok).map((check) => check.path));

  return {
    ok: missing.length === 0 && errors.length === 0,
    project,
    agent,
    checks,
    missing,
    errors,
    warnings,
    lifetime,
  };
}

export function makeWorkflowOps(vaultPath: string): Operation[] {
  return [
    {
      name: 'workflow.state.set',
      namespace: 'workflow' as Operation['namespace'],
      description:
        'Create or update the vault-first agent workflow state at 01-Projects/<project>/workflow/status.md.',
      mutating: true,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        stage: {
          type: 'string',
          required: true,
          enum: [...STAGES],
          description: 'Workflow stage: intake|understand|plan|execute|review|verify|archive',
        },
        objective: { type: 'string', required: false, description: 'Current project objective' },
        branch: { type: 'string', required: false, description: 'Current execution branch or workstream' },
        host: { type: 'string', required: false, description: 'Agent host, e.g. codex or claude-code' },
        evidence: { type: 'array', required: false, description: 'Evidence refs such as test:, source:, commit:, or path:' },
        notes: { type: 'string', required: false, description: 'Short workflow notes' },
      },
      handler: async (ctx, params) => {
        const project = projectKey(params.project);
        const stage = parseStage(params.stage);
        const actor = actorFromContext(ctx);
        const path = statePath(project);
        const state: WorkflowState = {
          project,
          stage,
          objective: oneLine(params.objective),
          branch: oneLine(params.branch),
          host: oneLine(params.host) || actor,
          evidence: stringList(params.evidence),
          updatedBy: actor,
          updatedAt: isoNow(),
          path,
        };

        writeVaultBytes(vaultPath, path, renderState(state, optionalString(params.notes)));

        return {
          ok: true,
          project,
          path,
          state,
          projectInitialized: existsSync(vaultJoin(vaultPath, projectNotePath(project))),
        };
      },
    },
    {
      name: 'workflow.state.get',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Read the current vault-first agent workflow state for a project.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
      },
      handler: async (_ctx, params) => {
        const project = projectKey(params.project);
        const path = statePath(project);
        const state = readState(vaultPath, project);
        return { exists: state !== null, project, path, state };
      },
    },
    {
      name: 'workflow.checkpoint.add',
      namespace: 'workflow' as Operation['namespace'],
      description:
        'Append an agent workflow checkpoint under 01-Projects/<project>/workflow/checkpoints.md.',
      mutating: true,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        stage: {
          type: 'string',
          required: true,
          enum: [...STAGES],
          description: 'Workflow stage for this checkpoint',
        },
        summary: { type: 'string', required: true, description: 'Checkpoint summary' },
        status: {
          type: 'string',
          required: false,
          enum: [...CHECKPOINT_STATUSES],
          default: 'note',
          description: 'Checkpoint status: note|passed|failed|blocked',
        },
        evidence: { type: 'array', required: false, description: 'Evidence refs for this checkpoint' },
        next: { type: 'string', required: false, description: 'Next action or stop condition' },
      },
      handler: async (ctx, params) => {
        const project = projectKey(params.project);
        const stage = parseStage(params.stage);
        const status = parseCheckpointStatus(params.status);
        const summary = oneLine(params.summary);
        if (!summary) throw makeErr(-32602, 'summary required');

        const actor = actorFromContext(ctx);
        const path = checkpointsPath(project);
        const fullPath = vaultJoin(vaultPath, path);
        const evidence = stringList(params.evidence);
        const next = oneLine(params.next);
        const now = isoNow();
        const evidenceLines = evidence.length ? evidence.map((item) => `  - ${item}`).join('\n') : '  - none';
        const block = [
          existsSync(fullPath) ? '' : checkpointHeader(project),
          `## ${now} - ${stage} - ${actor}`,
          '',
          `- status: ${status}`,
          `- summary: ${summary}`,
          '- evidence:',
          evidenceLines,
          `- next: ${next || 'none'}`,
          '',
        ]
          .filter((part) => part !== '')
          .join('\n');

        appendVaultBytes(vaultPath, path, block);

        return { ok: true, project, path, stage, status, actor, evidence };
      },
    },
    {
      name: 'workflow.agent.join',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Start or replace a vault-first agent lifetime under 01-Projects/<project>/agents/<agent>/.',
      mutating: true,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        role: { type: 'string', required: false, description: 'Agent role, e.g. manager|worker|reviewer|verifier' },
        host: { type: 'string', required: false, description: 'Agent host, e.g. codex or claude-code' },
        objective: { type: 'string', required: false, description: 'Lifetime objective' },
        issue: { type: 'string', required: false, description: 'Linked issue slug or entity' },
        stage: {
          type: 'string',
          required: false,
          enum: [...AGENT_STAGES],
          default: 'think',
          description: 'Initial lifetime stage: think|plan|build|review|test|ship|reflect',
        },
        evidence: { type: 'array', required: false, description: 'Initial evidence refs' },
        notes: { type: 'string', required: false, description: 'Join notes' },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = projectKey(params.project);
        const agent = agentKey(params.agent, actor);
        const now = isoNow();
        const path = agentLifetimePath(project, agent);
        const state: AgentLifetimeState = {
          project,
          agent,
          role: oneLine(params.role) || 'agent',
          host: oneLine(params.host) || actor,
          stage: parseAgentStage(params.stage, 'think'),
          status: 'active',
          objective: oneLine(params.objective),
          issue: oneLine(params.issue),
          evidence: stringList(params.evidence),
          startedAt: now,
          updatedAt: now,
          path,
        };

        writeVaultBytes(vaultPath, path, renderAgentLifetime(state, optionalString(params.notes)));
        const eventsPath = appendAgentEvent(vaultPath, state, {
          kind: 'join',
          summary: state.objective || `${agent} joined`,
          evidence: state.evidence,
          actor,
        });

        return { ok: true, project, agent, path, eventsPath, lifetime: state };
      },
    },
    {
      name: 'workflow.agent.step',
      namespace: 'workflow' as Operation['namespace'],
      description:
        'Move a joined agent through think->plan->build->review->test->ship->reflect with review/test rework back to build.',
      mutating: true,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        stage: {
          type: 'string',
          required: true,
          enum: [...AGENT_STAGES],
          description: 'Next lifetime stage',
        },
        status: {
          type: 'string',
          required: false,
          enum: [...AGENT_STATUSES],
          description: 'Agent status: active|blocked|done|archived',
        },
        objective: { type: 'string', required: false, description: 'Replacement objective' },
        issue: { type: 'string', required: false, description: 'Replacement linked issue slug or entity' },
        evidence: { type: 'array', required: false, description: 'Evidence refs to merge into lifetime' },
        summary: { type: 'string', required: false, description: 'Transition summary' },
        next: { type: 'string', required: false, description: 'Next action or stop condition' },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = projectKey(params.project);
        const agent = agentKey(params.agent, actor);
        const current = readAgentLifetime(vaultPath, project, agent);
        if (!current) throw makeErr(-32001, `Agent lifetime not found: ${agent}`);

        const stage = parseAgentStage(params.stage);
        const incomingEvidence = stringList(params.evidence);
        const evidence = mergeStringLists(current.evidence, incomingEvidence);
        assertAgentTransition(current, stage, evidence);

        const status = parseAgentStatus(params.status, stage === 'reflect' ? 'done' : current.status === 'done' ? 'active' : current.status);
        const state: AgentLifetimeState = {
          ...current,
          stage,
          status,
          objective: params.objective === undefined ? current.objective : oneLine(params.objective),
          issue: params.issue === undefined ? current.issue : oneLine(params.issue),
          evidence,
          updatedAt: isoNow(),
        };

        writeVaultBytes(vaultPath, state.path, renderAgentLifetime(state, oneLine(params.summary)));
        const eventsPath = appendAgentEvent(vaultPath, state, {
          kind: 'step',
          summary: oneLine(params.summary) || `${current.stage} -> ${stage}`,
          evidence: incomingEvidence,
          next: oneLine(params.next),
          actor,
        });

        return { ok: true, project, agent, path: state.path, eventsPath, lifetime: state };
      },
    },
    {
      name: 'workflow.agent.checkpoint',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Append an event to a joined agent lifetime without changing the current stage.',
      mutating: true,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        status: {
          type: 'string',
          required: false,
          enum: [...CHECKPOINT_STATUSES],
          default: 'note',
          description: 'Checkpoint status: note|passed|failed|blocked',
        },
        summary: { type: 'string', required: true, description: 'Checkpoint summary' },
        evidence: { type: 'array', required: false, description: 'Evidence refs for this checkpoint' },
        next: { type: 'string', required: false, description: 'Next action or stop condition' },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = projectKey(params.project);
        const agent = agentKey(params.agent, actor);
        const current = readAgentLifetime(vaultPath, project, agent);
        if (!current) throw makeErr(-32001, `Agent lifetime not found: ${agent}`);
        const status = parseCheckpointStatus(params.status);
        const summary = oneLine(params.summary);
        if (!summary) throw makeErr(-32602, 'summary required');

        const eventsPath = appendAgentEvent(vaultPath, current, {
          kind: `checkpoint:${status}`,
          summary,
          evidence: stringList(params.evidence),
          next: oneLine(params.next),
          actor,
        });

        return { ok: true, project, agent, path: current.path, eventsPath, stage: current.stage, status };
      },
    },
    {
      name: 'workflow.agent.leave',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Archive a joined agent lifetime while preserving its lifetime and event log in the vault.',
      mutating: true,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        summary: { type: 'string', required: false, description: 'Leave summary' },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = projectKey(params.project);
        const agent = agentKey(params.agent, actor);
        const current = readAgentLifetime(vaultPath, project, agent);
        if (!current) throw makeErr(-32001, `Agent lifetime not found: ${agent}`);
        const state: AgentLifetimeState = {
          ...current,
          status: 'archived',
          updatedAt: isoNow(),
        };

        writeVaultBytes(vaultPath, state.path, renderAgentLifetime(state, oneLine(params.summary)));
        const eventsPath = appendAgentEvent(vaultPath, state, {
          kind: 'leave',
          summary: oneLine(params.summary) || `${agent} archived`,
          actor,
        });

        return { ok: true, project, agent, path: state.path, eventsPath, lifetime: state };
      },
    },
    {
      name: 'workflow.agent.doctor',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Check one agent lifetime file and event log for vault-first lifecycle consistency.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = projectKey(params.project);
        const agent = agentKey(params.agent, actor);
        return agentDoctor(vaultPath, project, agent);
      },
    },
    {
      name: 'workflow.doctor',
      namespace: 'workflow' as Operation['namespace'],
      description:
        'Check whether a project has the vault-first workflow files needed by Codex, Claude Code, and MCP tools.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
      },
      handler: async (_ctx, params) => workflowDoctor(vaultPath, projectKey(params.project)),
    },
  ];
}
