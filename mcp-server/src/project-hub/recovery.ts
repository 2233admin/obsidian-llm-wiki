import { isCanonicalWorkItemId, isCanonicalWorkRunId } from '../workflow/workflow.js';
import { canonicalRecoveryJson, fingerprintRecoveryValue } from './contract-support.js';

export const PROJECT_HUB_RECOVERY_SCHEMA_VERSION = 'project-hub-recovery/v1' as const;

export type RecoveryFreshnessState = 'current' | 'stale' | 'partial' | 'missing' | 'unavailable' | 'unknown';
export type RecoveryCitationStatus = 'current' | 'stale' | 'unavailable' | 'unknown';
export type RecoveryDiagnosticSeverity = 'info' | 'warning' | 'error';
export type RecoveryActionKind =
  | 'resume-work-run'
  | 'inspect-work-item'
  | 'inspect-evidence'
  | 'repair-capability'
  | 'manual-review';

export interface ProjectHubRecoveryCitation {
  readonly ref: string;
  readonly kind: 'vault-path' | 'project' | 'work-item' | 'work-run' | 'memory' | 'session' | 'capability' | 'diagnostic';
  readonly status: RecoveryCitationStatus;
}

export interface ProjectHubRecoveryDiagnostic {
  readonly code: string;
  readonly owner: string;
  readonly severity: RecoveryDiagnosticSeverity;
  readonly state: RecoveryFreshnessState;
  readonly message: string;
  readonly remediation: string;
  readonly citationTargets: readonly string[];
}

export interface ProjectHubRecoveryFreshness {
  readonly state: RecoveryFreshnessState;
  readonly generatedAt: string;
  readonly latestObservedAt: string | null;
  readonly byOwner: Readonly<Record<string, RecoveryFreshnessState>>;
}

export interface ProjectHubRecoveryWorkItem {
  readonly entity: string;
  readonly label: string;
  readonly state: string;
  readonly blockedBy: readonly string[];
  readonly citationTargets: readonly string[];
}

export interface ProjectHubRecoveryWorkItems {
  readonly done: readonly ProjectHubRecoveryWorkItem[];
  readonly inProgress: readonly ProjectHubRecoveryWorkItem[];
  readonly blocked: readonly ProjectHubRecoveryWorkItem[];
  readonly notStarted: readonly ProjectHubRecoveryWorkItem[];
}
interface CollectedRecoveryWorkItems extends ProjectHubRecoveryWorkItems {
  readonly diagnostics: readonly string[];
}
export interface ProjectHubRecoveryStage {
  readonly value: string | null;
  readonly state: RecoveryFreshnessState;
  readonly source: string | null;
  readonly citationTargets: readonly string[];
}

export interface ProjectHubRecoveryAction {
  readonly actionId: string;
  readonly kind: RecoveryActionKind;
  readonly label: string;
  readonly reason: string;
  readonly state: 'available' | 'manual' | 'blocked';
  readonly recommended: boolean;
  readonly projectId: string;
  readonly workItemId: string | null;
  readonly workRunId: string | null;
  readonly citationTargets: readonly string[];
  readonly prerequisites: readonly string[];
}

export interface ProjectHubRecoveryMemory {
  readonly schemaVersion: string | null;
  readonly revision: string | null;
  readonly fingerprint: string | null;
  readonly freshness: RecoveryFreshnessState;
  readonly authority: string;
  readonly reviewedClaimCount: number;
  readonly currentClaimCount: number;
  readonly conflictCount: number;
  readonly sessions: readonly {
    readonly sessionId: string;
    readonly status: string;
    readonly freshness: RecoveryFreshnessState;
    readonly citationTargets: readonly string[];
  }[];
}

export interface ProjectHubRecoverySnapshot {
  readonly schemaVersion: typeof PROJECT_HUB_RECOVERY_SCHEMA_VERSION;
  readonly projectId: string;
  readonly generatedAt: string;
  readonly readOnly: true;
  readonly fingerprint: `sha256:${string}`;
  readonly freshness: ProjectHubRecoveryFreshness;
  readonly diagnostics: readonly ProjectHubRecoveryDiagnostic[];
  readonly citations: readonly ProjectHubRecoveryCitation[];
  readonly currentStage: ProjectHubRecoveryStage;
  readonly done: readonly ProjectHubRecoveryWorkItem[];
  readonly inProgress: readonly ProjectHubRecoveryWorkItem[];
  readonly blocked: readonly ProjectHubRecoveryWorkItem[];
  readonly notStarted: readonly ProjectHubRecoveryWorkItem[];
  readonly nextAction: ProjectHubRecoveryAction | null;
  readonly nextActions: readonly ProjectHubRecoveryAction[];
  readonly memory: ProjectHubRecoveryMemory;
}

