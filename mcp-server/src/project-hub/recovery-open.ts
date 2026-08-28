import {
  deriveRecoveryFlowRequests,
  fingerprintRecoveryFlowIntrinsicStage,
  RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
  RECOVERY_FLOW_SCHEMA_VERSION,
  validateRecoveryFlowResponseV2,
  type RecoveryCapabilityFactV2,
  type RecoveryFlowDiagnosticV2,
  type RecoveryOpenResponseV2,
  type RecoveryFlowResponseV2,
  type RecoveryOpenPayloadV2,
  type RecoveryOwner,
  type RecoveryOwnerLock,
  type RecoveryUnavailableResponseV2,
} from './recovery-flow.js';
import { fingerprintRecoveryValue, utf8JsonBytes, hasUnsafeRecoveryMaterial, safeRecoveryText, type RecoveryFingerprint } from './contract-support.js';
import type { WorkflowCheckpointRead, WorkflowReadModel, WorkflowRunRead } from '../workflow/workflow-read-model.js';

export interface RecoveryWorkItemRead {
  entity: string;
  label: string;
  state: string;
  blockedBy: string[];
  citationTargets: string[];
  currentStage?: string | null;
}
export interface RecoveryDecisionRead {
  [key: string]: unknown;
  decisionId?: string;
  claimId?: string;
  text?: string;
  value?: unknown;
  citationTargets: string[];
  reviewStatus?: string;
  state?: string;
}
export interface RecoveryMemoryRead {
  projectId?: string;
  revision?: string | number | null;
  fingerprint?: RecoveryFingerprint | null;
  freshness?: string;
  reviewedDecisions?: RecoveryDecisionRead[];
  decisions?: RecoveryDecisionRead[];
  claims?: RecoveryDecisionRead[];
  sections?: { currentState?: { claims?: RecoveryDecisionRead[] } };
  diagnostics?: string[];
  citationTargets?: string[];
}
export interface RecoverySessionRead {
  sessionId: string;
  projectId?: string;
  workItemId?: string | null;
  capturedAt?: string | null;
  status?: string;
  revision?: string | number | null;
  citationTargets?: string[];
}
export interface RecoveryCapabilityRead {
  capability: string;
  state: 'available' | 'degraded' | string;
  revision?: string | number | null;
  fingerprint?: RecoveryFingerprint | null;
  citationTargets?: string[];
}
export interface RecoveryOpenOwners {
  workflow: WorkflowReadModel;
  loadWorkItems(projectId: string): RecoveryWorkItemRead[];
  loadProjectMemory(projectId: string): Promise<RecoveryMemoryRead>;
  listSessions(projectId: string): Promise<RecoverySessionRead[]>;
  loadCapabilities(projectId: string): Promise<RecoveryCapabilityRead[]>;
}

const PROJECT_ID = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const RUN_STATES = new Set(['planned', 'leased', 'running', 'awaiting_review']);
const SESSION_STATES = new Set(['captured', 'indexed']);
const OWNER_ORDER: readonly RecoveryOwner[] = ['project', 'work-os', 'workflow', 'project-memory', 'session-record', 'source-evidence', 'agent-domain', 'settings'];

function text(value: unknown, label: string, max = 512, required = false): string {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error(`${label} is required`);
    return '';
  }
  try { return safeRecoveryText(value, label, { minBytes: 1, maxBytes: max }); }
  catch (error) { if (required) throw error; return ''; }
}

function refs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, 'citation', 512)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function revision(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && value.trim() && !hasUnsafeRecoveryMaterial(value)) return value.trim();
  return null;
}

