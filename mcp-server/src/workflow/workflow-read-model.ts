import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fingerprintRecoveryValue, hasUnsafeRecoveryMaterial, type RecoveryFingerprint } from '../project-hub/contract-support.js';
import { isCanonicalWorkItemId, isCanonicalWorkRunId, readWorkflowState } from './workflow.js';

export interface WorkflowRunRead {
  projectId: string;
  workItemId: string;
  workRunId: string;
  agentId: string;
  state: string;
  observedAt: string;
  leaseExpiresAt: string | null;
  recordFingerprint: RecoveryFingerprint;
  malformed: boolean;
}

export interface WorkflowCheckpointRead {
  checkpointId: string;
  stage: string;
  status: string;
  summary: string;
  recordedAt: string;
  citationTargets: string[];
}

export interface NormalizedWorkRunRuntime {
  readonly projectId: string;
  readonly workRunId: string | null;
  readonly workItemId: string | null;
  readonly state: string | null;
  readonly stage: string | null;
  readonly resumable: boolean;
  readonly path: string;
  readonly stale: boolean;
  readonly citationTargets: readonly string[];
}

export interface NormalizedWorkRunProjection {
  readonly activeRuns: readonly NormalizedWorkRunRuntime[];
  readonly staleRuns: readonly NormalizedWorkRunRuntime[];
  readonly runCount: number;
  readonly agentStateFiles: readonly string[];
  readonly workflowState: { readonly stage: string; readonly objective: string; readonly path: string } | null;
  readonly stage: string | null;
  readonly stageCitation: string | null;
  readonly sourceFiles: readonly string[];
  readonly drift: readonly string[];
}

export interface WorkflowReadModel {
  readRun(projectId: string, workRunId: string): WorkflowRunRead | null;
  listRuns(projectId: string): WorkflowRunRead[];
  listCheckpoints(projectId: string, workRunId: string): WorkflowCheckpointRead[];
  checkpointSetFingerprint(projectId: string, workRunId: string): RecoveryFingerprint;
  readRuntimeProjection(projectId: string, observedAt?: number): NormalizedWorkRunProjection;
}

const PROJECT_ID = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SAFE_AGENT = /^[a-z0-9][a-z0-9-]{0,127}$/u;

function vaultPath(vault: string, relative: string): string {
  return join(vault, ...relative.split('/'));
}

function slug(projectId: string): string | null {
  return PROJECT_ID.test(projectId) ? projectId.slice('project/'.length) : null;
}

function digest(bytes: string): RecoveryFingerprint {
  return `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`;
}

function field(raw: Record<string, unknown>, ...names: string[]): unknown {
  return names.map((name) => raw[name]).find((value) => value !== undefined);
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !ISO.test(value) || !Number.isFinite(Date.parse(value))) return '';
  return value;
}

function safeField(value: unknown, max = 512): string {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized.length > max || hasUnsafeRecoveryMaterial(normalized)) return '';
  return normalized;
}
function protocolField(value: unknown, max = 64): string | null {
  if (typeof value !== 'string' || value.length > max || hasUnsafeRecoveryMaterial(value)) return null;
  return value;
}

function runFromBytes(projectId: string, workRunId: string, bytes: string): WorkflowRunRead {
  const malformed = (fingerprint: RecoveryFingerprint): WorkflowRunRead => ({
    projectId,
    workItemId: '',
    workRunId,
    agentId: '',
    state: 'malformed',
    observedAt: '',
    leaseExpiresAt: null,
    recordFingerprint: fingerprint,
    malformed: true,
  });
  const recordFingerprint = digest(bytes);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes);
  } catch {
    return malformed(recordFingerprint);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return malformed(recordFingerprint);
  const record = raw as Record<string, unknown>;
  const recordProject = safeField(field(record, 'project_id', 'projectId'), 200);
  const recordRun = safeField(field(record, 'work_run_id', 'workRunId'), 200);
  const workItemId = safeField(field(record, 'work_item_id', 'workItemId'), 256);
  const agentId = safeField(field(record, 'agent_id', 'agentId'), 128);

  const state = safeField(record.state, 64);
  const observedAt = timestamp(field(record, 'updated_at', 'updatedAt', 'observed_at', 'observedAt'))
    || timestamp(field(record, 'created_at', 'createdAt'));
  const expiry = timestamp(field(record, 'lease_expires_at', 'leaseExpiresAt', 'expires_at', 'expiresAt')) || null;
  if (
    recordProject !== projectId
    || recordRun !== workRunId
    || !isCanonicalWorkItemId(workItemId)
    || !workItemId.startsWith(`${projectId}/issue/`)
    || !isCanonicalWorkRunId(recordRun)
    || !SAFE_AGENT.test(agentId)
    || !state
  ) return malformed(recordFingerprint);
  return {
    projectId,
    workItemId,
    workRunId,
    agentId,
    state,
    observedAt,
    leaseExpiresAt: expiry,
    recordFingerprint,
    malformed: false,
  };
}