export interface ProjectHubRecoverySection {
  readonly owner: string;
  readonly freshness: string | null;
  readonly health: 'healthy' | 'degraded' | 'unavailable' | 'empty';
  readonly drift: readonly string[];
  readonly data: Record<string, unknown>;
  readonly citationTargets?: readonly string[];
}

export interface ProjectHubRecoveryInput {
  readonly projectId: string;
  readonly generatedAt: string;
  readonly projectDiagnostics: readonly {
    readonly code: string;
    readonly severity: 'info' | 'warning' | 'error';
    readonly message: string;
    readonly path?: string;
  }[];
  readonly sections: Readonly<Record<string, ProjectHubRecoverySection>>;
  readonly memory: ProjectHubRecoveryMemory | null;
  readonly memoryDiagnostics?: readonly string[];
}

const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\|\/)/;
const PROJECT_ID = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
function canonicalJson(value: unknown): string {
  return canonicalRecoveryJson(value);
}

function safeRef(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ref = value.trim();
  return ref && !ABSOLUTE_PATH.test(ref) ? ref : null;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))].sort((left, right) => left.localeCompare(right));
}

function citation(ref: string, kind: ProjectHubRecoveryCitation['kind'], status: RecoveryCitationStatus = 'current'): ProjectHubRecoveryCitation {
  return { ref, kind, status };
}
function citationStatus(state: RecoveryFreshnessState): RecoveryCitationStatus {
  switch (state) {
    case 'stale':
      return 'stale';
    case 'unavailable':
      return 'unavailable';
    default:
      return 'unknown';
  }
}


function sectionState(section: ProjectHubRecoverySection | undefined): RecoveryFreshnessState {
  if (!section) return 'missing';
  if (section.health === 'unavailable') return 'unavailable';
  if (section.health === 'degraded') return 'partial';
  if (section.health === 'empty') return 'missing';
  return section.freshness ? 'current' : 'unknown';
}

function memoryState(memory: ProjectHubRecoveryMemory | null): RecoveryFreshnessState {
  if (!memory) return 'missing';
  if (memory.freshness === 'stale') return 'stale';
  if (memory.freshness === 'unknown') return 'unknown';
  return memory.freshness;
}

function aggregateState(states: readonly RecoveryFreshnessState[]): RecoveryFreshnessState {
  if (states.includes('stale')) return 'stale';
  if (states.includes('partial') || states.includes('unavailable')) return 'partial';
  if (states.includes('missing')) return 'partial';
  if (states.includes('unknown')) return 'unknown';
  return 'current';
}

function diagnostic(
  owner: string,
  code: string,
  severity: RecoveryDiagnosticSeverity,
  state: RecoveryFreshnessState,
  message: string,
  remediation: string,
  citationTargets: readonly string[] = [],
): ProjectHubRecoveryDiagnostic {
  return {
    owner,
    code,
    severity,
    state,
    message,
    remediation,
    citationTargets: sortedUnique(citationTargets.map(safeRef).filter((ref): ref is string => ref !== null)),
  };
}

function diagnosticState(severity: RecoveryDiagnosticSeverity): RecoveryFreshnessState {
  switch (severity) {
    case 'error':
      return 'unavailable';
    case 'warning':
      return 'partial';
    default:
      return 'unknown';
  }
}