function validTimestamp(value: unknown): string | null {
  return typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

function diagnostic(owner: RecoveryOwner, code: string, severity: RecoveryFlowDiagnosticV2['severity'], message: string, remediation: string, citationTargets: string[] = []): RecoveryFlowDiagnosticV2 {
  return { owner, code, severity, message, remediation, citationTargets: refs(citationTargets) };
}

function normalizeItems(projectId: string, rawItems: unknown): RecoveryWorkItemRead[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const entity = text(raw?.entity, 'work item entity', 256);
    const label = text(raw?.label, 'work item label', 512);
    if (!entity.startsWith(`${projectId}/issue/`) || !/^project\/[a-z0-9][a-z0-9-]*\/issue\/[a-z0-9][a-z0-9-]*$/u.test(entity) || !label) return [];
    const blockedBy = refs(raw.blockedBy).filter((item) => item.startsWith(`${projectId}/issue/`));
    return [{ entity, label, state: text(raw.state, 'work item state', 64) || 'unknown', blockedBy, citationTargets: refs(raw.citationTargets), currentStage: raw.currentStage ?? null }];
  }).sort((left, right) => left.entity.localeCompare(right.entity));
}

function groups(items: RecoveryWorkItemRead[]): RecoveryOpenPayloadV2['workGroups'] {
  const view = (item: RecoveryWorkItemRead) => ({ entity: item.entity, label: item.label, state: item.state, blockedBy: item.blockedBy, citationTargets: item.citationTargets });
  const done = items.filter((item) => item.state === 'done').map(view).slice(0, 128);
  const inProgress = items.filter((item) => item.state === 'in-progress').map(view).slice(0, 128);
  const blocked = items.filter((item) => item.blockedBy.length > 0).map(view).slice(0, 128);
  const notStarted = items.filter((item) => item.blockedBy.length === 0 && (item.state === 'backlog' || item.state === 'todo')).map(view).slice(0, 128);
  return { done, inProgress, blocked, notStarted };
}

function chooseWorkItem(items: RecoveryWorkItemRead[]): RecoveryWorkItemRead | null {
  return items.find((item) => item.state === 'in-progress')
    ?? items.find((item) => item.state === 'todo')
    ?? items.find((item) => item.state === 'backlog')
    ?? null;
}

function chooseRun(projectId: string, items: RecoveryWorkItemRead[], runs: unknown, generatedAt: string): WorkflowRunRead | null {
  const itemIds = new Set(items.map((item) => item.entity));
  if (!Array.isArray(runs)) return null;
  return runs
    .filter((run): run is WorkflowRunRead => Boolean(run && typeof run === 'object' && !Array.isArray(run)))
    .filter((run) => !run.malformed && run.projectId === projectId && itemIds.has(run.workItemId) && RUN_STATES.has(run.state))
    .filter((run) => !run.leaseExpiresAt || Date.parse(run.leaseExpiresAt) > Date.parse(generatedAt))
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.workRunId.localeCompare(right.workRunId))[0] ?? null;
}

function chooseSession(projectId: string, item: RecoveryWorkItemRead | null, sessions: unknown): RecoverySessionRead | null {
  if (!item || !Array.isArray(sessions)) return null;
  return sessions
    .filter((session): session is RecoverySessionRead => Boolean(session && typeof session === 'object' && !Array.isArray(session)
      && session.projectId === projectId && session.workItemId === item.entity
      && SESSION_STATES.has(session.status ?? '') && text(session.sessionId, 'session id', 256)
      && validTimestamp(session.capturedAt)))
    .sort((left, right) => String(right.capturedAt ?? '').localeCompare(String(left.capturedAt ?? '')) || left.sessionId.localeCompare(right.sessionId))[0] ?? null;
}

function capabilityFacts(capabilities: RecoveryCapabilityRead[]): { facts: RecoveryCapabilityFactV2[]; citations: string[]; fingerprint: RecoveryFingerprint } {
  const facts = capabilities.flatMap((raw) => {
    const capability = text(raw.capability, 'capability', 256);
    if (!capability || (raw.state !== 'available' && raw.state !== 'degraded')) return [];
    return [{ capability, state: raw.state } as RecoveryCapabilityFactV2];
  }).sort((left, right) => left.capability.localeCompare(right.capability));
  return { facts, citations: capabilities.flatMap((item) => refs(item.citationTargets)), fingerprint: fingerprintRecoveryValue(facts) };
}

