import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Operation, OperationContext, WriteEffect } from '../core/types.js';
import { makeErr } from '../core/types.js';
import { resultPath, touchMarkdown, workflowAgentPolicyBasePath, workflowPolicyBasePath } from '../core/write-policy.js';
import { resolveProjectContext } from '../project/project-context.js';

const STAGES = ['intake', 'understand', 'plan', 'execute', 'review', 'verify', 'archive'] as const;
type WorkflowStage = (typeof STAGES)[number];

const CHECKPOINT_STATUSES = ['note', 'passed', 'failed', 'blocked'] as const;
type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number];

const AGENT_STAGES = ['think', 'plan', 'build', 'review', 'test', 'ship', 'reflect'] as const;
type AgentStage = (typeof AGENT_STAGES)[number];

const workflowAgentEffects = (_ctx: OperationContext, _params: Record<string, unknown>, result: unknown): WriteEffect[] => {
  const eventsPath = typeof result === 'object' && result !== null
    ? (result as { eventsPath?: unknown }).eventsPath
    : undefined;
  const runPath = typeof result === 'object' && result !== null
    ? (result as { runPath?: unknown }).runPath
    : undefined;
  return [touchMarkdown(resultPath(result), 'modify'), touchMarkdown(eventsPath, 'modify'), touchMarkdown(runPath, 'modify')];
};

const workflowAgentTargets = (ctx: OperationContext, params: Record<string, unknown>): string[] => {
  const workflow = workflowPolicyBasePath(params);
  const projectRoot = workflow.slice(0, -'/workflow'.length);
  return [`${workflowAgentPolicyBasePath(ctx.config, params)}/**`, `${projectRoot}/runs/**`];
};

const AGENT_STATUSES = ['active', 'blocked', 'done', 'archived'] as const;
type AgentStatus = (typeof AGENT_STATUSES)[number];

export const WORK_RUN_STATES = [
  'planned',
  'leased',
  'running',
  'awaiting_review',
  'completed',
  'failed',
  'cancelled',
] as const;
export type WorkRunState = (typeof WORK_RUN_STATES)[number];

export const WORK_RUN_TERMINAL_STATES = ['completed', 'failed', 'cancelled'] as const;
const WORK_RUN_OUTPUT_CLASSES = ['view', 'work-state-transition', 'knowledge-claim', 'external-side-effect'] as const;
type WorkRunOutputClass = (typeof WORK_RUN_OUTPUT_CLASSES)[number];
const WORK_RUN_APPROVAL_STATUSES = ['not-required', 'pending', 'approved', 'denied'] as const;
type WorkRunApprovalStatus = (typeof WORK_RUN_APPROVAL_STATUSES)[number];