function diagnosticsForInput(input: ProjectHubRecoveryInput): ProjectHubRecoveryDiagnostic[] {
  const output: ProjectHubRecoveryDiagnostic[] = input.projectDiagnostics.map((item) => diagnostic(
    'project-context',
    item.code,
    item.severity,
    diagnosticState(item.severity),
    item.message,
    'Resolve the Project Context diagnostic before treating the related state as current.',
    item.path ? [item.path] : [],
  ));
  for (const [name, section] of Object.entries(input.sections).sort(([left], [right]) => left.localeCompare(right))) {
    const state = sectionState(section);
    if (state === 'current' && section.drift.length === 0) continue;
    if (section.drift.length === 0 && state === 'missing') {
      output.push(diagnostic(name, `${name}_missing`, 'warning', 'missing', `${name} has no readable state.`, `Inspect or restore the ${name} owner before relying on this snapshot.`));
      continue;
    }
    if (section.drift.length === 0 && state === 'unknown') {
      output.push(diagnostic(name, `${name}_freshness_unknown`, 'warning', 'unknown', `${name} has no freshness timestamp.`, `Inspect the ${name} owner and record an observed timestamp.`));
    }
    for (const code of sortedUnique(section.drift)) {
      const driftState = code.startsWith('expired_work_run:') ? 'stale' : state;
      output.push(diagnostic(
        name,
        code,
        state === 'unavailable' ? 'error' : 'warning',
        driftState,
        `${name} reported ${code}.`,
        `Use the ${name} owner to remediate ${code}; the Hub will remain derived and read-only.`,
        section.citationTargets ?? [],
      ));
    }
  }
  const memoryFreshness = memoryState(input.memory);
  if (memoryFreshness === 'missing') output.push(diagnostic('project-memory', 'project_memory_missing', 'warning', 'missing', 'No Project Memory projection is available.', 'Review or restore a Project Memory source before using memory claims as current.', []));
  else if (memoryFreshness === 'stale') output.push(diagnostic('project-memory', 'project_memory_stale', 'warning', 'stale', 'Project Memory contains stale evidence.', 'Refresh or review the stale memory evidence before treating it as current.', []));
  else if (memoryFreshness === 'unavailable') output.push(diagnostic('project-memory', 'project_memory_unavailable', 'error', 'unavailable', 'Project Memory could not be compiled.', 'Repair the Project Memory source or inspect its owner diagnostics.', []));
  if (input.memory && input.memory.conflictCount > 0) output.push(diagnostic('project-memory', 'project_memory_conflicts', 'warning', 'partial', 'Project Memory contains unresolved conflicts.', 'Review the conflicting memory claims before treating them as current.', []));
  for (const code of sortedUnique(input.memoryDiagnostics ?? [])) {
    output.push(diagnostic('project-memory', code, 'warning', 'partial', 'Project Memory contains a malformed or invalid source record.', 'Repair or remove the malformed Project Memory source before relying on the projection as current.', []));
  }
  const stage = input.sections.runtime?.data.stage;
  if (typeof stage !== 'string' || !stage.trim()) output.push(diagnostic('work-driver', 'current_stage_unknown', 'info', 'unknown', 'No authoritative current workflow stage is recorded.', 'Inspect the active Work Run or choose a bounded work item before resuming.', input.sections.runtime?.citationTargets ?? []));
  const byKey = new Map<string, ProjectHubRecoveryDiagnostic>();
  for (const item of output) byKey.set(`${item.owner}\0${item.code}\0${item.state}`, item);
  return [...byKey.values()].sort((left, right) => left.owner.localeCompare(right.owner) || left.code.localeCompare(right.code) || left.state.localeCompare(right.state));
}

function workItems(input: ProjectHubRecoveryInput): CollectedRecoveryWorkItems {
  const data = input.sections.work?.data ?? {};
  const rawItems = Array.isArray(data.authoritativeItems) ? data.authoritativeItems : [];
  const items: ProjectHubRecoveryWorkItem[] = [];
  const diagnostics: string[] = [];
  for (const raw of rawItems) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const entity = safeRef(item.entity);
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const state = typeof item.state === 'string' ? item.state.trim() : '';
    if (!entity || !isCanonicalWorkItemId(entity) || !entity.startsWith(`${input.projectId}/`) || !label || !state) {
      diagnostics.push(`work_item_identity_invalid:${entity ?? 'unknown'}`);
      continue;
    }
    const rawBlockedBy = Array.isArray(item.blockedBy) ? item.blockedBy : [];
    const blockedBy = safeRefs(rawBlockedBy);
    if (blockedBy.length !== rawBlockedBy.length || blockedBy.some((ref) => !isCanonicalWorkItemId(ref) || !ref.startsWith(`${input.projectId}/`))) {
      diagnostics.push(`work_item_blocker_invalid:${entity}`);
      continue;
    }
    const citationTargets = Array.isArray(item.citationTargets) ? safeRefs(item.citationTargets) : [];
    items.push({ entity, label, state, blockedBy: sortedUnique(blockedBy), citationTargets: sortedUnique(citationTargets) });
  }
  items.sort((left, right) => left.entity.localeCompare(right.entity));
  return {
    done: items.filter((item) => item.state === 'done'),
    inProgress: items.filter((item) => item.state === 'in-progress'),
    blocked: items.filter((item) => item.blockedBy.length > 0),
    notStarted: items.filter((item) => item.blockedBy.length === 0 && (item.state === 'backlog' || item.state === 'todo')),
    diagnostics,
  };
}