function lock(owner: RecoveryOwner, value: unknown, state: RecoveryOwnerLock['state'] = 'current'): RecoveryOwnerLock {
  const provided = value && typeof value === 'object' ? (value as Record<string, unknown>).fingerprint : null;
  const fingerprint = typeof provided === 'string' && /^sha256:[a-f0-9]{64}$/u.test(provided) ? provided as RecoveryFingerprint : value ? fingerprintRecoveryValue(value) : null;
  return { owner, revision: revision(value && typeof value === 'object' ? (value as Record<string, unknown>).revision : null), fingerprint, state };
}

function contextDecision(raw: RecoveryDecisionRead): { decisionId: string; text: string; citationTargets: string[] } | null {
  if (raw.reviewStatus !== 'reviewed') return null;
  const decisionId = text(raw.decisionId ?? raw.claimId, 'decision id', 256);
  const rawText = raw.text || (typeof raw.value === 'string' ? raw.value : raw.value === undefined ? '' : JSON.stringify(raw.value));
  const decisionText = text(rawText, 'decision text', 4096);
  return decisionId && decisionText ? { decisionId, text: decisionText, citationTargets: refs(raw.citationTargets) } : null;
}

function openResponse(projectId: string, generatedAt: string, payload: RecoveryOpenPayloadV2, owners: RecoveryOwnerLock[], recoveryFingerprint: RecoveryFingerprint, diagnostics: RecoveryFlowDiagnosticV2[], omitted: { items: number; citations: number; diagnostics: number; bytes: number }): RecoveryOpenResponseV2 {
  const actionInputFingerprint = fingerprintRecoveryValue({ action: 'open', projectId });
  const intents = (payload.suggestedQueries ?? []).slice(0, 3).map((query) => ({ action: 'search' as const, query, limit: 25 }));
  const intrinsic = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'open' as const,
    projectId,
    previousFlowFingerprint: null,
    actionInputFingerprint,
    recoveryFingerprint,
    ownerLocks: owners,
    payloadFingerprint: fingerprintRecoveryValue(payload),
    nextRequestIntents: intents,
    diagnostics,
    omitted,
  };
  const flowFingerprint = fingerprintRecoveryFlowIntrinsicStage(intrinsic);
  const response = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage: 'open' as const,
    projectId,
    previousFlowFingerprint: null,
    actionInputFingerprint,
    recoveryFingerprint,
    ownerLocks: owners,
    payload,
    nextRequestIntents: intents,
    diagnostics,
    omitted,
    rootOpenFlowFingerprint: flowFingerprint,
    nextRequests: intents.map((intent) => ({ schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId, action: 'search' as const, openFlowFingerprint: flowFingerprint, query: intent.query, limit: intent.limit })),
    generatedAt,
    flowFingerprint,
  } as RecoveryFlowResponseV2;
  return validateRecoveryFlowResponseV2(response) as RecoveryOpenResponseV2;
}

function unavailable(projectId: string, generatedAt: string, locks: RecoveryOwnerLock[], reason: string, remediation: string, diagnostics: RecoveryFlowDiagnosticV2[], recoveryFingerprint: RecoveryFingerprint): RecoveryUnavailableResponseV2 {
  const actionInputFingerprint = fingerprintRecoveryValue({ action: 'open', projectId });
  const payload = { kind: 'unavailable' as const, reason: text(reason, 'reason', 128, true), remediation: text(remediation, 'remediation', 1024, true) };
  const intrinsic = { schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION, stage: 'unavailable' as const, projectId, previousFlowFingerprint: actionInputFingerprint, actionInputFingerprint, recoveryFingerprint, ownerLocks: locks, payloadFingerprint: fingerprintRecoveryValue(payload), nextRequestIntents: [], diagnostics: diagnostics.slice(0, 32), omitted: { items: 0, citations: 0, diagnostics: Math.max(0, diagnostics.length - 32), bytes: 0 } };
  const flowFingerprint = fingerprintRecoveryFlowIntrinsicStage(intrinsic);
  return validateRecoveryFlowResponseV2({ schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION, stage: 'unavailable', projectId, previousFlowFingerprint: actionInputFingerprint, actionInputFingerprint, recoveryFingerprint, ownerLocks: locks, payload, nextRequestIntents: [], diagnostics: diagnostics.slice(0, 32), omitted: intrinsic.omitted, rootOpenFlowFingerprint: actionInputFingerprint, nextRequests: [], generatedAt, flowFingerprint } as RecoveryFlowResponseV2) as RecoveryUnavailableResponseV2;
}