const WORK_RUN_TRANSITIONS: Readonly<Record<WorkRunState, readonly WorkRunState[]>> = {
  planned: ['leased', 'cancelled'],
  leased: ['running', 'failed', 'cancelled'],
  running: ['awaiting_review', 'completed', 'failed', 'cancelled'],
  awaiting_review: ['running', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

interface WorkRunTransitionReceipt {
  token: string;
  operation: 'join' | 'step' | 'checkpoint' | 'leave';
  workRunState: WorkRunState;
  agentStage: AgentStage;
  agentStatus: AgentStatus;
  outputClass: WorkRunOutputClass;
  approvalStatus: WorkRunApprovalStatus;
  recordedAt: string;
}

const AGENT_STAGE_EVIDENCE_REQUIREMENTS: Partial<Record<AgentStage, readonly string[]>> = {
  test: ['review:'],
  ship: ['review:', 'test:'],
} as const;

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
  projectId: string;
  project: string;
  workRunId: string;
  workRunState: WorkRunState;
  workItemId: string;
  agent: string;
  role: string;
  host: string;
  stage: AgentStage;
  status: AgentStatus;
  objective: string;
  issue: string;
  evidence: string[];
  provenance: string[];
  outputClass: WorkRunOutputClass;
  approvalStatus: WorkRunApprovalStatus;
  transitions: WorkRunTransitionReceipt[];
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

function existingProjectKey(vaultPath: string, value: unknown, operation: string): string {
  if (typeof value !== 'string' || !value.trim()) throw makeErr(-32602, 'project is required');
  return resolveProjectContext(vaultPath, value, operation).slug;
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

function durableRunPath(project: string, workRunId: string): string {
  return `01-Projects/${project}/runs/${workRunId.slice('work-run/'.length)}.json`;
}

function syncDurableWorkRun(vaultPath: string, state: AgentLifetimeState, transitionToken: string): string {
  const path = durableRunPath(state.project, state.workRunId);
  const fullPath = vaultJoin(vaultPath, path);
  let run: Record<string, any> = {};
  if (existsSync(fullPath)) {
    try {
      run = JSON.parse(readFileSync(fullPath, 'utf-8')) as Record<string, any>;
    } catch {
      throw makeErr(-32603, `Durable Work Run is malformed: ${path}`);
    }
  }
  const transitions = Array.isArray(run.transitions) ? run.transitions as Array<Record<string, unknown>> : [];
  if (!transitions.some((item) => item.transition_token === transitionToken)) {
    const previous = typeof run.state === 'string' ? run.state : state.workRunState === 'running' ? 'leased' : 'planned';
    if (previous !== state.workRunState) {
      transitions.push({ transition_token: transitionToken, from: previous, to: state.workRunState, recorded_at: state.updatedAt });
    }
  }
  const durable = {
    ...run,
    schema_version: 1,
    project_id: state.projectId,
    work_item_id: state.workItemId,
    work_run_id: state.workRunId,
    agent_id: state.agent,
    state: state.workRunState,
    output_class: state.outputClass,
    approval_status: state.approvalStatus,
    created_at: run.created_at ?? state.startedAt,
    updated_at: state.updatedAt,
    provenance: [...state.provenance].sort(),
    transitions,
  };
  mkdirSync(dirname(fullPath), { recursive: true });
  const temporary = `${fullPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(durable, null, 2) + '\n', 'utf-8');
  renameSync(temporary, fullPath);
  return path;
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

function projectId(project: string): string {
  return `project/${project}`;
}

function parseWorkRunId(value: unknown, fallbackProject?: string, fallbackAgent?: string): string {
  const id = optionalString(value);
  if (!id && fallbackProject && fallbackAgent) return `work-run/legacy-${fallbackProject}-${fallbackAgent}`;
  if (!/^work-run\/[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw makeErr(-32602, 'work_run_id must match work-run/<lowercase-kebab-id>');
  }
  return id;
}

function createWorkRunId(): string {
  return `work-run/${randomUUID()}`;
}

function parseWorkItemId(value: unknown, project: string, legacyIssue: unknown): string {
  const explicit = optionalString(value);
  if (explicit) {
    const prefix = `${projectId(project)}/issue/`;
    if (!explicit.startsWith(prefix) || !/^project\/[a-z0-9][a-z0-9-]*\/issue\/[a-z0-9][a-z0-9-]*$/.test(explicit)) {
      throw makeErr(-32602, `work_item_id must match ${prefix}<lowercase-kebab-slug>`);
    }
    return explicit;
  }
  const issue = slugify(optionalString(legacyIssue));
  return issue ? `${projectId(project)}/issue/${issue}` : '';
}

function parseWorkRunState(value: unknown, fallback: WorkRunState): WorkRunState {
  const state = (optionalString(value) || fallback) as WorkRunState;
  if (!WORK_RUN_STATES.includes(state)) {
    throw makeErr(-32602, `work_run_state must be one of: ${WORK_RUN_STATES.join(', ')}`);
  }
  return state;
}

function parseOutputClass(value: unknown, fallback: WorkRunOutputClass = 'view'): WorkRunOutputClass {
  const outputClass = (optionalString(value) || fallback) as WorkRunOutputClass;
  if (!WORK_RUN_OUTPUT_CLASSES.includes(outputClass)) {
    throw makeErr(-32602, `output_class must be one of: ${WORK_RUN_OUTPUT_CLASSES.join(', ')}`);
  }
  return outputClass;
}

function defaultApprovalStatus(outputClass: WorkRunOutputClass): WorkRunApprovalStatus {
  return outputClass === 'view' || outputClass === 'work-state-transition' ? 'not-required' : 'pending';
}

function parseApprovalStatus(
  value: unknown,
  outputClass: WorkRunOutputClass,
  fallback?: WorkRunApprovalStatus,
): WorkRunApprovalStatus {
  const approval = (optionalString(value) || fallback || defaultApprovalStatus(outputClass)) as WorkRunApprovalStatus;
  if (!WORK_RUN_APPROVAL_STATUSES.includes(approval)) {
    throw makeErr(-32602, `approval_status must be one of: ${WORK_RUN_APPROVAL_STATUSES.join(', ')}`);
  }
  if ((outputClass === 'view' || outputClass === 'work-state-transition') && approval !== 'not-required') {
    throw makeErr(-32602, `${outputClass} output must use approval_status=not-required`);
  }
  return approval;
}

function parseTransitionToken(value: unknown): string {
  const token = optionalString(value) || `legacy:${randomUUID()}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(token)) {
    throw makeErr(-32602, 'transition_token must be 1-128 safe identifier characters');
  }
  return token;
}

function isTerminalWorkRunState(state: WorkRunState): boolean {
  return WORK_RUN_TERMINAL_STATES.includes(state as (typeof WORK_RUN_TERMINAL_STATES)[number]);
}

export function isWorkRunTransitionAllowed(from: WorkRunState, to: WorkRunState): boolean {
  return WORK_RUN_TRANSITIONS[from].includes(to);
}

function assertWorkRunMutable(state: AgentLifetimeState): void {
  if (isTerminalWorkRunState(state.workRunState)) {
    throw makeErr(-32602, `Work Run ${state.workRunId} is terminal (${state.workRunState})`);
  }
}

function transitionWorkRun(current: WorkRunState, next: WorkRunState): WorkRunState {
  if (current === next) return current;
  if (!isWorkRunTransitionAllowed(current, next)) {
    throw makeErr(-32602, `invalid Work Run transition: ${current} -> ${next}`);
  }
  return next;
}

function completionState(outputClass: WorkRunOutputClass, approval: WorkRunApprovalStatus): WorkRunState {
  if (outputClass === 'external-side-effect' && approval !== 'approved') {
    return 'awaiting_review';
  }
  if (outputClass === 'knowledge-claim' && approval === 'pending') return 'awaiting_review';
  if (approval === 'denied') return 'failed';
  return 'completed';
}

function assertWorkRunIdentity(current: AgentLifetimeState, supplied: unknown): void {
  const id = optionalString(supplied);
  if (id && parseWorkRunId(id) !== current.workRunId) {
    throw makeErr(-32602, `work_run_id does not match joined Work Run ${current.workRunId}`);
  }
}

function findTransitionReceipt(
  state: AgentLifetimeState,
  token: string,
  operation: WorkRunTransitionReceipt['operation'],
): WorkRunTransitionReceipt | null {
  const receipt = state.transitions.find((item) => item.token === token);
  if (!receipt) return null;
  if (receipt.operation !== operation) {
    throw makeErr(-32602, `transition_token already used by ${receipt.operation}`);
  }
  return receipt;
}

function withTransitionReceipt(
  state: AgentLifetimeState,
  token: string,
  operation: WorkRunTransitionReceipt['operation'],
): AgentLifetimeState {
  return {
    ...state,
    transitions: [
      ...state.transitions,
      {
        token,
        operation,
        workRunState: state.workRunState,
        agentStage: state.stage,
        agentStatus: state.status,
        outputClass: state.outputClass,
        approvalStatus: state.approvalStatus,
        recordedAt: state.updatedAt,
      },
    ],
  };
}

function replayResult(state: AgentLifetimeState, receipt: WorkRunTransitionReceipt, eventsPath: string) {
  return {
    ok: true,
    idempotent: true,
    project: state.project,
    projectId: state.projectId,
    agent: state.agent,
    workRunId: state.workRunId,
    path: state.path,
    eventsPath,
    lifetime: {
      ...state,
      stage: receipt.agentStage,
      status: receipt.agentStatus,
      workRunState: receipt.workRunState,
      outputClass: receipt.outputClass,
      approvalStatus: receipt.approvalStatus,
      updatedAt: receipt.recordedAt,
    },
    receipt,
  };
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
    `project-id: ${state.projectId}`,
    `project: ${state.project}`,
    `work-run-id: ${state.workRunId}`,
    `work-run-state: ${state.workRunState}`,
    `work-item-id: ${yamlString(state.workItemId)}`,
    `agent: ${state.agent}`,
    `role: ${yamlString(state.role)}`,
    `host: ${yamlString(state.host)}`,
    `stage: ${state.stage}`,
    `status: ${state.status}`,
    `objective: ${yamlString(state.objective)}`,
    `issue: ${yamlString(state.issue)}`,
    `evidence: ${JSON.stringify(state.evidence)}`,
    `provenance: ${JSON.stringify(state.provenance)}`,
    `output-class: ${state.outputClass}`,
    `approval-status: ${state.approvalStatus}`,
    `transitions: ${JSON.stringify(state.transitions)}`,
    `started-at: ${yamlString(state.startedAt)}`,
    `updated-at: ${yamlString(state.updatedAt)}`,
    '---',
    '',
    `# Agent Lifetime: ${state.agent}`,
    '',
    `- project: ${state.project}`,
    `- project-id: ${state.projectId}`,
    `- work-run-id: ${state.workRunId}`,
    `- work-run-state: ${state.workRunState}`,
    `- work-item-id: ${state.workItemId || 'none'}`,
    `- role: ${state.role || 'agent'}`,
    `- host: ${state.host || 'unknown'}`,
    `- stage: ${state.stage}`,
    `- status: ${state.status}`,
    `- issue: ${state.issue || 'none'}`,
    `- output-class: ${state.outputClass}`,
    `- approval-status: ${state.approvalStatus}`,
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
  const workRunState = WORK_RUN_STATES.includes(fm['work-run-state'] as WorkRunState)
    ? (fm['work-run-state'] as WorkRunState)
    : status === 'done'
      ? 'completed'
      : status === 'archived'
        ? 'cancelled'
        : 'running';
  const outputClass = WORK_RUN_OUTPUT_CLASSES.includes(fm['output-class'] as WorkRunOutputClass)
    ? (fm['output-class'] as WorkRunOutputClass)
    : 'view';
  const approvalStatus = WORK_RUN_APPROVAL_STATUSES.includes(fm['approval-status'] as WorkRunApprovalStatus)
    ? (fm['approval-status'] as WorkRunApprovalStatus)
    : defaultApprovalStatus(outputClass);
  const rawProvenance = fm.provenance;
  const provenance = Array.isArray(rawProvenance)
    ? rawProvenance.filter((item): item is string => typeof item === 'string')
    : [];
  const rawTransitions = fm.transitions;
  const transitions = Array.isArray(rawTransitions)
    ? rawTransitions.filter((item): item is WorkRunTransitionReceipt => {
        if (typeof item !== 'object' || item === null) return false;
        const receipt = item as Partial<WorkRunTransitionReceipt>;
        return (
          typeof receipt.token === 'string' &&
          ['join', 'step', 'checkpoint', 'leave'].includes(String(receipt.operation)) &&
          WORK_RUN_STATES.includes(receipt.workRunState as WorkRunState)
        );
      })
    : [];
  const now = isoNow();

  return {
    projectId: typeof fm['project-id'] === 'string' ? fm['project-id'] : projectId(project),
    project,
    workRunId:
      typeof fm['work-run-id'] === 'string'
        ? parseWorkRunId(fm['work-run-id'])
        : parseWorkRunId(undefined, project, agent),
    workRunState,
    workItemId:
      typeof fm['work-item-id'] === 'string'
        ? fm['work-item-id']
        : parseWorkItemId(undefined, project, fm.issue),
    agent,
    role: typeof fm.role === 'string' ? fm.role : 'agent',
    host: typeof fm.host === 'string' ? fm.host : 'unknown',
    stage,
    status,
    objective: typeof fm.objective === 'string' ? fm.objective : '',
    issue: typeof fm.issue === 'string' ? fm.issue : '',
    evidence,
    provenance,
    outputClass,
    approvalStatus,
    transitions,
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
  event: {
    kind: string;
    summary: string;
    evidence?: string[];
    next?: string;
    actor: string;
    transitionToken: string;
  },
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
    `- work-run-id: ${state.workRunId}`,
    `- work-run-state: ${state.workRunState}`,
    `- transition-token: ${event.transitionToken}`,
    `- output-class: ${state.outputClass}`,
    `- approval-status: ${state.approvalStatus}`,
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

function evidenceMatchesRequirement(evidence: string[], requirement: string): boolean {
  const normalizedRequirement = requirement.toLowerCase();
  return evidence.some((item) => item.trim().toLowerCase().startsWith(normalizedRequirement));
}

function missingEvidenceForStage(stage: AgentStage, evidence: string[]): string[] {
  const requirements = AGENT_STAGE_EVIDENCE_REQUIREMENTS[stage] ?? [];
  return requirements.filter((requirement) => !evidenceMatchesRequirement(evidence, requirement));
}

function formatEvidenceRequirements(requirements: string[]): string {
  return requirements.map((requirement) => `${requirement}*`).join(', ');
}

function assertAgentStageEvidence(stage: AgentStage, evidence: string[]): void {
  const missing = missingEvidenceForStage(stage, evidence);
  if (missing.length > 0) {
    throw makeErr(-32602, `${stage} stage requires evidence matching: ${formatEvidenceRequirements(missing)}`);
  }
}

function assertAgentTransition(current: AgentLifetimeState, nextStage: AgentStage, nextEvidence: string[]): void {
  if (current.status === 'archived') {
    throw makeErr(-32602, `${current.agent} is archived; join again before changing stage`);
  }
  if (!canTransitionAgentStage(current.stage, nextStage)) {
    throw makeErr(-32602, `invalid agent stage transition: ${current.stage} -> ${nextStage}`);
  }
  assertAgentStageEvidence(nextStage, nextEvidence);
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

function agentDoctor(vaultPath: string, project: string, agent: string, expectedWorkRunId?: string): Record<string, unknown> {
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
    if (lifetime.projectId !== projectId(project)) errors.push(`project-id mismatch: ${lifetime.projectId}`);
    if (!WORK_RUN_STATES.includes(lifetime.workRunState)) errors.push(`invalid Work Run state: ${lifetime.workRunState}`);
    if (expectedWorkRunId && lifetime.workRunId !== expectedWorkRunId) {
      errors.push(`work-run-id mismatch: expected ${expectedWorkRunId}, found ${lifetime.workRunId}`);
    }
    if (isTerminalWorkRunState(lifetime.workRunState) && lifetime.status === 'active') {
      errors.push(`terminal Work Run ${lifetime.workRunState} cannot have active agent status`);
    }
    if (!isTerminalWorkRunState(lifetime.workRunState) && lifetime.status === 'archived') {
      errors.push(`non-terminal Work Run ${lifetime.workRunState} cannot have archived agent status`);
    }
    if (
      (lifetime.outputClass === 'knowledge-claim' || lifetime.outputClass === 'external-side-effect') &&
      lifetime.workRunState === 'completed' &&
      lifetime.approvalStatus !== 'approved'
    ) {
      errors.push(`${lifetime.outputClass} output completed without explicit approval`);
    }
    const tokens = lifetime.transitions.map((item) => item.token);
    if (new Set(tokens).size !== tokens.length) errors.push('duplicate transition token receipts');
    const missingEvidence = missingEvidenceForStage(lifetime.stage, lifetime.evidence);
    if (missingEvidence.length > 0) {
      errors.push(`${lifetime.stage} stage requires evidence matching: ${formatEvidenceRequirements(missingEvidence)}`);
    }
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
  writePolicy: {
    realWrite: 'always',
    targets: (_ctx, params) => [`${workflowPolicyBasePath(params)}/status.md`],
    audit: 'required',
    effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
  },
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
        const project = existingProjectKey(vaultPath, params.project, 'workflow.state.set');
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
        const project = existingProjectKey(vaultPath, params.project, 'workflow.state.get');
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
    writePolicy: {
      realWrite: 'always',
      targets: (_ctx, params) => [`${workflowPolicyBasePath(params)}/checkpoints.md`],
      audit: 'required',
      effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
    },
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
        const project = existingProjectKey(vaultPath, params.project, 'workflow.checkpoint.add');
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
      description: 'Join a leased Work Run (or create a legacy-compatible one) and persist its shared identity on the agent lifetime.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: workflowAgentTargets,
      audit: 'required',
      effects: workflowAgentEffects,
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        role: { type: 'string', required: false, description: 'Agent role, e.g. manager|worker|reviewer|verifier' },
        host: { type: 'string', required: false, description: 'Agent host, e.g. codex or claude-code' },
        objective: { type: 'string', required: false, description: 'Lifetime objective' },
        issue: { type: 'string', required: false, description: 'Linked issue slug or entity' },
        work_run_id: { type: 'string', required: false, description: 'Shared Work Run ID from the Work Driver lease' },
        work_run_state: {
          type: 'string',
          required: false,
          enum: [...WORK_RUN_STATES],
          description: 'Existing Work Run state; leased is expected when attaching a Work Driver lease',
        },
        work_item_id: { type: 'string', required: false, description: 'Canonical project/<slug>/issue/<slug> identity' },
        transition_token: { type: 'string', required: false, description: 'Idempotency token; generated for legacy calls' },
        output_class: { type: 'string', required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: 'string', required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: 'array', required: false, description: 'Logical provenance refs; never local paths or secrets' },
        stage: {
          type: 'string',
          required: false,
          enum: [...AGENT_STAGES],
          default: 'think',
          description:
            'Initial lifetime stage: think|plan|build|review|test|ship|reflect. test requires review:* evidence; ship requires review:* and test:* evidence.',
        },
        evidence: {
          type: 'array',
          required: false,
          description: 'Initial evidence refs. Use prefixes such as review:* and test:* for stage gates.',
        },
        notes: { type: 'string', required: false, description: 'Join notes' },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, 'workflow.agent.join');
        const agent = agentKey(params.agent, actor);
        const transitionToken = parseTransitionToken(params.transition_token);
        const existing = readAgentLifetime(vaultPath, project, agent);
        if (existing) {
          const receipt = findTransitionReceipt(existing, transitionToken, 'join');
          if (receipt) return replayResult(existing, receipt, agentEventsPath(project, agent));
          if (!isTerminalWorkRunState(existing.workRunState)) {
            throw makeErr(-32602, `${agent} already joined Work Run ${existing.workRunId}`);
          }
        }

        const now = isoNow();
        const path = agentLifetimePath(project, agent);
        const stage = parseAgentStage(params.stage, 'think');
        const evidence = stringList(params.evidence);
        assertAgentStageEvidence(stage, evidence);
        const workRunId = optionalString(params.work_run_id) ? parseWorkRunId(params.work_run_id) : createWorkRunId();
        const initialWorkRunState = optionalString(params.work_run_state)
          ? parseWorkRunState(params.work_run_state, 'leased')
          : optionalString(params.work_run_id)
            ? 'leased'
            : 'running';
        if (initialWorkRunState !== 'leased' && initialWorkRunState !== 'running') {
          throw makeErr(-32602, 'workflow.agent.join can attach only a leased or already-running Work Run');
        }
        const outputClass = parseOutputClass(params.output_class);
        const approvalStatus = parseApprovalStatus(params.approval_status, outputClass);
        let state: AgentLifetimeState = {
          projectId: projectId(project),
          project,
          workRunId,
          workRunState: initialWorkRunState === 'leased' ? transitionWorkRun('leased', 'running') : 'running',
          workItemId: parseWorkItemId(params.work_item_id, project, params.issue),
          agent,
          role: oneLine(params.role) || 'agent',
          host: oneLine(params.host) || actor,
          stage,
          status: 'active',
          objective: oneLine(params.objective),
          issue: oneLine(params.issue),
          evidence,
          provenance: stringList(params.provenance),
          outputClass,
          approvalStatus,
          transitions: [],
          startedAt: now,
          updatedAt: now,
          path,
        };
        state = withTransitionReceipt(state, transitionToken, 'join');

        writeVaultBytes(vaultPath, path, renderAgentLifetime(state, optionalString(params.notes)));
        const runPath = syncDurableWorkRun(vaultPath, state, transitionToken);
        const eventsPath = appendAgentEvent(vaultPath, state, {
          kind: 'join',
          summary: state.objective || `${agent} joined`,
          evidence: state.evidence,
          actor,
          transitionToken,
        });

        return { ok: true, idempotent: false, project, projectId: state.projectId, agent, workRunId, path, eventsPath, runPath, lifetime: state };
      },
    },
    {
  name: 'workflow.agent.step',
      namespace: 'workflow' as Operation['namespace'],
      description:
        'Advance a joined agent and its shared Work Run with idempotent transitions, review/test evidence gates, and terminal-state enforcement.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: workflowAgentTargets,
      audit: 'required',
      effects: workflowAgentEffects,
    },
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
        work_run_id: { type: 'string', required: false, description: 'Joined Work Run ID; resolved from lifetime when omitted' },
        work_run_state: { type: 'string', required: false, enum: [...WORK_RUN_STATES] },
        work_item_id: { type: 'string', required: false, description: 'Replacement canonical Work Item identity' },
        transition_token: { type: 'string', required: false, description: 'Idempotency token; generated for legacy calls' },
        output_class: { type: 'string', required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: 'string', required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: 'array', required: false },
        evidence: {
          type: 'array',
          required: false,
          description: 'Evidence refs to merge into lifetime. Use review:* before test and test:* before ship.',
        },
        summary: { type: 'string', required: false, description: 'Transition summary' },
        next: { type: 'string', required: false, description: 'Next action or stop condition' },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, 'workflow.agent.step');
        const agent = agentKey(params.agent, actor);
        const current = readAgentLifetime(vaultPath, project, agent);
        if (!current) throw makeErr(-32001, `Agent lifetime not found: ${agent}`);
        assertWorkRunIdentity(current, params.work_run_id);
        const transitionToken = parseTransitionToken(params.transition_token);
        const receipt = findTransitionReceipt(current, transitionToken, 'step');
        if (receipt) return replayResult(current, receipt, agentEventsPath(project, agent));
        assertWorkRunMutable(current);

        const stage = parseAgentStage(params.stage);
        const incomingEvidence = stringList(params.evidence);
        const evidence = mergeStringLists(current.evidence, incomingEvidence);
        assertAgentTransition(current, stage, evidence);

        const outputClass = parseOutputClass(params.output_class, current.outputClass);
        const approvalStatus = parseApprovalStatus(
          params.approval_status,
          outputClass,
          outputClass === current.outputClass ? current.approvalStatus : undefined,
        );
        let nextWorkRunState = optionalString(params.work_run_state)
          ? parseWorkRunState(params.work_run_state, current.workRunState)
          : stage === 'reflect'
            ? completionState(outputClass, approvalStatus)
            : current.workRunState;
        if (nextWorkRunState === 'completed' && completionState(outputClass, approvalStatus) !== 'completed') {
          throw makeErr(-32602, `${outputClass} output requires approval before completion`);
        }
        nextWorkRunState = transitionWorkRun(current.workRunState, nextWorkRunState);
        const defaultAgentStatus: AgentStatus = nextWorkRunState === 'completed' || stage === 'reflect'
          ? 'done'
          : nextWorkRunState === 'failed' || nextWorkRunState === 'cancelled'
            ? 'archived'
            : current.status;
        const status = parseAgentStatus(params.status, defaultAgentStatus);
        if (isTerminalWorkRunState(nextWorkRunState) && (status === 'active' || status === 'blocked')) {
          throw makeErr(-32602, `terminal Work Run ${nextWorkRunState} cannot use agent status ${status}`);
        }
        if (!isTerminalWorkRunState(nextWorkRunState) && status === 'archived') {
          throw makeErr(-32602, `non-terminal Work Run ${nextWorkRunState} cannot use agent status archived`);
        }
        let state: AgentLifetimeState = {
          ...current,
          stage,
          status,
          workRunState: nextWorkRunState,
          workItemId:
            params.work_item_id === undefined && params.issue === undefined
              ? current.workItemId
              : parseWorkItemId(params.work_item_id, project, params.issue ?? current.issue),
          objective: params.objective === undefined ? current.objective : oneLine(params.objective),
          issue: params.issue === undefined ? current.issue : oneLine(params.issue),
          evidence,
          provenance: mergeStringLists(current.provenance, stringList(params.provenance)),
          outputClass,
          approvalStatus,
          updatedAt: isoNow(),
        };
        state = withTransitionReceipt(state, transitionToken, 'step');

        writeVaultBytes(vaultPath, state.path, renderAgentLifetime(state, oneLine(params.summary)));
        const runPath = syncDurableWorkRun(vaultPath, state, transitionToken);
        const eventsPath = appendAgentEvent(vaultPath, state, {
          kind: 'step',
          summary: oneLine(params.summary) || `${current.stage} -> ${stage}`,
          evidence: incomingEvidence,
          next: oneLine(params.next),
          actor,
          transitionToken,
        });

        return { ok: true, idempotent: false, project, projectId: state.projectId, agent, workRunId: state.workRunId, path: state.path, eventsPath, runPath, lifetime: state };
      },
    },
    {
  name: 'workflow.agent.checkpoint',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Record an idempotent Work Run checkpoint, optionally routing output or moving to review/terminal state.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: workflowAgentTargets,
      audit: 'required',
      effects: workflowAgentEffects,
    },
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
        work_run_id: { type: 'string', required: false, description: 'Joined Work Run ID; resolved from lifetime when omitted' },
        work_run_state: { type: 'string', required: false, enum: [...WORK_RUN_STATES] },
        transition_token: { type: 'string', required: false, description: 'Idempotency token; generated for legacy calls' },
        output_class: { type: 'string', required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: 'string', required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: 'array', required: false },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, 'workflow.agent.checkpoint');
        const agent = agentKey(params.agent, actor);
        const current = readAgentLifetime(vaultPath, project, agent);
        if (!current) throw makeErr(-32001, `Agent lifetime not found: ${agent}`);
        assertWorkRunIdentity(current, params.work_run_id);
        const transitionToken = parseTransitionToken(params.transition_token);
        const receipt = findTransitionReceipt(current, transitionToken, 'checkpoint');
        if (receipt) return replayResult(current, receipt, agentEventsPath(project, agent));
        assertWorkRunMutable(current);
        const status = parseCheckpointStatus(params.status);
        const summary = oneLine(params.summary);
        if (!summary) throw makeErr(-32602, 'summary required');

        const outputClass = parseOutputClass(params.output_class, current.outputClass);
        const approvalStatus = parseApprovalStatus(
          params.approval_status,
          outputClass,
          outputClass === current.outputClass ? current.approvalStatus : undefined,
        );
        let nextWorkRunState = optionalString(params.work_run_state)
          ? parseWorkRunState(params.work_run_state, current.workRunState)
          : status === 'failed'
            ? 'failed'
            : current.workRunState;
        if (nextWorkRunState === 'completed' && completionState(outputClass, approvalStatus) !== 'completed') {
          throw makeErr(-32602, `${outputClass} output requires approval before completion`);
        }
        nextWorkRunState = transitionWorkRun(current.workRunState, nextWorkRunState);
        const incomingEvidence = stringList(params.evidence);
        let state: AgentLifetimeState = {
          ...current,
          workRunState: nextWorkRunState,
          status:
            nextWorkRunState === 'completed'
              ? 'done'
              : nextWorkRunState === 'failed' || nextWorkRunState === 'cancelled'
                ? 'archived'
                : current.status,
          evidence: mergeStringLists(current.evidence, incomingEvidence),
          provenance: mergeStringLists(current.provenance, stringList(params.provenance)),
          outputClass,
          approvalStatus,
          updatedAt: isoNow(),
        };
        state = withTransitionReceipt(state, transitionToken, 'checkpoint');
        writeVaultBytes(vaultPath, state.path, renderAgentLifetime(state, summary));
        const runPath = syncDurableWorkRun(vaultPath, state, transitionToken);

        const eventsPath = appendAgentEvent(vaultPath, state, {
          kind: `checkpoint:${status}`,
          summary,
          evidence: incomingEvidence,
          next: oneLine(params.next),
          actor,
          transitionToken,
        });

        return {
          ok: true,
          idempotent: false,
          project,
          projectId: state.projectId,
          agent,
          workRunId: state.workRunId,
          path: state.path,
          eventsPath,
          runPath,
          stage: state.stage,
          status,
          workRunState: state.workRunState,
          lifetime: state,
        };
      },
    },
    {
  name: 'workflow.agent.leave',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Leave a Work Run through awaiting-review or terminal state while preserving its durable lifetime and event log.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: workflowAgentTargets,
      audit: 'required',
      effects: workflowAgentEffects,
    },
    params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        summary: { type: 'string', required: false, description: 'Leave summary' },
        work_run_id: { type: 'string', required: false, description: 'Joined Work Run ID; resolved from lifetime when omitted' },
        work_run_state: {
          type: 'string',
          required: false,
          enum: ['awaiting_review', 'completed', 'failed', 'cancelled'],
          description: 'Final or review handoff state; defaults to cancelled for an unfinished run',
        },
        transition_token: { type: 'string', required: false, description: 'Idempotency token; generated for legacy calls' },
        output_class: { type: 'string', required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: 'string', required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: 'array', required: false },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, 'workflow.agent.leave');
        const agent = agentKey(params.agent, actor);
        const current = readAgentLifetime(vaultPath, project, agent);
        if (!current) throw makeErr(-32001, `Agent lifetime not found: ${agent}`);
        assertWorkRunIdentity(current, params.work_run_id);
        const transitionToken = parseTransitionToken(params.transition_token);
        const receipt = findTransitionReceipt(current, transitionToken, 'leave');
        if (receipt) return replayResult(current, receipt, agentEventsPath(project, agent));
        assertWorkRunMutable(current);
        const outputClass = parseOutputClass(params.output_class, current.outputClass);
        const approvalStatus = parseApprovalStatus(
          params.approval_status,
          outputClass,
          outputClass === current.outputClass ? current.approvalStatus : undefined,
        );
        let nextWorkRunState = parseWorkRunState(params.work_run_state, 'cancelled');
        if (nextWorkRunState === 'completed' && completionState(outputClass, approvalStatus) !== 'completed') {
          throw makeErr(-32602, `${outputClass} output requires approval before completion`);
        }
        nextWorkRunState = transitionWorkRun(current.workRunState, nextWorkRunState);
        let state: AgentLifetimeState = {
          ...current,
          status: 'archived',
          workRunState: nextWorkRunState,
          provenance: mergeStringLists(current.provenance, stringList(params.provenance)),
          outputClass,
          approvalStatus,
          updatedAt: isoNow(),
        };
        state = withTransitionReceipt(state, transitionToken, 'leave');

        writeVaultBytes(vaultPath, state.path, renderAgentLifetime(state, oneLine(params.summary)));
        const runPath = syncDurableWorkRun(vaultPath, state, transitionToken);
        const eventsPath = appendAgentEvent(vaultPath, state, {
          kind: 'leave',
          summary: oneLine(params.summary) || `${agent} archived`,
          actor,
          transitionToken,
        });

        return { ok: true, idempotent: false, project, projectId: state.projectId, agent, workRunId: state.workRunId, path: state.path, eventsPath, runPath, lifetime: state };
      },
    },
    {
      name: 'workflow.agent.doctor',
      namespace: 'workflow' as Operation['namespace'],
      description: 'Check one agent lifetime, Work Run identity, transition receipts, output policy, and event log for consistency.',
      mutating: false,
      params: {
        project: { type: 'string', required: true, description: 'Project key' },
        agent: { type: 'string', required: false, description: 'Agent id; defaults collaboration actor' },
        work_run_id: { type: 'string', required: false, description: 'Expected Work Run ID for cross-runtime join diagnosis' },
      },
      handler: async (ctx, params) => {
        const actor = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, 'workflow.agent.doctor');
        const agent = agentKey(params.agent, actor);
        const expectedWorkRunId = optionalString(params.work_run_id) ? parseWorkRunId(params.work_run_id) : undefined;
        return agentDoctor(vaultPath, project, agent, expectedWorkRunId);
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
      handler: async (_ctx, params) => workflowDoctor(
        vaultPath,
        existingProjectKey(vaultPath, params.project, 'workflow.doctor'),
      ),
    },
  ];
}