function aliasedRuntimeField(
  raw: Record<string, unknown>,
  canonical: string,
  legacy: string,
  path: string,
  drift: string[],
): unknown {
  const canonicalValue = raw[canonical];
  const legacyValue = raw[legacy];
  if (canonicalValue !== undefined && legacyValue !== undefined && canonicalValue !== legacyValue) {
    drift.push(`run_${canonical}_conflict:${path}`);
    return undefined;
  }
  return canonicalValue ?? legacyValue;
}
function isRegularFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}


function discoverRuntimeFiles(
  vault: string,
  rootRelative: string,
  predicate: (name: string) => boolean,
  excludeRuntimeDirectories = false,
): string[] {
  const files: string[] = [];
  const visit = (directory: string, relativeDirectory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!excludeRuntimeDirectories || !/^(?:output|recovery)-/u.test(entry.name)) visit(fullPath, relativePath);
      } else if (entry.isFile() && predicate(entry.name)) files.push(relativePath);
    }
  };
  visit(vaultPath(vault, rootRelative), rootRelative);
  return files.sort((left, right) => left.localeCompare(right));
}

function normalizedRuntimeRun(
  projectId: string,
  path: string,
  bytes: string,
  observedAt: number,
  drift: string[],
): NormalizedWorkRunRuntime | null {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes);
  } catch {
    drift.push(`malformed_run:${path}`);
    return null;
  }
  try {
    const record = raw as Record<string, unknown>;
    const recordProject = aliasedRuntimeField(record, 'projectId', 'project_id', path, drift);
    if (typeof recordProject !== 'string') {
      drift.push(`run_project_id_missing:${path}`);
      return null;
    }
    if (recordProject !== projectId) {
      drift.push(`run_project_mismatch:${path}`);
      return null;
    }

    const workRunValue = aliasedRuntimeField(record, 'workRunId', 'work_run_id', path, drift);
    const validWorkRunId = isCanonicalWorkRunId(workRunValue);
    if (!validWorkRunId) drift.push(`run_work_id_invalid:${path}`);
    const workItemValue = aliasedRuntimeField(record, 'workItemId', 'work_item_id', path, drift);
    const validWorkItemId = isCanonicalWorkItemId(workItemValue) && workItemValue.startsWith(`${projectId}/`);
    if (!validWorkItemId) drift.push(`run_work_item_id_invalid:${path}`);

    const expiryValues = [
      record.leaseExpiresAt,
      record.lease_expires_at,
      record.handoffExpiresAt,
      record.handoff_expires_at,
      record.expiresAt,
      record.expires_at,
    ].filter((value): value is Exclude<unknown, undefined> => value !== undefined).map(String);
    const expiry = expiryValues[0] ?? '';
    const expiryConflict = expiryValues.some((value) => value !== expiry);
    if (expiryConflict) drift.push(`run_expiry_conflict:${path}`);
    const expiryMs = expiry ? Date.parse(expiry) : Number.NaN;
    const validExpiry = !expiry || (!expiryConflict && Number.isFinite(expiryMs));
    if (expiry && !Number.isFinite(expiryMs)) drift.push(`run_expiry_invalid:${path}`);
    const stale = Boolean(expiry) && Number.isFinite(expiryMs) && expiryMs <= observedAt;
    if (stale) drift.push(`expired_work_run:${path}`);
    const state = protocolField(record.state);
    const stage = protocolField(record.stage ?? record.agentStage);
    const runtime: NormalizedWorkRunRuntime = {
      projectId,
      workRunId: validWorkRunId ? workRunValue : null,
      workItemId: validWorkItemId ? workItemValue : null,
      state,
      stage,
      resumable: validWorkRunId && validWorkItemId && validExpiry,
      path,
      stale,
      citationTargets: [path],
    };
    return runtime;
  } catch {
    drift.push(`malformed_run:${path}`);
    return null;
  }
}