function stage(input: ProjectHubRecoveryInput, inProgress: readonly ProjectHubRecoveryWorkItem[]): ProjectHubRecoveryStage {
  const runtime = input.sections.runtime;
  const value = typeof runtime?.data.stage === 'string' && runtime.data.stage.trim() ? runtime.data.stage.trim() : null;
  const target = safeRef(typeof runtime?.data.stageCitation === 'string' ? runtime.data.stageCitation : null);
  if (value) return { value, state: sectionState(runtime), source: 'work-driver', citationTargets: target ? [target] : [] };
  if (inProgress.length > 0) return { value: null, state: 'unknown', source: null, citationTargets: inProgress[0]!.citationTargets };
  return { value: null, state: 'unknown', source: null, citationTargets: [] };
}

interface RecoveryActionDetails {
  kind: RecoveryActionKind;
  label: string;
  reason: string;
  state: ProjectHubRecoveryAction['state'];
  actionId: string;
  workItemId: string | null;
  workRunId: string | null;
  citationTargets: readonly string[];
  prerequisites: readonly string[];
  recommended: boolean;
}

function action(input: ProjectHubRecoveryInput, details: RecoveryActionDetails): ProjectHubRecoveryAction {
  return {
    ...details,
    projectId: input.projectId,
    citationTargets: sortedUnique(details.citationTargets),
    prerequisites: sortedUnique(details.prerequisites),
  };
}

function citationKind(kind: RecoveryActionKind): ProjectHubRecoveryCitation['kind'] {
  switch (kind) {
    case 'resume-work-run':
      return 'work-run';
    case 'inspect-work-item':
      return 'work-item';
    case 'inspect-evidence':
      return 'memory';
    case 'repair-capability':
      return 'capability';
    default:
      return 'diagnostic';
  }
}

function safeRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(safeRef).filter((ref): ref is string => ref !== null);
}
function safeMemory(memory: ProjectHubRecoveryMemory | null): ProjectHubRecoveryMemory {
  if (memory) {
    return {
      ...memory,
      sessions: memory.sessions.map((session) => ({
        ...session,
        citationTargets: safeRefs(session.citationTargets),
      })),
    };
  }
  return {
    schemaVersion: null,
    revision: null,
    fingerprint: null,
    freshness: 'missing',
    authority: 'unknown',
    reviewedClaimCount: 0,
    currentClaimCount: 0,
    conflictCount: 0,
    sessions: [],
  };
}

