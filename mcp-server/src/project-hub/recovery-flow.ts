import { isCanonicalWorkItemId, isCanonicalWorkRunId } from '../workflow/workflow.js';
import {
  assertClosedRecoveryObject,
  canonicalRecoveryJson,
  fingerprintRecoveryValue,
  safeRecoveryText,
  utf8JsonBytes,
  type RecoveryFingerprint,
} from './contract-support.js';

export const RECOVERY_FLOW_REQUEST_SCHEMA_VERSION = 'project-hub-recovery-flow-request/v2' as const;
export const RECOVERY_FLOW_SCHEMA_VERSION = 'project-hub-recovery-flow/v2' as const;
export const RECOVERY_STALE_PROOF_SCHEMA_VERSION = 'project-hub-recovery-stale-proof/v2' as const;
export const RECOVERY_PLAN_SCHEMA_VERSION = 'project-hub-recovery-plan/v2' as const;

export type RecoveryFlowAction = 'open' | 'search' | 'plan' | 'refresh-plan' | 'restart';
export type RecoveryFlowStage = 'open' | 'searched' | 'needs-agent-selection' | 'planned' | 'stale' | 'unavailable';
export type RecoveryOwner =
  | 'project'
  | 'work-os'
  | 'workflow'
  | 'project-memory'
  | 'session-record'
  | 'source-evidence'
  | 'agent-domain'
  | 'settings';

const PROJECT_ID = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const OWNER_ORDER: readonly RecoveryOwner[] = [
  'project',
  'work-os',
  'workflow',
  'project-memory',
  'session-record',
  'source-evidence',
  'agent-domain',
  'settings',
];
const OWNER_SET: Record<RecoveryOwner, true> = {
  project: true,
  'work-os': true,
  workflow: true,
  'project-memory': true,
  'session-record': true,
  'source-evidence': true,
  'agent-domain': true,
  settings: true,
};
const STAGE_SET: Record<RecoveryFlowStage, true> = {
  open: true,
  searched: true,
  'needs-agent-selection': true,
  planned: true,
  stale: true,
  unavailable: true,
};
const ACTION_SET: Record<RecoveryFlowAction, true> = {
  open: true,
  search: true,
  plan: true,
  'refresh-plan': true,
  restart: true,
};

export interface RecoveryOwnerLock {
  owner: RecoveryOwner;
  revision: string | number | null;
  fingerprint: RecoveryFingerprint | null;
  state: 'current' | 'stale' | 'unavailable';
}
export interface RecoveryAgentSelectionV2 {
  bindingId: string;
  bindingRevision: number;
}

export interface RecoveryPlanAgentSelectionV2 extends RecoveryAgentSelectionV2 {
  role: string;
  profileId: string;
  profileRevision: number;
}

export interface RecoveryCapabilityFactV2 {
  capability: string;
  state: 'available' | 'degraded';
}

export interface RecoveryPlanV2 {
  schemaVersion: typeof RECOVERY_PLAN_SCHEMA_VERSION;
  projectId: string;
  rootOpenFlowFingerprint: RecoveryFingerprint;
  searchedBasisFlowFingerprint: RecoveryFingerprint;
  recoveryFingerprint: RecoveryFingerprint;
  searchInputFingerprint: RecoveryFingerprint;
  searchFingerprint: RecoveryFingerprint;
  candidateSetFingerprint: RecoveryFingerprint;
  candidateId: string;
  kind: 'resume' | 'create';
  workItemId: string;
  workRunId: string | null;
  agentSelection: RecoveryPlanAgentSelectionV2;
  ownerLocks: RecoveryOwnerLock[];
  capabilityFacts: RecoveryCapabilityFactV2[];
  citationTargets: string[];
  owningOperation: 'workflow.recovery.apply';
  createdAt: string;
  expiresAt: string;
  leaseDurationMs: 0 | 900000;
  fingerprint: RecoveryFingerprint;
}

export interface RecoveryStaleProofV2 {
  schemaVersion: typeof RECOVERY_STALE_PROOF_SCHEMA_VERSION;
  projectId: string;
  rootOpenFlowFingerprint: RecoveryFingerprint;
  priorFlowFingerprint: RecoveryFingerprint;
  priorActionInputFingerprint: RecoveryFingerprint;
  recoveryFingerprint: RecoveryFingerprint;
  changedOwners: RecoveryOwner[];
  citationTargets: string[];
  fingerprint: RecoveryFingerprint;
}

export interface RecoveryOpenRequestV2 {
  schemaVersion: typeof RECOVERY_FLOW_REQUEST_SCHEMA_VERSION;
  projectId: string;
  action: 'open';
}
export interface RecoverySearchRequestV2 {
  schemaVersion: typeof RECOVERY_FLOW_REQUEST_SCHEMA_VERSION;
  projectId: string;
  action: 'search';
  openFlowFingerprint: RecoveryFingerprint;
  query: string;
  limit: number;
}
export interface RecoveryPlanFromSearchRequestV2 {
  schemaVersion: typeof RECOVERY_FLOW_REQUEST_SCHEMA_VERSION;
  projectId: string;
  action: 'plan';
  mode: 'from-search';
  openFlowFingerprint: RecoveryFingerprint;
  searchedBasisFlowFingerprint: RecoveryFingerprint;
  plannedFlowFingerprint: null;
  query: string;
  limit: number;
  candidateId: string;
  agentSelection: RecoveryAgentSelectionV2;
  priorPlan: null;
}
export interface RecoveryPlanOverrideRequestV2 {
  schemaVersion: typeof RECOVERY_FLOW_REQUEST_SCHEMA_VERSION;
  projectId: string;
  action: 'plan';
  mode: 'override';
  openFlowFingerprint: RecoveryFingerprint;
  searchedBasisFlowFingerprint: RecoveryFingerprint;
  plannedFlowFingerprint: RecoveryFingerprint;
  query: string;
  limit: number;
  candidateId: string;
  agentSelection: RecoveryAgentSelectionV2;
  priorPlan: RecoveryPlanV2;
}
export interface RecoveryRefreshPlanRequestV2 {
  schemaVersion: typeof RECOVERY_FLOW_REQUEST_SCHEMA_VERSION;
  projectId: string;
  action: 'refresh-plan';
  openFlowFingerprint: RecoveryFingerprint;
  searchedBasisFlowFingerprint: RecoveryFingerprint;
  plannedFlowFingerprint: RecoveryFingerprint;
  query: string;
  limit: number;
  priorPlan: RecoveryPlanV2;
}
export interface RecoveryRestartRequestV2 {
  schemaVersion: typeof RECOVERY_FLOW_REQUEST_SCHEMA_VERSION;
  projectId: string;
  action: 'restart';
  staleProof: RecoveryStaleProofV2;
}
export type RecoveryFlowRequestV2 =
  | RecoveryOpenRequestV2
  | RecoverySearchRequestV2
  | RecoveryPlanFromSearchRequestV2
  | RecoveryPlanOverrideRequestV2
  | RecoveryRefreshPlanRequestV2
  | RecoveryRestartRequestV2;