export async function composeRecoveryOpenStage(projectId: string, owners: RecoveryOpenOwners, generatedAt: string): Promise<RecoveryFlowResponseV2 & { stage: 'open' | 'unavailable' }> {
  if (!PROJECT_ID.test(projectId)) throw new Error('Recovery open projectId must be canonical');
  if (!ISO.test(generatedAt) || !Number.isFinite(Date.parse(generatedAt))) throw new Error('Recovery open generatedAt must be an ISO timestamp');
  let rawItems: RecoveryWorkItemRead[];
  let rawMemory: RecoveryMemoryRead;
  let sessions: RecoverySessionRead[];
  let capabilities: RecoveryCapabilityRead[];
  try {
    [rawItems, rawMemory, sessions, capabilities] = await Promise.all([
      Promise.resolve(owners.loadWorkItems(projectId)),
      owners.loadProjectMemory(projectId),
      owners.listSessions(projectId),
      owners.loadCapabilities(projectId),
    ]);
  } catch {
    return unavailable(projectId, generatedAt, OWNER_ORDER.map((owner) => lock(owner, null, owner === 'project' || owner === 'work-os' ? 'unavailable' : 'current')), 'mandatory_owner_unavailable', 'Inspect the owning Project, Work-OS, Workflow, and capability sources before retrying recovery.', [diagnostic('project', 'owner_unavailable', 'error', 'A mandatory recovery owner could not be read.', 'Repair the owner and retry open.')], fingerprintRecoveryValue({ projectId }));
  }
  const rawItemList = Array.isArray(rawItems) ? rawItems : [];
  const items = normalizeItems(projectId, rawItemList);
  let runs: WorkflowRunRead[] = [];
  try { runs = owners.workflow.listRuns(projectId); } catch {
    return unavailable(projectId, generatedAt, OWNER_ORDER.map((owner) => lock(owner, null, owner === 'workflow' ? 'unavailable' : 'current')), 'mandatory_owner_unavailable', 'Inspect the owning Workflow source before retrying recovery.', [diagnostic('workflow', 'owner_unavailable', 'error', 'The Workflow owner could not be read.', 'Repair Workflow and retry open.')], fingerprintRecoveryValue({ projectId }));
  }
  const selectedRun = chooseRun(projectId, items, runs, generatedAt);
  const item = selectedRun ? items.find((entry) => entry.entity === selectedRun.workItemId) ?? null : chooseWorkItem(items);
  const selectedSession = selectedRun ? null : chooseSession(projectId, item, sessions ?? []);
  let runCheckpoints: WorkflowCheckpointRead[] = [];
  try { runCheckpoints = selectedRun ? owners.workflow.listCheckpoints(projectId, selectedRun.workRunId) : []; } catch { runCheckpoints = []; }
  const validRuns = runs.filter((run) => !run.malformed && run.projectId === projectId);
  const allRunCheckpoints = validRuns.flatMap((run) => {
    try { return owners.workflow.listCheckpoints(projectId, run.workRunId); } catch { return []; }
  });
  const memory = rawMemory && typeof rawMemory === 'object' && !Array.isArray(rawMemory) ? rawMemory : {};
  const rawDecisions = Array.isArray(memory.reviewedDecisions) ? memory.reviewedDecisions : Array.isArray(memory.decisions) ? memory.decisions : Array.isArray(memory.claims) ? memory.claims : Array.isArray(memory.sections?.currentState?.claims) ? memory.sections.currentState.claims : [];
  const decisions = rawDecisions.filter((value): value is RecoveryDecisionRead => Boolean(value && typeof value === 'object' && !Array.isArray(value))).map(contextDecision).filter((value): value is NonNullable<typeof value> => value !== null).sort((left, right) => left.decisionId.localeCompare(right.decisionId));
  const caps = capabilityFacts(Array.isArray(capabilities) ? capabilities : []);
  const diagnostics: RecoveryFlowDiagnosticV2[] = [];
  if (items.length === 0) diagnostics.push(diagnostic('work-os', 'work_items_unavailable', 'error', 'No safe current Work Item is available for this Project.', 'Repair the Work-OS owner before opening recovery.'));
  if (rawItemList.length > items.length) diagnostics.push(diagnostic('work-os', 'unsafe_work_items_omitted', 'warning', 'One or more Work-OS items were omitted because their identity or content was unsafe.', 'Repair the Work-OS item and retry open.'));
  if (rawDecisions.length > decisions.length) diagnostics.push(diagnostic('project-memory', 'unsafe_memory_context_omitted', 'warning', 'One or more Project Memory decisions were omitted because their content was unsafe or unreviewed.', 'Review the Project Memory owner before relying on it.'));
  if (memory.freshness === 'unavailable') diagnostics.push(diagnostic('project-memory', 'memory_unavailable', 'warning', 'Project Memory is unavailable; reviewed decisions were omitted.', 'Repair or review Project Memory before relying on remembered decisions.'));
  for (const code of Array.isArray(memory.diagnostics) ? memory.diagnostics : []) diagnostics.push(diagnostic('project-memory', text(code, 'memory diagnostic', 128) || 'memory_diagnostic', 'warning', 'Project Memory reported a bounded diagnostic.', 'Inspect the Project Memory owner.'));
  const groupsPayload = groups(items);
  const contextSource = selectedRun ? 'work-run' : selectedSession ? 'session-record' : 'none';
  const stageText = text(item?.currentStage, 'current stage', 64);
  const currentStage = stageText ? { value: stageText, state: 'current', source: 'work-os', citationTargets: refs(item?.citationTargets) } : { value: null, state: 'unknown', source: null, citationTargets: refs(item?.citationTargets) };
  const suggestedQueries = [item?.label, ...(item?.blockedBy ?? [])].map((value) => text(value, 'suggested query', 2048)).filter(Boolean).slice(0, 3);
  const context = {
    workItemId: item?.entity ?? null,
    workRunId: selectedRun?.workRunId ?? null,
    decisions: decisions.slice(0, 32),
    checkpoints: runCheckpoints.slice(0, 32),
    prerequisites: (item?.blockedBy ?? []).slice(0, 16),
    citations: refs([
      ...(item?.citationTargets ?? []),
      ...(selectedSession?.citationTargets ?? []),
      ...decisions.flatMap((decision) => decision.citationTargets),
      ...runCheckpoints.flatMap((checkpoint) => checkpoint.citationTargets),
      ...caps.citations,
      ...(memory.citationTargets ?? []),
    ]).slice(0, 64),
  };
  const allCitations = context.citations;
  const payload: RecoveryOpenPayloadV2 = {
    kind: 'open', workItemId: item?.entity ?? null, workRunId: selectedRun?.workRunId ?? null, contextSource, citations: allCitations,
    currentStage, workGroups: groupsPayload, context, capabilities: caps.facts, suggestedQueries,
  };
  const mandatoryPayload: RecoveryOpenPayloadV2 = { ...payload, citations: [], context: { ...context, decisions: [], checkpoints: [], citations: [] } };
  if (utf8JsonBytes({ payload: mandatoryPayload, diagnostics, omitted: { items: 0, citations: 0, diagnostics: 0, bytes: 0 } }) > 64 * 1024) {
    return unavailable(projectId, generatedAt, OWNER_ORDER.map((owner) => lock(owner, owner === 'work-os' ? items : owner === 'workflow' ? selectedRun : caps.facts)), 'mandatory_context_too_large', 'Reduce mandatory Work-OS labels or repair the owner data before retrying recovery.', [diagnostic('work-os', 'mandatory_context_too_large', 'error', 'Mandatory Project recovery facts exceed the context byte bound.', 'Reduce the owning Work-OS payload and retry open.')], fingerprintRecoveryValue({ projectId, items: items.map((entry) => entry.entity) }));
  }
  const groupCount = Object.values(groupsPayload ?? {}).reduce((total, group) => total + group.length, 0);
  let omittedItems = Math.max(0, items.length - groupCount) + Math.max(0, decisions.length - context.decisions.length) + Math.max(0, runCheckpoints.length - context.checkpoints.length);
  let omittedCitations = Math.max(0, allCitations.length - context.citations.length);
  let omittedDiagnostics = 0;
  let omittedBytes = 0;
  const omitted = () => ({ items: omittedItems, citations: omittedCitations, diagnostics: omittedDiagnostics, bytes: omittedBytes });
  while (utf8JsonBytes({ payload, diagnostics, omitted: omitted() }) > 64 * 1024) {
    const before = utf8JsonBytes({ payload, diagnostics, omitted: omitted() });
    if (context.checkpoints.length > 0) { context.checkpoints.shift(); omittedItems += 1; }
    else if (context.decisions.length > 0) { context.decisions.pop(); omittedItems += 1; }
    else if (context.citations.length > 0) { context.citations.pop(); payload.citations = context.citations; omittedCitations += 1; }
    else if (context.prerequisites.length > 0) { context.prerequisites.pop(); omittedItems += 1; }
    else if (diagnostics.length > 0) { diagnostics.pop(); omittedDiagnostics += 1; }
    else return unavailable(projectId, generatedAt, OWNER_ORDER.map((owner) => lock(owner, null, 'unavailable')), 'mandatory_context_too_large', 'Reduce the recovery owner payload before retrying open.', [diagnostic('project', 'context_too_large', 'error', 'Recovery context cannot be safely bounded.', 'Reduce owner data and retry open.')], fingerprintRecoveryValue({ projectId }));
    omittedBytes += Math.max(0, before - utf8JsonBytes({ payload, diagnostics, omitted: omitted() }));
  }
  const ownerValues: Record<RecoveryOwner, unknown> = {
    project: { projectId },
    'work-os': items,
    workflow: { runs: validRuns, checkpoints: allRunCheckpoints },
    'project-memory': { revision: revision(memory.revision), fingerprint: memory.fingerprint ?? fingerprintRecoveryValue(decisions), freshness: memory.freshness ?? 'unknown' },
    'session-record': sessions,
    'source-evidence': null,
    'agent-domain': caps.facts,
    settings: caps.facts,
  };
  const ownerLocks = OWNER_ORDER.map((owner) => lock(owner, ownerValues[owner], owner === 'project-memory' && memory.freshness === 'unavailable' ? 'unavailable' : owner === 'project-memory' && memory.freshness === 'stale' ? 'stale' : 'current'));
  const recoveryFingerprint = fingerprintRecoveryValue({ projectId, workItems: items, resumable: selectedRun ? { workRunId: selectedRun.workRunId, workItemId: selectedRun.workItemId, state: selectedRun.state } : null, capabilities: caps.facts });
  const response = openResponse(projectId, generatedAt, payload, ownerLocks, recoveryFingerprint, diagnostics.slice(0, 32), omitted()) as RecoveryFlowResponseV2 & { stage: 'open' | 'unavailable' };
  // Keep the call-site proof explicit: derived search requests must agree with the hashed open response.
  deriveRecoveryFlowRequests(response);
  return response;
}