function nextActions(
  input: ProjectHubRecoveryInput,
  items: ProjectHubRecoveryWorkItems,
  diagnostics: readonly ProjectHubRecoveryDiagnostic[],
): ProjectHubRecoveryAction[] {
  const output: ProjectHubRecoveryAction[] = [];
  const activeRuns = input.sections.runtime?.data.activeRuns;
  for (const raw of Array.isArray(activeRuns) ? activeRuns : []) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const run = raw as Record<string, unknown>;
    const workRunId = safeRef(run.workRunId);
    const projectId = safeRef(run.projectId);
    const workItemId = safeRef(run.workItemId);
    if (run.resumable !== true || !workRunId || !isCanonicalWorkRunId(workRunId) || projectId !== input.projectId || !workItemId || !isCanonicalWorkItemId(workItemId) || !workItemId.startsWith(`${input.projectId}/`)) continue;
    output.push(action(input, {
      kind: 'resume-work-run',
      label: 'Resume the active Work Run',
      reason: 'An active Work Run is available for this Project.',
      state: 'available',
      actionId: `resume:${workRunId}`,
      workItemId,
      workRunId,
      citationTargets: safeRefs(run.citationTargets),
      prerequisites: [],
      recommended: true,
    }));
  }
  const firstBlocked = items.blocked[0];
  if (firstBlocked) output.push(action(input, {
    kind: 'inspect-work-item',
    label: 'Inspect the blocked work item',
    reason: `Resolve the blocker before continuing ${firstBlocked.label}.`,
    state: 'blocked',
    actionId: `inspect-blocked:${firstBlocked.entity}`,
    workItemId: firstBlocked.entity,
    workRunId: null,
    citationTargets: firstBlocked.citationTargets,
    prerequisites: firstBlocked.blockedBy,
    recommended: output.length === 0,
  }));
  const capabilityIssue = diagnostics.find((item) => item.owner === 'capabilities' || item.owner === 'hostCapabilities' || item.owner === 'settings');
  if (capabilityIssue) output.push(action(input, {
    kind: 'repair-capability',
    label: 'Repair the unavailable capability',
    reason: capabilityIssue.message,
    state: capabilityIssue.severity === 'error' ? 'blocked' : 'manual',
    actionId: `repair:${capabilityIssue.owner}:${capabilityIssue.code}`,
    workItemId: null,
    workRunId: null,
    citationTargets: capabilityIssue.citationTargets,
    prerequisites: [capabilityIssue.remediation],
    recommended: output.length === 0,
  }));
  const firstInProgress = items.inProgress[0];
  if (firstInProgress && output.length === 0) output.push(action(input, {
    kind: 'inspect-work-item',
    label: 'Open the current work item',
    reason: `Continue the current work item ${firstInProgress.label}.`,
    state: 'available',
    actionId: `inspect:${firstInProgress.entity}`,
    workItemId: firstInProgress.entity,
    workRunId: null,
    citationTargets: firstInProgress.citationTargets,
    prerequisites: [],
    recommended: true,
  }));
  const firstNotStarted = items.notStarted[0];
  if (firstNotStarted && output.length === 0) output.push(action(input, {
    kind: 'inspect-work-item',
    label: 'Open the next work item',
    reason: `The next authoritative work item is ${firstNotStarted.label}.`,
    state: 'available',
    actionId: `inspect:${firstNotStarted.entity}`,
    workItemId: firstNotStarted.entity,
    workRunId: null,
    citationTargets: firstNotStarted.citationTargets,
    prerequisites: [],
    recommended: true,
  }));
  const evidenceIssue = diagnostics.find((item) => item.owner === 'project-memory' || item.owner === 'knowledge');
  if (evidenceIssue && output.length === 0) output.push(action(input, {
    kind: 'inspect-evidence',
    label: 'Inspect Project evidence',
    reason: evidenceIssue.message,
    state: 'manual',
    actionId: `evidence:${evidenceIssue.code}`,
    workItemId: null,
    workRunId: null,
    citationTargets: evidenceIssue.citationTargets,
    prerequisites: [evidenceIssue.remediation],
    recommended: true,
  }));
  if (output.length === 0) output.push(action(input, {
    kind: 'manual-review',
    label: 'Review Project diagnostics',
    reason: 'No safe executable action was found from the current snapshot.',
    state: 'manual',
    actionId: 'review:diagnostics',
    workItemId: null,
    workRunId: null,
    citationTargets: diagnostics.flatMap((item) => item.citationTargets),
    prerequisites: ['Choose an owning domain operation after reviewing the diagnostics.'],
    recommended: true,
  }));
  return output
    .sort((left, right) => Number(right.recommended) - Number(left.recommended) || left.actionId.localeCompare(right.actionId))
    .slice(0, 3)
    .map((item, index) => ({ ...item, recommended: index === 0 }));
}