export interface RecoveryOpenPayloadV2 {
  kind: 'open';
  workItemId: string | null;
  workRunId: string | null;
  contextSource: 'work-run' | 'session-record' | 'none';
  citations: string[];
  currentStage?: { value: string | null; state: string; source: string | null; citationTargets: string[] };
  workGroups?: {
    done: RecoveryOpenWorkItemV2[];
    inProgress: RecoveryOpenWorkItemV2[];
    blocked: RecoveryOpenWorkItemV2[];
    notStarted: RecoveryOpenWorkItemV2[];
  };
  context?: RecoveryOpenContextV2;
  capabilities?: RecoveryOpenCapabilityV2[];
  suggestedQueries?: string[];
}
export interface RecoveryOpenWorkItemV2 {
  entity: string;
  label: string;
  state: string;
  blockedBy: string[];
  citationTargets: string[];
}
export interface RecoveryOpenContextV2 {
  workItemId: string | null;
  workRunId: string | null;
  decisions: Array<{ decisionId: string; text: string; citationTargets: string[] }>;
  checkpoints: Array<{ checkpointId: string; stage: string; status: string; summary: string; recordedAt: string; citationTargets: string[] }>;
  prerequisites: string[];
  citations: string[];
}
export interface RecoveryOpenCapabilityV2 {
  capability: string;
  state: 'available' | 'degraded';
}
export interface RecoverySearchResultV2 {
  itemId: string;
  itemType: string;
  label: string;
  projectId: string;
  owner: RecoveryOwner;
  matchClass: string;
  score: number;
  freshness: string;
  confidence: string;
  provenance: string;
  citationTargets: string[];
}
export interface RecoverySearchedPayloadV2 {
  kind: 'searched';
  query: string;
  limit: number;
  searchInputFingerprint: RecoveryFingerprint;
  searchFingerprint: RecoveryFingerprint;
  results: RecoverySearchResultV2[];
}
export interface RecoveryNeedsAgentSelectionPayloadV2 {
  kind: 'needs-agent-selection';
  candidates: string[];
  bindings: RecoveryAgentSelectionV2[];
}
export interface RecoveryPlannedPayloadV2 {
  kind: 'planned';
  plan: RecoveryPlanV2;
  candidates: string[];
}
export interface RecoveryUnavailablePayloadV2 {
  kind: 'unavailable';
  reason: string;
  remediation: string;
}
export type RecoveryFlowPayloadV2 =
  | RecoveryOpenPayloadV2
  | RecoverySearchedPayloadV2
  | RecoveryNeedsAgentSelectionPayloadV2
  | RecoveryPlannedPayloadV2
  | RecoveryStaleProofV2
  | RecoveryUnavailablePayloadV2;

export interface RecoverySearchRequestIntentV2 {
  action: 'search';
  query: string;
  limit: number;
}
export interface RecoveryPlanRequestIntentV2 {
  action: 'plan';
  mode: 'from-search' | 'override';
  query: string;
  limit: number;
  candidateId: string;
  agentSelection: RecoveryAgentSelectionV2;
  priorPlan: RecoveryPlanV2 | null;
}
export interface RecoveryRefreshRequestIntentV2 {
  action: 'refresh-plan';
  query: string;
  limit: number;
  priorPlan: RecoveryPlanV2;
}
export interface RecoveryRestartRequestIntentV2 {
  action: 'restart';
  staleProof: RecoveryStaleProofV2;
}
export type RecoveryFlowRequestIntentV2 =
  | RecoverySearchRequestIntentV2
  | RecoveryPlanRequestIntentV2
  | RecoveryRefreshRequestIntentV2
  | RecoveryRestartRequestIntentV2;

export interface RecoveryFlowDiagnosticV2 {
  owner: RecoveryOwner;
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  remediation: string;
  citationTargets: string[];
}
export interface RecoveryOmittedV2 {
  items: number;
  citations: number;
  diagnostics: number;
  bytes: number;
}
export interface RecoveryFlowIntrinsicProjectionV2 {
  schemaVersion: typeof RECOVERY_FLOW_SCHEMA_VERSION;
  stage: RecoveryFlowStage;
  projectId: string;
  previousFlowFingerprint: RecoveryFingerprint | null;
  actionInputFingerprint: RecoveryFingerprint;
  recoveryFingerprint: RecoveryFingerprint;
  ownerLocks: RecoveryOwnerLock[];
  payloadFingerprint: RecoveryFingerprint;
  nextRequestIntents: RecoveryFlowRequestIntentV2[];
  diagnostics: RecoveryFlowDiagnosticV2[];
  omitted: RecoveryOmittedV2;
}

export interface RecoveryFlowResponseBaseV2<
  S extends RecoveryFlowStage,
  P,
  I extends RecoveryFlowRequestIntentV2,
  R extends RecoveryFlowRequestV2,
> {
  schemaVersion: typeof RECOVERY_FLOW_SCHEMA_VERSION;
  stage: S;
  projectId: string;
  previousFlowFingerprint: RecoveryFingerprint | null;
  actionInputFingerprint: RecoveryFingerprint;
  recoveryFingerprint: RecoveryFingerprint;
  ownerLocks: RecoveryOwnerLock[];
  payload: P;
  nextRequestIntents: I[];
  diagnostics: RecoveryFlowDiagnosticV2[];
  omitted: RecoveryOmittedV2;
  rootOpenFlowFingerprint: RecoveryFingerprint;
  nextRequests: R[];
  generatedAt: string;
  flowFingerprint: RecoveryFingerprint;
}
export type RecoveryOpenResponseV2 = RecoveryFlowResponseBaseV2<'open', RecoveryOpenPayloadV2, RecoverySearchRequestIntentV2, RecoverySearchRequestV2>;
export type RecoverySearchedResponseV2 = RecoveryFlowResponseBaseV2<'searched', RecoverySearchedPayloadV2, RecoveryPlanRequestIntentV2, RecoveryPlanFromSearchRequestV2>;
export type RecoveryNeedsAgentSelectionResponseV2 = RecoveryFlowResponseBaseV2<'needs-agent-selection', RecoveryNeedsAgentSelectionPayloadV2, never, never>;
export type RecoveryPlannedResponseV2 = RecoveryFlowResponseBaseV2<'planned', RecoveryPlannedPayloadV2, RecoveryPlanRequestIntentV2 | RecoveryRefreshRequestIntentV2, RecoveryPlanOverrideRequestV2 | RecoveryRefreshPlanRequestV2>;
export type RecoveryStaleResponseV2 = RecoveryFlowResponseBaseV2<'stale', RecoveryStaleProofV2, RecoveryRestartRequestIntentV2, RecoveryRestartRequestV2>;
export type RecoveryUnavailableResponseV2 = RecoveryFlowResponseBaseV2<'unavailable', RecoveryUnavailablePayloadV2, never, never>;
export type RecoveryFlowResponseV2 =
  | RecoveryOpenResponseV2
  | RecoverySearchedResponseV2
  | RecoveryNeedsAgentSelectionResponseV2
  | RecoveryPlannedResponseV2
  | RecoveryStaleResponseV2
  | RecoveryUnavailableResponseV2;