function runFile(vault: string, projectId: string, workRunId: string): string {
  return vaultPath(vault, `01-Projects/${projectId.slice('project/'.length)}/runs/${workRunId.slice('work-run/'.length)}.json`);
}

interface EventBlock {
  heading: string;
  lines: string[];
}

function eventBlocks(content: string): EventBlock[] {
  const blocks: EventBlock[] = [];
  let current: EventBlock | null = null;
  for (const line of content.split(/\r?\n/u)) {
    if (line.startsWith('## ')) {
      if (current) blocks.push(current);
      current = { heading: line.slice(3), lines: [] };
    } else if (current) current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks;
}

function lineValue(lines: readonly string[], key: string): string {
  const line = lines.find((item) => item.startsWith(`- ${key}:`));
  return line ? line.slice(key.length + 3).trim() : '';
}

function checkpointFromBlock(block: EventBlock, projectId: string, workRunId: string): WorkflowCheckpointRead | null {
  const parts = block.heading.split(' - ');
  const recordedAt = timestamp(parts[0]);
  const kind = parts[1] ?? '';
  const actor = safeField(parts.slice(2).join(' - '), 128);
  const eventRun = safeField(lineValue(block.lines, 'work-run-id'), 200);
  if (!recordedAt || !kind.startsWith('checkpoint:') || eventRun !== workRunId) return null;
  const stage = safeField(lineValue(block.lines, 'stage'), 64);
  const status = safeField(lineValue(block.lines, 'status'), 64) || kind.slice('checkpoint:'.length);
  const summary = safeField(lineValue(block.lines, 'summary'), 1_024);
  if (!stage || !status || !summary) return null;
  const evidenceStart = block.lines.findIndex((line) => line === '- evidence:');
  const citationTargets = evidenceStart < 0
    ? []
    : block.lines.slice(evidenceStart + 1).map((line) => line.match(/^\s+- (.+)$/u)?.[1] ?? '').map((value) => safeField(value, 512)).filter(Boolean);
  const transitionToken = safeField(lineValue(block.lines, 'transition-token'), 128);
  const identity = { projectId, workRunId, recordedAt, kind, actor, transitionToken, summary };
  return {
    checkpointId: `checkpoint/${fingerprintRecoveryValue(identity).slice('sha256:'.length, 'sha256:'.length + 32)}`,
    stage,
    status,
    summary,
    recordedAt,
    citationTargets: [...new Set(citationTargets)].sort((left, right) => left.localeCompare(right)),
  };
}

function checkpoints(vault: string, projectId: string, workRunId: string, agentId: string): WorkflowCheckpointRead[] {
  if (!SAFE_AGENT.test(agentId)) return [];
  const path = vaultPath(vault, `01-Projects/${projectId.slice('project/'.length)}/agents/${agentId}/events.md`);
  if (!existsSync(path)) return [];
  let content: string;
  try { content = readFileSync(path, 'utf8'); } catch { return []; }
  return eventBlocks(content)
    .map((block) => checkpointFromBlock(block, projectId, workRunId))
    .filter((item): item is WorkflowCheckpointRead => item !== null)
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt) || left.checkpointId.localeCompare(right.checkpointId))
    .slice(0, 32)
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.checkpointId.localeCompare(right.checkpointId));
}