export function fingerprintProjectHubRecoverySnapshot(snapshot: Omit<ProjectHubRecoverySnapshot, 'fingerprint'>): `sha256:${string}` {
  const { generatedAt: _generatedAt, fingerprint: _fingerprint, freshness, ...rest } = snapshot as ProjectHubRecoverySnapshot;
  const { generatedAt: _freshnessGeneratedAt, ...stableFreshness } = freshness;
  return fingerprintRecoveryValue({ ...rest, freshness: stableFreshness });
}
export function composeProjectHubRecoverySnapshot(input: ProjectHubRecoveryInput): ProjectHubRecoverySnapshot {
  if (!PROJECT_ID.test(input.projectId)) throw new Error('Project Hub recovery projectId must be a canonical Project ID');
  if (!ISO_TIMESTAMP.test(input.generatedAt)) throw new Error('Project Hub recovery generatedAt must be an ISO timestamp');
  const items = workItems(input);
  const diagnostics = [
    ...diagnosticsForInput(input),
    ...items.diagnostics.map((code) => diagnostic(
      'work-os',
      code,
      'warning',
      'partial',
      'Work-OS contains a malformed blocker reference.',
      'Repair the blocker reference before treating the work item as current.',
    )),
  ].sort((left, right) => left.owner.localeCompare(right.owner) || left.code.localeCompare(right.code) || left.state.localeCompare(right.state));
  const memory = input.memory && (input.memoryDiagnostics?.length ?? 0) > 0
    ? { ...input.memory, freshness: 'partial' as const }
    : input.memory;
  const currentStage = stage(input, items.inProgress);
  const owners: Record<string, RecoveryFreshnessState> = Object.fromEntries([
    ...Object.entries(input.sections).map(([owner, section]) => [owner, sectionState(section)] as const),
    ['project-memory', memoryState(memory)] as const,
  ].sort(([left], [right]) => left.localeCompare(right)));

  const latestObservedAt = Object.entries(input.sections)
    .filter(([owner]) => owner !== 'settings')
    .map(([, section]) => section.freshness)
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) ?? null;
  const citations = new Map<string, ProjectHubRecoveryCitation>();
  for (const section of Object.values(input.sections)) {
    for (const ref of section.citationTargets ?? []) {
      const safe = safeRef(ref);
      if (safe) citations.set(safe, citation(safe, 'vault-path', sectionState(section) === 'unavailable' ? 'unavailable' : 'current'));
    }
  }
  for (const item of [...items.done, ...items.inProgress, ...items.blocked, ...items.notStarted]) {
    for (const ref of item.citationTargets) citations.set(ref, citation(ref, 'work-item'));
  }
  for (const diagnosticItem of diagnostics) {
    for (const ref of diagnosticItem.citationTargets) {
      citations.set(ref, citation(ref, 'diagnostic', citationStatus(diagnosticItem.state)));
    }
  }
  const actions = nextActions(input, items, diagnostics);
  for (const next of actions) {
    for (const ref of next.citationTargets) {
      citations.set(ref, citation(
        ref,
        citationKind(next.kind),
        next.state === 'blocked' ? 'unavailable' : 'current',
      ));
    }
  }
  const freshness: ProjectHubRecoveryFreshness = {
    state: aggregateState([...Object.values(owners), ...diagnostics.map((item) => item.state)]),
    generatedAt: input.generatedAt,
    latestObservedAt,
    byOwner: owners,
  };
  const base: Omit<ProjectHubRecoverySnapshot, 'fingerprint'> = {
    schemaVersion: PROJECT_HUB_RECOVERY_SCHEMA_VERSION,
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    readOnly: true,
    freshness,
    diagnostics,
    citations: [...citations.values()].sort((left, right) => left.ref.localeCompare(right.ref)),
    currentStage,
    done: items.done,
    inProgress: items.inProgress,
    blocked: items.blocked,
    notStarted: items.notStarted,
    nextAction: actions[0] ?? null,
    nextActions: actions,
    memory: safeMemory(memory),
  };
  return { ...base, fingerprint: fingerprintProjectHubRecoverySnapshot(base) };
}

export function canonicalProjectHubRecoveryJson(snapshot: ProjectHubRecoverySnapshot): string {
  return `${JSON.stringify(JSON.parse(canonicalRecoveryJson(snapshot)), null, 2)}\n`;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Project Hub recovery ${label} must be an object`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Project Hub recovery ${label} must be non-empty`);
  return value;
}

function assertState(value: unknown, label: string): void {
  if (!['current', 'stale', 'partial', 'missing', 'unavailable', 'unknown'].includes(value as string)) {
    throw new Error(`Project Hub recovery ${label} has an invalid freshness state`);
  }
}