function fail(label: string, message: string): never {
  throw new Error(`${label} ${message}`);
}
function object(value: unknown, label: string, requiredKeys: readonly string[]): Record<string, unknown> {
  return assertClosedRecoveryObject(value, requiredKeys, label);
}
function optionalObject(value: unknown, label: string, allowedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(label, 'must be an object');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!allowedKeys.includes(key)) fail(`${label}.${key}`, 'is an unknown field and is not supported');
  return record;
}
function fingerprint(value: unknown, label: string): RecoveryFingerprint {
  if (typeof value !== 'string' || !FINGERPRINT.test(value)) fail(label, 'must be a sha256 fingerprint');
  return value as RecoveryFingerprint;
}
function projectId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !PROJECT_ID.test(value)) fail(label, 'must be a canonical Project ID');
  return value;
}
function boundedId(value: unknown, label: string, maxBytes = 256): string {
  return safeRecoveryText(value, label, { minBytes: 1, maxBytes });
}
function list<T>(value: unknown, label: string, max: number, validate: (item: unknown, itemLabel: string) => T): T[] {
  if (!Array.isArray(value)) fail(label, 'must be an array');
  if (value.length > max) fail(label, `must contain at most ${max} items`);
  return value.map((item, index) => validate(item, `${label}[${index}]`));
}
function nullableFingerprint(value: unknown, label: string): RecoveryFingerprint | null {
  return value === null ? null : fingerprint(value, label);
}
function validateRevision(value: unknown, label: string): string | number {
  if (typeof value === 'string') return safeRecoveryText(value, label, { minBytes: 1, maxBytes: 256 });
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(label, 'must be a safe integer or bounded string');
  return value;
}
function validateWorkItemId(value: unknown, label: string, project: string): string {
  if (!isCanonicalWorkItemId(value) || !value.startsWith(`${project}/issue/`)) fail(label, 'must be a canonical Work Item for the request Project');
  return value;
}
function validateWorkRunId(value: unknown, label: string): string {
  if (!isCanonicalWorkRunId(value)) fail(label, 'must be a canonical Work Run ID');
  return value;
}
function validateOwner(value: unknown, label: string): RecoveryOwner {
  if (typeof value !== 'string' || OWNER_SET[value as RecoveryOwner] !== true) fail(label, 'has an invalid owner');
  return value as RecoveryOwner;
}
function validateOwnerLocks(value: unknown, label: string): RecoveryOwnerLock[] {
  const locks = list(value, label, OWNER_ORDER.length, (item, itemLabel) => {
    const entry = object(item, itemLabel, ['owner', 'revision', 'fingerprint', 'state']);
    const owner = validateOwner(entry.owner, `${itemLabel}.owner`);
    const state = entry.state;
    if (state !== 'current' && state !== 'stale' && state !== 'unavailable') fail(`${itemLabel}.state`, 'has an invalid state');
    return {
      owner,
      revision: entry.revision === null ? null : validateRevision(entry.revision, `${itemLabel}.revision`),
      fingerprint: nullableFingerprint(entry.fingerprint, `${itemLabel}.fingerprint`),
      state,
    } as RecoveryOwnerLock;
  });
  let previousOwnerIndex = -1;
  for (const lock of locks) {
    const ownerIndex = OWNER_ORDER.indexOf(lock.owner);
    if (ownerIndex <= previousOwnerIndex) fail(label, 'must use canonical owner-lock order without duplicates');
    previousOwnerIndex = ownerIndex;
  }
  return locks;
}
function validateAgentSelection(value: unknown, label: string): RecoveryAgentSelectionV2 {
  const entry = object(value, label, ['bindingId', 'bindingRevision']);
  if (typeof entry.bindingRevision !== 'number' || !Number.isSafeInteger(entry.bindingRevision) || entry.bindingRevision < 1) {
    fail(`${label}.bindingRevision`, 'must be a positive safe integer');
  }
  return { bindingId: boundedId(entry.bindingId, `${label}.bindingId`), bindingRevision: entry.bindingRevision };
}
function validatePlanAgentSelection(value: unknown, label: string): RecoveryPlanAgentSelectionV2 {
  const entry = object(value, label, ['role', 'bindingId', 'bindingRevision', 'profileId', 'profileRevision']);
  if (typeof entry.bindingRevision !== 'number' || !Number.isSafeInteger(entry.bindingRevision) || entry.bindingRevision < 1) {
    fail(`${label}.bindingRevision`, 'must be a positive safe integer');
  }
  if (typeof entry.profileRevision !== 'number' || !Number.isSafeInteger(entry.profileRevision) || entry.profileRevision < 1) {
    fail(`${label}.profileRevision`, 'must be a positive safe integer');
  }
  return {
    role: boundedId(entry.role, `${label}.role`),
    bindingId: boundedId(entry.bindingId, `${label}.bindingId`),
    bindingRevision: entry.bindingRevision,
    profileId: boundedId(entry.profileId, `${label}.profileId`),
    profileRevision: entry.profileRevision,
  };
}
function validateQuery(value: unknown, label: string): string {
  return safeRecoveryText(value, label, { minBytes: 1, maxBytes: 2048 });
}
function validateLimit(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 25) fail(label, 'must be an integer from 1 through 25');
  return value;
}
function validateTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) fail(label, 'must be an ISO-8601 UTC timestamp');
  return value;
}
function validateCitations(value: unknown, label: string, max = 64, min = 0): string[] {
  const citations = list(value, label, max, (item, itemLabel) => boundedId(item, itemLabel, 512));
  if (citations.length < min) fail(label, `must contain at least ${min} item${min === 1 ? '' : 's'}`);
  return citations;
}
function validateStaleProof(value: unknown, label: string): RecoveryStaleProofV2 {
  const entry = object(value, label, ['schemaVersion', 'projectId', 'rootOpenFlowFingerprint', 'priorFlowFingerprint', 'priorActionInputFingerprint', 'recoveryFingerprint', 'changedOwners', 'citationTargets', 'fingerprint']);
  if (entry.schemaVersion !== RECOVERY_STALE_PROOF_SCHEMA_VERSION) fail(`${label}.schemaVersion`, 'has an invalid schema version');
  const changedOwners = list(entry.changedOwners, `${label}.changedOwners`, OWNER_ORDER.length, validateOwner);
  if (changedOwners.length < 1) fail(`${label}.changedOwners`, 'must contain at least one owner');
  let previousOwnerIndex = -1;
  for (const owner of changedOwners) {
    const ownerIndex = OWNER_ORDER.indexOf(owner);
    if (ownerIndex <= previousOwnerIndex) fail(`${label}.changedOwners`, 'must use canonical owner order without duplicates');
    previousOwnerIndex = ownerIndex;
  }
  const proof = {
    schemaVersion: RECOVERY_STALE_PROOF_SCHEMA_VERSION,
    projectId: projectId(entry.projectId, `${label}.projectId`),
    rootOpenFlowFingerprint: fingerprint(entry.rootOpenFlowFingerprint, `${label}.rootOpenFlowFingerprint`),
    priorFlowFingerprint: fingerprint(entry.priorFlowFingerprint, `${label}.priorFlowFingerprint`),
    priorActionInputFingerprint: fingerprint(entry.priorActionInputFingerprint, `${label}.priorActionInputFingerprint`),
    recoveryFingerprint: fingerprint(entry.recoveryFingerprint, `${label}.recoveryFingerprint`),
    changedOwners,
    citationTargets: validateCitations(entry.citationTargets, `${label}.citationTargets`, 32),
    fingerprint: fingerprint(entry.fingerprint, `${label}.fingerprint`),
  };
  const { fingerprint: _fingerprint, ...proofWithoutFingerprint } = proof;
  if (fingerprintRecoveryValue(proofWithoutFingerprint) !== proof.fingerprint) fail(label, 'fingerprint does not match');
  return proof;
}
function validateCapabilityFacts(value: unknown, label: string): RecoveryCapabilityFactV2[] {
  return list(value, label, 16, (item, itemLabel) => {
    const entry = object(item, itemLabel, ['capability', 'state']);
    if (entry.state !== 'available' && entry.state !== 'degraded') fail(`${itemLabel}.state`, 'has an invalid state');
    return { capability: boundedId(entry.capability, `${itemLabel}.capability`), state: entry.state };
  });
}
export function validateRecoveryPlanV2(value: unknown): RecoveryPlanV2 {
  const entry = object(value, 'priorPlan', ['schemaVersion', 'projectId', 'rootOpenFlowFingerprint', 'searchedBasisFlowFingerprint', 'recoveryFingerprint', 'searchInputFingerprint', 'searchFingerprint', 'candidateSetFingerprint', 'candidateId', 'kind', 'workItemId', 'workRunId', 'agentSelection', 'ownerLocks', 'capabilityFacts', 'citationTargets', 'owningOperation', 'createdAt', 'expiresAt', 'leaseDurationMs', 'fingerprint']);
  if (entry.schemaVersion !== RECOVERY_PLAN_SCHEMA_VERSION) fail('priorPlan.schemaVersion', 'has an invalid schema version');
  if (entry.kind !== 'resume' && entry.kind !== 'create') fail('priorPlan.kind', 'has an invalid kind');
  if (entry.owningOperation !== 'workflow.recovery.apply') fail('priorPlan.owningOperation', 'must be workflow.recovery.apply');
  const planProjectId = projectId(entry.projectId, 'priorPlan.projectId');
  if (entry.kind === 'resume' && entry.workRunId === null) fail('priorPlan.workRunId', 'is required for resume plans');
  if (entry.kind === 'create' && entry.workRunId !== null) fail('priorPlan.workRunId', 'must be null for create plans');
  if (entry.workRunId !== null) validateWorkRunId(entry.workRunId, 'priorPlan.workRunId');
  if ((entry.kind === 'resume' && entry.leaseDurationMs !== 0) || (entry.kind === 'create' && entry.leaseDurationMs !== 900000)) {
    fail('priorPlan.leaseDurationMs', 'must be 0 for resume or 900000 for create');
  }
  const createdAt = validateTimestamp(entry.createdAt, 'priorPlan.createdAt');
  const expiresAt = validateTimestamp(entry.expiresAt, 'priorPlan.expiresAt');
  if (Date.parse(expiresAt) - Date.parse(createdAt) !== 300000) fail('priorPlan.expiresAt', 'must be exactly five minutes after createdAt');
  const plan = {
    schemaVersion: RECOVERY_PLAN_SCHEMA_VERSION,
    projectId: planProjectId,
    rootOpenFlowFingerprint: fingerprint(entry.rootOpenFlowFingerprint, 'priorPlan.rootOpenFlowFingerprint'),
    searchedBasisFlowFingerprint: fingerprint(entry.searchedBasisFlowFingerprint, 'priorPlan.searchedBasisFlowFingerprint'),
    recoveryFingerprint: fingerprint(entry.recoveryFingerprint, 'priorPlan.recoveryFingerprint'),
    searchInputFingerprint: fingerprint(entry.searchInputFingerprint, 'priorPlan.searchInputFingerprint'),
    searchFingerprint: fingerprint(entry.searchFingerprint, 'priorPlan.searchFingerprint'),
    candidateSetFingerprint: fingerprint(entry.candidateSetFingerprint, 'priorPlan.candidateSetFingerprint'),
    candidateId: boundedId(entry.candidateId, 'priorPlan.candidateId'),
    kind: entry.kind,
    workItemId: validateWorkItemId(entry.workItemId, 'priorPlan.workItemId', planProjectId),
    workRunId: entry.workRunId === null ? null : validateWorkRunId(entry.workRunId, 'priorPlan.workRunId'),
    agentSelection: validatePlanAgentSelection(entry.agentSelection, 'priorPlan.agentSelection'),
    ownerLocks: validateOwnerLocks(entry.ownerLocks, 'priorPlan.ownerLocks'),
    capabilityFacts: validateCapabilityFacts(entry.capabilityFacts, 'priorPlan.capabilityFacts'),
    citationTargets: validateCitations(entry.citationTargets, 'priorPlan.citationTargets', 32, 1),
    owningOperation: entry.owningOperation,
    createdAt,
    expiresAt,
    leaseDurationMs: entry.leaseDurationMs,
    fingerprint: fingerprint(entry.fingerprint, 'priorPlan.fingerprint'),
  } as RecoveryPlanV2;
  const { fingerprint: _fingerprint, ...planWithoutFingerprint } = plan;
  if (fingerprintRecoveryValue(planWithoutFingerprint) !== plan.fingerprint) fail('priorPlan', 'fingerprint does not match');
  return plan;
}
function validateIntent(value: unknown, label: string): RecoveryFlowRequestIntentV2 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(label, 'must be an object');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key.toLowerCase().includes('fingerprint'))) fail(label, 'must not contain fingerprints');
  if (raw.action === 'search') {
    const entry = object(value, label, ['action', 'query', 'limit']);
    return { action: 'search', query: validateQuery(entry.query, `${label}.query`), limit: validateLimit(entry.limit, `${label}.limit`) };
  }
  if (raw.action === 'plan') {
    const entry = object(value, label, ['action', 'mode', 'query', 'limit', 'candidateId', 'agentSelection', 'priorPlan']);
    if (entry.mode !== 'from-search' && entry.mode !== 'override') fail(`${label}.mode`, 'has an invalid mode');
    const priorPlan = entry.priorPlan === null ? null : validateRecoveryPlanV2(entry.priorPlan);
    if (entry.mode === 'from-search' && priorPlan !== null) fail(`${label}.priorPlan`, 'must be null for from-search');
    if (entry.mode === 'override' && priorPlan === null) fail(`${label}.priorPlan`, 'is required for override');
    return {
      action: 'plan',
      mode: entry.mode,
      query: validateQuery(entry.query, `${label}.query`),
      limit: validateLimit(entry.limit, `${label}.limit`),
      candidateId: boundedId(entry.candidateId, `${label}.candidateId`),
      agentSelection: validateAgentSelection(entry.agentSelection, `${label}.agentSelection`),
      priorPlan,
    };
  }
  if (raw.action === 'refresh-plan') {
    const entry = object(value, label, ['action', 'query', 'limit', 'priorPlan']);
    return { action: 'refresh-plan', query: validateQuery(entry.query, `${label}.query`), limit: validateLimit(entry.limit, `${label}.limit`), priorPlan: validateRecoveryPlanV2(entry.priorPlan) };
  }
  if (raw.action === 'restart') {
    const entry = object(value, label, ['action', 'staleProof']);
    return { action: 'restart', staleProof: validateStaleProof(entry.staleProof, `${label}.staleProof`) };
  }
  fail(label, 'has an invalid action');
}
function validateCommon(entry: Record<string, unknown>, label: string): string {
  if (entry.schemaVersion !== RECOVERY_FLOW_REQUEST_SCHEMA_VERSION) fail(`${label}.schemaVersion`, 'has an invalid schema version');
  return projectId(entry.projectId, `${label}.projectId`);
}
export function validateRecoveryFlowRequestV2(value: unknown): RecoveryFlowRequestV2 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('Recovery Flow request', 'must be an object');
  const raw = value as Record<string, unknown>;
  const project = validateCommon(raw, 'Recovery Flow request');
  if (typeof raw.action !== 'string' || ACTION_SET[raw.action as RecoveryFlowAction] !== true) fail('Recovery Flow request.action', 'has an invalid action');
  const schemaVersion = RECOVERY_FLOW_REQUEST_SCHEMA_VERSION;
  if (raw.action === 'open') {
    object(value, 'Recovery Flow open request', ['schemaVersion', 'projectId', 'action']);
    return { schemaVersion, projectId: project, action: 'open' };
  }
  if (raw.action === 'search') {
    const entry = object(value, 'Recovery Flow search request', ['schemaVersion', 'projectId', 'action', 'openFlowFingerprint', 'query', 'limit']);
    return { schemaVersion, projectId: project, action: 'search', openFlowFingerprint: fingerprint(entry.openFlowFingerprint, 'openFlowFingerprint'), query: validateQuery(entry.query, 'query'), limit: validateLimit(entry.limit, 'limit') };
  }
  if (raw.action === 'plan') {
    const entry = object(value, 'Recovery Flow plan request', ['schemaVersion', 'projectId', 'action', 'mode', 'openFlowFingerprint', 'searchedBasisFlowFingerprint', 'plannedFlowFingerprint', 'query', 'limit', 'candidateId', 'agentSelection', 'priorPlan']);
    if (entry.mode !== 'from-search' && entry.mode !== 'override') fail('mode', 'has an invalid mode');
    const plannedFlowFingerprint = entry.plannedFlowFingerprint === null ? null : fingerprint(entry.plannedFlowFingerprint, 'plannedFlowFingerprint');
    const priorPlan = entry.priorPlan === null ? null : validateRecoveryPlanV2(entry.priorPlan);
    if ((entry.mode === 'from-search') !== (plannedFlowFingerprint === null) || (entry.mode === 'from-search') !== (priorPlan === null)) fail('Recovery Flow plan request', 'mode and nullable fields do not match');
    const plan = {
      schemaVersion,
      projectId: project,
      action: 'plan' as const,
      mode: entry.mode,
      openFlowFingerprint: fingerprint(entry.openFlowFingerprint, 'openFlowFingerprint'),
      searchedBasisFlowFingerprint: fingerprint(entry.searchedBasisFlowFingerprint, 'searchedBasisFlowFingerprint'),
      plannedFlowFingerprint,
      query: validateQuery(entry.query, 'query'),
      limit: validateLimit(entry.limit, 'limit'),
      candidateId: boundedId(entry.candidateId, 'candidateId'),
      agentSelection: validateAgentSelection(entry.agentSelection, 'agentSelection'),
      priorPlan,
    };
    if (priorPlan !== null && priorPlan.projectId !== plan.projectId) fail('priorPlan.projectId', 'must match request projectId');
    if (entry.mode === 'override' && priorPlan !== null) {
      if (plan.openFlowFingerprint !== priorPlan.rootOpenFlowFingerprint) fail('openFlowFingerprint', 'must match priorPlan.rootOpenFlowFingerprint');
      if (plan.searchedBasisFlowFingerprint !== priorPlan.searchedBasisFlowFingerprint) fail('searchedBasisFlowFingerprint', 'must match priorPlan.searchedBasisFlowFingerprint');
    }
    return plan as RecoveryPlanFromSearchRequestV2 | RecoveryPlanOverrideRequestV2;
  }
  if (raw.action === 'refresh-plan') {
    const entry = object(value, 'Recovery Flow refresh-plan request', ['schemaVersion', 'projectId', 'action', 'openFlowFingerprint', 'searchedBasisFlowFingerprint', 'plannedFlowFingerprint', 'query', 'limit', 'priorPlan']);
    const priorPlan = validateRecoveryPlanV2(entry.priorPlan);
    if (priorPlan.projectId !== project) fail('priorPlan.projectId', 'must match request projectId');
    const openFlowFingerprint = fingerprint(entry.openFlowFingerprint, 'openFlowFingerprint');
    const searchedBasisFlowFingerprint = fingerprint(entry.searchedBasisFlowFingerprint, 'searchedBasisFlowFingerprint');
    if (openFlowFingerprint !== priorPlan.rootOpenFlowFingerprint) fail('openFlowFingerprint', 'must match priorPlan.rootOpenFlowFingerprint');
    if (searchedBasisFlowFingerprint !== priorPlan.searchedBasisFlowFingerprint) fail('searchedBasisFlowFingerprint', 'must match priorPlan.searchedBasisFlowFingerprint');
    return { schemaVersion, projectId: project, action: 'refresh-plan', openFlowFingerprint, searchedBasisFlowFingerprint, plannedFlowFingerprint: fingerprint(entry.plannedFlowFingerprint, 'plannedFlowFingerprint'), query: validateQuery(entry.query, 'query'), limit: validateLimit(entry.limit, 'limit'), priorPlan };
  }
  const entry = object(value, 'Recovery Flow restart request', ['schemaVersion', 'projectId', 'action', 'staleProof']);
  const staleProof = validateStaleProof(entry.staleProof, 'staleProof');
  if (staleProof.projectId !== project) fail('staleProof.projectId', 'must match request projectId');
  return { schemaVersion, projectId: project, action: 'restart', staleProof };
}
function validateDiagnostic(value: unknown, label: string): RecoveryFlowDiagnosticV2 {
  const entry = object(value, label, ['owner', 'code', 'severity', 'message', 'remediation', 'citationTargets']);
  if (entry.severity !== 'info' && entry.severity !== 'warning' && entry.severity !== 'error') fail(`${label}.severity`, 'has an invalid severity');
  return {
    owner: validateOwner(entry.owner, `${label}.owner`),
    code: boundedId(entry.code, `${label}.code`, 128),
    severity: entry.severity,
    message: boundedId(entry.message, `${label}.message`, 1024),
    remediation: boundedId(entry.remediation, `${label}.remediation`, 1024),
    citationTargets: validateCitations(entry.citationTargets, `${label}.citationTargets`, 8),
  };
}
function validateOmitted(value: unknown, label: string): RecoveryOmittedV2 {
  const entry = object(value, label, ['items', 'citations', 'diagnostics', 'bytes']);
  for (const key of ['items', 'citations', 'diagnostics', 'bytes']) {
    if (typeof entry[key] !== 'number' || !Number.isInteger(entry[key]) || entry[key] < 0) fail(`${label}.${key}`, 'must be a non-negative integer');
  }
  return entry as unknown as RecoveryOmittedV2;
}
function validateSearchResult(value: unknown, label: string, expectedProjectId: string): RecoverySearchResultV2 {
  const entry = object(value, label, ['itemId', 'itemType', 'label', 'projectId', 'owner', 'matchClass', 'score', 'freshness', 'confidence', 'provenance', 'citationTargets']);
  const result = {
    itemId: boundedId(entry.itemId, `${label}.itemId`),
    itemType: boundedId(entry.itemType, `${label}.itemType`, 64),
    label: boundedId(entry.label, `${label}.label`, 512),
    projectId: projectId(entry.projectId, `${label}.projectId`),
    owner: validateOwner(entry.owner, `${label}.owner`),
    matchClass: boundedId(entry.matchClass, `${label}.matchClass`, 64),
    score: entry.score,
    freshness: boundedId(entry.freshness, `${label}.freshness`, 64),
    confidence: boundedId(entry.confidence, `${label}.confidence`, 64),
    provenance: boundedId(entry.provenance, `${label}.provenance`, 512),
    citationTargets: validateCitations(entry.citationTargets, `${label}.citationTargets`, 4, 1),
  };
  if (result.projectId !== expectedProjectId) fail(`${label}.projectId`, 'must match response projectId');
  if (typeof result.score !== 'number' || !Number.isInteger(result.score) || result.score < 0) fail(`${label}.score`, 'must be a non-negative integer');
  if (utf8JsonBytes(result) > 4096) fail(label, 'must not exceed 4096 canonical JSON bytes');
  return result as RecoverySearchResultV2;
}
function validatePayload(stage: RecoveryFlowStage, value: unknown, project: string): RecoveryFlowPayloadV2 {
  if (stage === 'stale') return validateStaleProof(value, 'payload');
  if (stage === 'open') {
    const entry = optionalObject(value, 'payload', ['kind', 'workItemId', 'workRunId', 'contextSource', 'citations', 'currentStage', 'workGroups', 'context', 'capabilities', 'suggestedQueries']);
    for (const key of ['kind', 'workItemId', 'workRunId', 'contextSource', 'citations']) if (!(key in entry)) fail(`payload.${key}`, 'is required');
    if (entry.kind !== 'open') fail('payload.kind', 'does not match stage');
    if (entry.contextSource !== 'work-run' && entry.contextSource !== 'session-record' && entry.contextSource !== 'none') fail('payload.contextSource', 'has an invalid source');
    const workItemId = entry.workItemId === null ? null : validateWorkItemId(entry.workItemId, 'payload.workItemId', project);
    const workRunId = entry.workRunId === null ? null : validateWorkRunId(entry.workRunId, 'payload.workRunId');
    if (entry.contextSource === 'work-run' && workRunId === null) fail('payload.workRunId', 'is required for work-run context');
    if (entry.contextSource !== 'work-run' && workRunId !== null) fail('payload.workRunId', 'must be null for session-record or empty context');
    const currentStage = entry.currentStage === undefined ? undefined : (() => {
      const stageValue = object(entry.currentStage, 'payload.currentStage', ['value', 'state', 'source', 'citationTargets']);
      return {
        value: stageValue.value === null ? null : boundedId(stageValue.value, 'payload.currentStage.value'),
        state: boundedId(stageValue.state, 'payload.currentStage.state', 32),
        source: stageValue.source === null ? null : boundedId(stageValue.source, 'payload.currentStage.source'),
        citationTargets: validateCitations(stageValue.citationTargets, 'payload.currentStage.citationTargets', 64),
      };
    })();
    const workGroups = entry.workGroups === undefined ? undefined : (() => {
      const groups = object(entry.workGroups, 'payload.workGroups', ['done', 'inProgress', 'blocked', 'notStarted']);
      const parseItems = (key: string) => list(groups[key], `payload.workGroups.${key}`, 128, (raw, itemLabel) => {
        const item = object(raw, itemLabel, ['entity', 'label', 'state', 'blockedBy', 'citationTargets']);
        return {
          entity: validateWorkItemId(item.entity, `${itemLabel}.entity`, project),
          label: boundedId(item.label, `${itemLabel}.label`),
          state: boundedId(item.state, `${itemLabel}.state`, 32),
          blockedBy: list(item.blockedBy, `${itemLabel}.blockedBy`, 128, (ref, refLabel) => validateWorkItemId(ref, refLabel, project)),
          citationTargets: validateCitations(item.citationTargets, `${itemLabel}.citationTargets`, 64),
        };
      });
      return { done: parseItems('done'), inProgress: parseItems('inProgress'), blocked: parseItems('blocked'), notStarted: parseItems('notStarted') };
    })();
    const context = entry.context === undefined ? undefined : (() => {
      const rawContext = object(entry.context, 'payload.context', ['workItemId', 'workRunId', 'decisions', 'checkpoints', 'prerequisites', 'citations']);
      const contextWorkItemId = rawContext.workItemId === null ? null : validateWorkItemId(rawContext.workItemId, 'payload.context.workItemId', project);
      const contextWorkRunId = rawContext.workRunId === null ? null : validateWorkRunId(rawContext.workRunId, 'payload.context.workRunId');
      const decisions = list(rawContext.decisions, 'payload.context.decisions', 32, (raw, itemLabel) => {
        const decision = object(raw, itemLabel, ['decisionId', 'text', 'citationTargets']);
        return { decisionId: boundedId(decision.decisionId, `${itemLabel}.decisionId`), text: boundedId(decision.text, `${itemLabel}.text`, 4096), citationTargets: validateCitations(decision.citationTargets, `${itemLabel}.citationTargets`, 64) };
      });
      const checkpoints = list(rawContext.checkpoints, 'payload.context.checkpoints', 32, (raw, itemLabel) => {
        const checkpoint = object(raw, itemLabel, ['checkpointId', 'stage', 'status', 'summary', 'recordedAt', 'citationTargets']);
        return { checkpointId: boundedId(checkpoint.checkpointId, `${itemLabel}.checkpointId`), stage: boundedId(checkpoint.stage, `${itemLabel}.stage`, 64), status: boundedId(checkpoint.status, `${itemLabel}.status`, 64), summary: boundedId(checkpoint.summary, `${itemLabel}.summary`, 4096), recordedAt: validateTimestamp(checkpoint.recordedAt, `${itemLabel}.recordedAt`), citationTargets: validateCitations(checkpoint.citationTargets, `${itemLabel}.citationTargets`, 64) };
      });
      return { workItemId: contextWorkItemId, workRunId: contextWorkRunId, decisions, checkpoints, prerequisites: validateCitations(rawContext.prerequisites, 'payload.context.prerequisites', 16), citations: validateCitations(rawContext.citations, 'payload.context.citations', 64) };
    })();
    const capabilities = entry.capabilities === undefined ? undefined : list(entry.capabilities, 'payload.capabilities', 16, (raw, itemLabel) => {
      const capability = object(raw, itemLabel, ['capability', 'state']);
      if (capability.state !== 'available' && capability.state !== 'degraded') fail(`${itemLabel}.state`, 'has an invalid state');
      return { capability: boundedId(capability.capability, `${itemLabel}.capability`), state: capability.state } as const;
    });
    const suggestedQueries = entry.suggestedQueries === undefined ? undefined : list(entry.suggestedQueries, 'payload.suggestedQueries', 3, (raw, itemLabel) => boundedId(raw, itemLabel, 2048));
    const payload = { kind: 'open' as const, workItemId, workRunId, contextSource: entry.contextSource as RecoveryOpenPayloadV2['contextSource'], citations: validateCitations(entry.citations, 'payload.citations'), ...(currentStage ? { currentStage } : {}), ...(workGroups ? { workGroups } : {}), ...(context ? { context } : {}), ...(capabilities ? { capabilities } : {}), ...(suggestedQueries ? { suggestedQueries } : {}) };
    if (utf8JsonBytes(payload) > 64 * 1024) fail('payload', 'must not exceed 64 KiB');
    return payload;
  }
  if (stage === 'searched') {
    const entry = object(value, 'payload', ['kind', 'query', 'limit', 'searchInputFingerprint', 'searchFingerprint', 'results']);
    if (entry.kind !== 'searched') fail('payload.kind', 'does not match stage');
    const payload = { kind: 'searched' as const, query: validateQuery(entry.query, 'payload.query'), limit: validateLimit(entry.limit, 'payload.limit'), searchInputFingerprint: fingerprint(entry.searchInputFingerprint, 'payload.searchInputFingerprint'), searchFingerprint: fingerprint(entry.searchFingerprint, 'payload.searchFingerprint'), results: list(entry.results, 'payload.results', 25, (item, label) => validateSearchResult(item, label, project)) };
    if (utf8JsonBytes(payload) > 128 * 1024) fail('payload', 'must not exceed 128 KiB');
    return payload;
  }
  if (stage === 'needs-agent-selection') {
    const entry = object(value, 'payload', ['kind', 'candidates', 'bindings']);
    if (entry.kind !== 'needs-agent-selection') fail('payload.kind', 'does not match stage');
    const candidates = list(entry.candidates, 'payload.candidates', 3, (item, label) => boundedId(item, label));
    if (candidates.length < 1 || new Set(candidates).size !== candidates.length) fail('payload.candidates', 'must contain 1-3 unique candidates');
    const bindings = list(entry.bindings, 'payload.bindings', 16, validateAgentSelection);
    const bindingKeys = bindings.map((binding) => `${binding.bindingId}\u0000${binding.bindingRevision}`);
    if (bindings.length < 2 || new Set(bindingKeys).size !== bindings.length) fail('payload.bindings', 'must contain 2-16 unique compatible bindings');
    return { kind: 'needs-agent-selection', candidates, bindings };
  }
  if (stage === 'planned') {
    const entry = object(value, 'payload', ['kind', 'plan', 'candidates']);
    if (entry.kind !== 'planned') fail('payload.kind', 'does not match stage');
    const plan = validateRecoveryPlanV2(entry.plan);
    if (plan.projectId !== project) fail('payload.plan.projectId', 'must match response projectId');
    const candidates = list(entry.candidates, 'payload.candidates', 3, (item, label) => boundedId(item, label));
    if (candidates.length < 1 || new Set(candidates).size !== candidates.length || !candidates.includes(plan.candidateId)) {
      fail('payload.candidates', 'must contain 1-3 unique candidates including plan.candidateId');
    }
    return { kind: 'planned', plan, candidates };
  }
  const entry = object(value, 'payload', ['kind', 'reason', 'remediation']);
  if (entry.kind !== 'unavailable') fail('payload.kind', 'does not match stage');
  return { kind: 'unavailable', reason: boundedId(entry.reason, 'payload.reason', 128), remediation: boundedId(entry.remediation, 'payload.remediation', 1024) };
}
function validateIntents(stage: RecoveryFlowStage, value: unknown, payload: RecoveryFlowPayloadV2): RecoveryFlowRequestIntentV2[] {
  const intents = list(value, 'nextRequestIntents', 8, validateIntent);
  let allowed: Partial<Record<RecoveryFlowAction, true>>;
  switch (stage) {
    case 'open':
      allowed = { search: true };
      break;
    case 'searched':
      allowed = { plan: true };
      break;
    case 'planned':
      allowed = { plan: true, 'refresh-plan': true };
      break;
    case 'stale':
      allowed = { restart: true };
      break;
    default:
      allowed = {};
  }
  if (stage === 'searched') {
    if (intents.length > 1) fail('nextRequestIntents', 'searched responses allow at most one plan intent');
    const searched = payload as RecoverySearchedPayloadV2;
    if (intents.some((intent) => intent.action !== 'plan' || intent.mode !== 'from-search' || intent.priorPlan !== null || intent.query !== searched.query || intent.limit !== searched.limit)) {
      fail('nextRequestIntents', 'searched responses require a from-search plan intent bound to the payload query and limit');
    }
  }
  if ((stage === 'needs-agent-selection' || stage === 'unavailable') && intents.length !== 0) {
    fail('nextRequestIntents', `${stage} responses do not permit next-request intents`);
  }
  if (stage === 'planned') {
    const currentPlan = (payload as RecoveryPlannedPayloadV2).plan;
    const plannedIntents = intents.filter((intent) => intent.action === 'plan' || intent.action === 'refresh-plan');
    if (plannedIntents.filter((intent) => intent.action === 'refresh-plan').length !== 1) {
      fail('nextRequestIntents', 'planned responses require exactly one refresh-plan intent');
    }
    const overrideCandidates = new Set<string>();
    for (const intent of plannedIntents) {
      const priorPlan = intent.action === 'plan' || intent.action === 'refresh-plan' ? intent.priorPlan : null;
      if (priorPlan === null || canonicalRecoveryJson(priorPlan) !== canonicalRecoveryJson(currentPlan)) {
        fail('nextRequestIntents', 'planned responses must derive override or refresh intents from the current Plan');
      }
      if (intent.action === 'plan') {
        if (intent.mode !== 'override') fail('nextRequestIntents', 'planned plan intents must use override mode');
        if (!((payload as RecoveryPlannedPayloadV2).candidates).includes(intent.candidateId)) {
          fail('nextRequestIntents', 'override candidate must be a member of payload.candidates');
        }
        if (intent.candidateId === currentPlan.candidateId) {
          fail('nextRequestIntents', 'override candidate must differ from the current Plan candidate');
        }
        if (overrideCandidates.has(intent.candidateId)) {
          fail('nextRequestIntents', 'override candidates must be unique');
        }
        overrideCandidates.add(intent.candidateId);
      }
    }
  }
  if (stage === 'stale') {
    if (intents.length !== 1) fail('nextRequestIntents', 'stale responses require exactly one restart intent');
    const proof = payload as RecoveryStaleProofV2;
    const intent = intents[0];
    if (intent === undefined || intent.action !== 'restart' || canonicalRecoveryJson(intent.staleProof) !== canonicalRecoveryJson(proof)) {
      fail('nextRequestIntents', 'stale restart intent must derive from the current stale proof');
    }
  }
  if (intents.some((intent) => allowed[intent.action] !== true)) fail('nextRequestIntents', 'contains an action not allowed by the current stage');
  return intents;
}
function intrinsicFromResponse(response: RecoveryFlowResponseV2, payload: RecoveryFlowPayloadV2, intents: RecoveryFlowRequestIntentV2[]): RecoveryFlowIntrinsicProjectionV2 {
  return {
    schemaVersion: response.schemaVersion,
    stage: response.stage,
    projectId: response.projectId,
    previousFlowFingerprint: response.previousFlowFingerprint,
    actionInputFingerprint: response.actionInputFingerprint,
    recoveryFingerprint: response.recoveryFingerprint,
    ownerLocks: response.ownerLocks,
    payloadFingerprint: fingerprintRecoveryValue(payload),
    nextRequestIntents: intents,
    diagnostics: response.diagnostics,
    omitted: response.omitted,
  };
}
export function fingerprintRecoveryFlowIntrinsicStage(input: RecoveryFlowIntrinsicProjectionV2): RecoveryFingerprint {
  return fingerprintRecoveryValue(input);
}
function deriveRequest(response: RecoveryFlowResponseV2, intent: RecoveryFlowRequestIntentV2): RecoveryFlowRequestV2 {
  const common = { schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION, projectId: response.projectId };
  if (intent.action === 'search') return { ...common, action: 'search', openFlowFingerprint: response.flowFingerprint, query: intent.query, limit: intent.limit };
  if (intent.action === 'plan') return { ...common, action: 'plan', mode: intent.mode, openFlowFingerprint: response.rootOpenFlowFingerprint, searchedBasisFlowFingerprint: intent.priorPlan?.searchedBasisFlowFingerprint ?? response.flowFingerprint, plannedFlowFingerprint: intent.priorPlan === null ? null : response.flowFingerprint, query: intent.query, limit: intent.limit, candidateId: intent.candidateId, agentSelection: intent.agentSelection, priorPlan: intent.priorPlan } as RecoveryFlowRequestV2;
  if (intent.action === 'refresh-plan') return { ...common, action: 'refresh-plan', openFlowFingerprint: response.rootOpenFlowFingerprint, searchedBasisFlowFingerprint: intent.priorPlan.searchedBasisFlowFingerprint, plannedFlowFingerprint: response.flowFingerprint, query: intent.query, limit: intent.limit, priorPlan: intent.priorPlan };
  return { ...common, action: 'restart', staleProof: intent.staleProof };
}
export function deriveRecoveryFlowRequests(response: RecoveryFlowResponseV2): RecoveryFlowRequestV2[] {
  const validated = validateRecoveryFlowResponseV2(response);
  return validated.nextRequestIntents.map((intent) => deriveRequest(validated, intent));
}
export function validateRecoveryFlowResponseV2(value: unknown): RecoveryFlowResponseV2 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('Recovery Flow response', 'must be an object');
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== RECOVERY_FLOW_SCHEMA_VERSION) fail('Recovery Flow response.schemaVersion', 'has an invalid schema version');
  if (typeof raw.stage !== 'string' || STAGE_SET[raw.stage as RecoveryFlowStage] !== true) fail('Recovery Flow response.stage', 'has an invalid stage');
  const stage = raw.stage as RecoveryFlowStage;
  const entry = object(value, 'Recovery Flow response', ['schemaVersion', 'stage', 'projectId', 'previousFlowFingerprint', 'actionInputFingerprint', 'recoveryFingerprint', 'ownerLocks', 'payload', 'nextRequestIntents', 'diagnostics', 'omitted', 'rootOpenFlowFingerprint', 'nextRequests', 'generatedAt', 'flowFingerprint']);
  const project = projectId(entry.projectId, 'projectId');
  const payload = validatePayload(stage, entry.payload, project);
  if (stage === 'stale' && (payload as RecoveryStaleProofV2).projectId !== project) fail('payload.projectId', 'must match response projectId');
  const intents = validateIntents(stage, entry.nextRequestIntents, payload);
  const diagnostics = list(entry.diagnostics, 'diagnostics', 32, validateDiagnostic);
  const ownerLocks = validateOwnerLocks(entry.ownerLocks, 'ownerLocks');
  const omitted = validateOmitted(entry.omitted, 'omitted');
  const response = {
    schemaVersion: RECOVERY_FLOW_SCHEMA_VERSION,
    stage,
    projectId: project,
    previousFlowFingerprint: nullableFingerprint(entry.previousFlowFingerprint, 'previousFlowFingerprint'),
    actionInputFingerprint: fingerprint(entry.actionInputFingerprint, 'actionInputFingerprint'),
    recoveryFingerprint: fingerprint(entry.recoveryFingerprint, 'recoveryFingerprint'),
    ownerLocks,
    payload,
    nextRequestIntents: intents,
    diagnostics,
    omitted,
    rootOpenFlowFingerprint: fingerprint(entry.rootOpenFlowFingerprint, 'rootOpenFlowFingerprint'),
    nextRequests: list(entry.nextRequests, 'nextRequests', 8, (item, label) => validateRecoveryFlowRequestV2(item)),
    generatedAt: validateTimestamp(entry.generatedAt, 'generatedAt'),
    flowFingerprint: fingerprint(entry.flowFingerprint, 'flowFingerprint'),
  } as RecoveryFlowResponseV2;
  if (response.stage === 'open' && response.previousFlowFingerprint !== null) fail('previousFlowFingerprint', 'must be null for open');
  if (response.stage !== 'open' && response.previousFlowFingerprint === null) fail('previousFlowFingerprint', 'must be present for non-open responses');
  if (response.stage === 'open' && response.rootOpenFlowFingerprint !== response.flowFingerprint) fail('rootOpenFlowFingerprint', 'must equal open flowFingerprint');
  if ((stage === 'searched' || stage === 'needs-agent-selection') && response.rootOpenFlowFingerprint !== response.previousFlowFingerprint) {
    fail('rootOpenFlowFingerprint', 'must equal previousFlowFingerprint for searched or needs-agent-selection responses');
  }
  if (stage === 'open' && utf8JsonBytes({ payload, diagnostics, omitted }) > 64 * 1024) {
    fail('open context', 'must not exceed 64 KiB including payload, diagnostics, and omissions');
  }
  if (response.stage === 'planned') {
    const plan = (response.payload as RecoveryPlannedPayloadV2).plan;
    if (response.rootOpenFlowFingerprint !== plan.rootOpenFlowFingerprint) fail('rootOpenFlowFingerprint', 'must match payload.plan');
    if (response.recoveryFingerprint !== plan.recoveryFingerprint) fail('recoveryFingerprint', 'must match payload.plan');
  }
  if (response.stage === 'stale') {
    const proof = response.payload as RecoveryStaleProofV2;
    if (response.rootOpenFlowFingerprint !== proof.rootOpenFlowFingerprint) fail('rootOpenFlowFingerprint', 'must match stale proof');
    if (response.previousFlowFingerprint !== proof.priorFlowFingerprint) fail('previousFlowFingerprint', 'must match stale proof');
    if (response.actionInputFingerprint !== proof.priorActionInputFingerprint) fail('actionInputFingerprint', 'must match stale proof');
    if (response.recoveryFingerprint !== proof.recoveryFingerprint) fail('recoveryFingerprint', 'must match stale proof');
  }
  const intrinsic = intrinsicFromResponse(response, payload, intents);
  if (fingerprintRecoveryFlowIntrinsicStage(intrinsic) !== response.flowFingerprint) fail('flowFingerprint', 'does not match intrinsic stage projection');
  const expectedRequests = intents.map((intent) => deriveRequest(response, intent));
  if (canonicalRecoveryJson(expectedRequests) !== canonicalRecoveryJson(response.nextRequests)) fail('nextRequests', 'do not match fingerprint-bound next-request intents');
  return response;
}