export function createWorkflowReadModel(vault: string): WorkflowReadModel {
  return {
    readRun(projectId, workRunId) {
      const project = slug(projectId);
      if (!project || !isCanonicalWorkRunId(workRunId)) return null;
      const path = runFile(vault, projectId, workRunId);
      if (!existsSync(path)) return null;
      try { return runFromBytes(projectId, workRunId, readFileSync(path, 'utf8')); }
      catch { return null; }
    },
    listRuns(projectId) {
      const project = slug(projectId);
      if (!project) return [];
      const root = vaultPath(vault, `01-Projects/${project}/runs`);
      if (!existsSync(root)) return [];
      const files = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .sort((left, right) => left.name.localeCompare(right.name));
      const runs: WorkflowRunRead[] = [];
      for (const entry of files) {
        const workRunId = `work-run/${entry.name.slice(0, -'.json'.length)}`;
        if (!isCanonicalWorkRunId(workRunId)) continue;
        const path = join(root, entry.name);
        try {
          const run = runFromBytes(projectId, workRunId, readFileSync(path, 'utf8'));
          runs.push(run);
        } catch {
          runs.push(runFromBytes(projectId, workRunId, 'malformed'));
        }
      }
      return runs.sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.workRunId.localeCompare(right.workRunId));
    },
    readRuntimeProjection(projectId, observedAt = Date.now()) {
      const project = slug(projectId);
      if (!project) {
        return {
          activeRuns: [],
          staleRuns: [],
          runCount: 0,
          agentStateFiles: [],
          workflowState: null,
          stage: null,
          stageCitation: null,
          sourceFiles: [],
          drift: [],
        };
      }

      const runsRoot = `01-Projects/${project}/runs`;
      const runFiles = discoverRuntimeFiles(vault, runsRoot, (name) => name.endsWith('.json'), true);
      const drift: string[] = [];
      const parsedRuns: NormalizedWorkRunRuntime[] = [];
      for (const path of runFiles) {
        const nestedPath = path.slice(runsRoot.length + 1);
        if (nestedPath.includes('/')) drift.push(`run_noncanonical_path:${path}`);
        try {
          const parsed = normalizedRuntimeRun(projectId, path, readFileSync(vaultPath(vault, path), 'utf8'), observedAt, drift);
          if (parsed) parsedRuns.push(parsed);
        } catch {
          drift.push(`malformed_run:${path}`);
        }
      }

      const agentStateFiles = discoverRuntimeFiles(
        vault,
        `01-Projects/${project}/agents`,
        () => true,
      );
      const workflowPath = `01-Projects/${project}/workflow/status.md`;
      const workflowPathExists = existsSync(vaultPath(vault, workflowPath));
      const workflowFileExists = workflowPathExists && isRegularFile(vaultPath(vault, workflowPath));
      let workflowState: { readonly stage: string; readonly objective: string; readonly path: string } | null = null;
      if (workflowPathExists) {
        try {
          const state = readWorkflowState(vault, project);
          const safeStage = safeField(state?.stage, 64);
          const safeObjective = safeField(state?.objective, 1_024);
          workflowState = state && safeStage
            ? { stage: safeStage, objective: safeObjective, path: state.path }
            : null;
          if (!state || !safeStage) drift.push('malformed_workflow_state');
        } catch {
          drift.push('malformed_workflow_state');
        }
      }

      const activeStates = new Set(['planned', 'leased', 'running', 'awaiting_review']);
      const activeRuns = parsedRuns
        .filter((run) => activeStates.has(run.state ?? '') && !run.stale);
      const staleRuns = parsedRuns.filter((run) => run.stale);
      const stagedRun = activeRuns.find((run) => run.resumable && Boolean(run.stage?.trim()));
      return {
        activeRuns,
        staleRuns,
        runCount: parsedRuns.length,
        agentStateFiles: [...agentStateFiles],
        workflowState,
        stage: workflowState?.stage ?? stagedRun?.stage ?? null,
        stageCitation: workflowState?.path ?? stagedRun?.path ?? null,
        sourceFiles: [...agentStateFiles, ...runFiles, ...(workflowFileExists ? [workflowPath] : [])].sort((left, right) => left.localeCompare(right)),
        drift: [...new Set(drift)],
      };
    },
    listCheckpoints(projectId, workRunId) {
      const run = this.readRun(projectId, workRunId);
      return run && !run.malformed ? checkpoints(vault, projectId, workRunId, run.agentId) : [];
    },
    checkpointSetFingerprint(projectId, workRunId) {
      return fingerprintRecoveryValue(this.listCheckpoints(projectId, workRunId));
    },
  };
}

export const createFileWorkflowReadModel = createWorkflowReadModel;