function assertRefs(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new Error(`Project Hub recovery ${label} must be an array`);
  for (const [index, ref] of value.entries()) {
    const text = requiredText(ref, `${label}[${index}]`);
    if (safeRef(text) !== text) throw new Error(`Project Hub recovery ${label}[${index}] is unsafe`);
  }
}

function assertWorkItemList(value: unknown, label: string, projectId: string): void {
  if (!Array.isArray(value)) throw new Error(`Project Hub recovery ${label} must be an array`);
  for (const [index, raw] of value.entries()) {
    const item = objectValue(raw, `${label}[${index}]`);
    const entity = requiredText(item.entity, `${label}[${index}].entity`);
    if (!isCanonicalWorkItemId(entity) || !entity.startsWith(`${projectId}/`)) throw new Error(`Project Hub recovery ${label}[${index}] has a foreign entity`);
    requiredText(item.label, `${label}[${index}].label`);
    requiredText(item.state, `${label}[${index}].state`);
    assertRefs(item.blockedBy, `${label}[${index}].blockedBy`);
    for (const [blockerIndex, blocker] of (item.blockedBy as unknown[]).entries()) {
      if (!isCanonicalWorkItemId(blocker) || !blocker.startsWith(`${projectId}/`)) throw new Error(`Project Hub recovery ${label}[${index}].blockedBy[${blockerIndex}] is invalid`);
    }
    assertRefs(item.citationTargets, `${label}[${index}].citationTargets`);
  }
}

function assertAction(value: unknown, label: string, projectId: string): void {
  const action = objectValue(value, label);
  requiredText(action.actionId, `${label}.actionId`);
  if (!['resume-work-run', 'inspect-work-item', 'inspect-evidence', 'repair-capability', 'manual-review'].includes(action.kind as string)) throw new Error(`Project Hub recovery ${label}.kind is invalid`);
  requiredText(action.label, `${label}.label`);
  requiredText(action.reason, `${label}.reason`);
  if (!['available', 'manual', 'blocked'].includes(action.state as string)) throw new Error(`Project Hub recovery ${label}.state is invalid`);
  if (action.workItemId !== null && (typeof action.workItemId !== 'string' || !isCanonicalWorkItemId(action.workItemId) || !action.workItemId.startsWith(`${projectId}/`))) throw new Error(`Project Hub recovery ${label}.workItemId is invalid`);
  if (action.workRunId !== null && !isCanonicalWorkRunId(action.workRunId)) throw new Error(`Project Hub recovery ${label}.workRunId is invalid`);
  assertRefs(action.citationTargets, `${label}.citationTargets`);
  assertRefs(action.prerequisites, `${label}.prerequisites`);
}

