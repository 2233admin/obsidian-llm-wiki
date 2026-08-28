import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fingerprintRecoveryValue, hasUnsafeRecoveryMaterial, type RecoveryFingerprint } from '../project-hub/contract-support.js';
import { isCanonicalWorkItemId, isCanonicalWorkRunId } from './workflow.js';

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

export interface WorkflowReadModel {
  readRun(projectId: string, workRunId: string): WorkflowRunRead | null;
  listRuns(projectId: string): WorkflowRunRead[];
  listCheckpoints(projectId: string, workRunId: string): WorkflowCheckpointRead[];
  checkpointSetFingerprint(projectId: string, workRunId: string): RecoveryFingerprint;
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