export function validateProjectHubRecoverySnapshot(value: unknown): ProjectHubRecoverySnapshot {
  const snapshot = objectValue(value, 'snapshot');
  if (snapshot.schemaVersion !== PROJECT_HUB_RECOVERY_SCHEMA_VERSION) throw new Error('Unsupported Project Hub recovery schema version');
  const projectId = requiredText(snapshot.projectId, 'projectId');
  if (!PROJECT_ID.test(projectId)) throw new Error('Project Hub recovery snapshot has an invalid Project ID');
  if (snapshot.readOnly !== true) throw new Error('Project Hub recovery snapshot must be read-only');
  const generatedAt = requiredText(snapshot.generatedAt, 'generatedAt');
  if (!ISO_TIMESTAMP.test(generatedAt)) throw new Error('Project Hub recovery snapshot has an invalid generatedAt');
  const fingerprint = requiredText(snapshot.fingerprint, 'fingerprint');
  if (!/^sha256:[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Project Hub recovery snapshot has an invalid fingerprint');
  const freshness = objectValue(snapshot.freshness, 'freshness');
  assertState(freshness.state, 'freshness.state');
  if (freshness.generatedAt !== generatedAt) throw new Error('Project Hub recovery freshness timestamp does not match generatedAt');
  if (freshness.latestObservedAt !== null && (typeof freshness.latestObservedAt !== 'string' || !ISO_TIMESTAMP.test(freshness.latestObservedAt))) throw new Error('Project Hub recovery latestObservedAt is invalid');
  const byOwner = objectValue(freshness.byOwner, 'freshness.byOwner');
  for (const [owner, state] of Object.entries(byOwner)) {
    requiredText(owner, 'freshness owner');
    assertState(state, `freshness.byOwner.${owner}`);
  }
  const stage = objectValue(snapshot.currentStage, 'currentStage');
  if (stage.value !== null) requiredText(stage.value, 'currentStage.value');
  assertState(stage.state, 'currentStage.state');
  if (stage.source !== null) requiredText(stage.source, 'currentStage.source');
  assertRefs(stage.citationTargets, 'currentStage.citationTargets');
  for (const key of ['done', 'inProgress', 'blocked', 'notStarted']) assertWorkItemList(snapshot[key], key, projectId);
  if (snapshot.nextAction !== null) assertAction(snapshot.nextAction, 'nextAction', projectId);
  if (!Array.isArray(snapshot.nextActions)) throw new Error('Project Hub recovery nextActions must be an array');
  for (const [index, actionValue] of snapshot.nextActions.entries()) assertAction(actionValue, `nextActions[${index}]`, projectId);
  const memory = objectValue(snapshot.memory, 'memory');
  if (memory.schemaVersion !== null) requiredText(memory.schemaVersion, 'memory.schemaVersion');
  if (memory.revision !== null) requiredText(memory.revision, 'memory.revision');
  if (memory.fingerprint !== null && (typeof memory.fingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(memory.fingerprint))) throw new Error('Project Hub recovery memory fingerprint is invalid');
  assertState(memory.freshness, 'memory.freshness');
  requiredText(memory.authority, 'memory.authority');
  for (const key of ['reviewedClaimCount', 'currentClaimCount', 'conflictCount']) {
    if (typeof memory[key] !== 'number' || !Number.isInteger(memory[key]) || memory[key] < 0) throw new Error(`Project Hub recovery memory ${key} is invalid`);
  }
  if (!Array.isArray(memory.sessions)) throw new Error('Project Hub recovery memory sessions must be an array');
  for (const [index, sessionValue] of memory.sessions.entries()) {
    const session = objectValue(sessionValue, `memory.sessions[${index}]`);
    requiredText(session.sessionId, `memory.sessions[${index}].sessionId`);
    requiredText(session.status, `memory.sessions[${index}].status`);
    assertState(session.freshness, `memory.sessions[${index}].freshness`);
    assertRefs(session.citationTargets, `memory.sessions[${index}].citationTargets`);
  }
  if (!Array.isArray(snapshot.diagnostics)) throw new Error('Project Hub recovery diagnostics must be an array');
  for (const [index, diagnosticValue] of snapshot.diagnostics.entries()) {
    const item = objectValue(diagnosticValue, `diagnostics[${index}]`);
    requiredText(item.code, `diagnostics[${index}].code`);
    requiredText(item.owner, `diagnostics[${index}].owner`);
    if (!['info', 'warning', 'error'].includes(item.severity as string)) throw new Error(`Project Hub recovery diagnostics[${index}].severity is invalid`);
    assertState(item.state, `diagnostics[${index}].state`);
    requiredText(item.message, `diagnostics[${index}].message`);
    requiredText(item.remediation, `diagnostics[${index}].remediation`);
    assertRefs(item.citationTargets, `diagnostics[${index}].citationTargets`);
  }
  if (!Array.isArray(snapshot.citations)) throw new Error('Project Hub recovery citations must be an array');
  for (const [index, citationValue] of snapshot.citations.entries()) {
    const item = objectValue(citationValue, `citations[${index}]`);
    const ref = requiredText(item.ref, `citations[${index}].ref`);
    if (safeRef(ref) !== ref) throw new Error(`Project Hub recovery citations[${index}].ref is unsafe`);
    if (!['vault-path', 'project', 'work-item', 'work-run', 'memory', 'session', 'capability', 'diagnostic'].includes(item.kind as string)) throw new Error(`Project Hub recovery citations[${index}].kind is invalid`);
    if (!['current', 'stale', 'unavailable', 'unknown'].includes(item.status as string)) throw new Error(`Project Hub recovery citations[${index}].status is invalid`);
  }
  const candidate = snapshot as unknown as ProjectHubRecoverySnapshot;
  if (fingerprintProjectHubRecoverySnapshot(candidate) !== candidate.fingerprint) throw new Error('Project Hub recovery snapshot fingerprint does not match its content');
  return candidate;
}
