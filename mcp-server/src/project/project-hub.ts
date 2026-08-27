import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  type EffectiveSetting,
  type SettingsService,
} from '../../../packages/settings-platform/dist/src/index.js';
import {
  AgentDomainService,
  DreamTimeStore,
  canonicalDigest,
  type MemoryProposalId,
  type ProjectId as AgentProjectId,
} from '../../../packages/agent-domain/dist/src/index.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { Operation, OperationContext } from '../core/types.js';
import { badRequest } from '../core/types.js';
import { createDurableProjectMemorySource, durableProjectMemoryDiagnostics } from '../core/project-memory-operations.js';
import { projectContextFromSource, type ProjectContextProjection } from '../project-memory/index.js';
import { createSettingsService } from '../settings/settings.js';
import { UsageLedger } from '../usage/ledger.js';
import { projectUsage } from '../usage/projections.js';
import { HOST_CAPABILITY_RELATIVE_ROOT, HostCapabilityStore } from '../host-capabilities/store.js';
import { fingerprintContract } from '../host-capabilities/contracts.js';
import {
  composeProjectHubRecoverySnapshot,
  type ProjectHubRecoveryMemory,
  type ProjectHubRecoverySection,
} from '../project-hub/recovery.js';
import {
  PROJECT_HUB_PROJECTION_SCHEMA_VERSION,
  composeProjectHubVisualTriageProjection,
  renderProjectHubVisualTriageBase,
  renderProjectHubVisualTriageCanvas,
  renderProjectHubVisualTriageText,
  type ProjectHubProjectionInput,
  type ProjectHubVisualTriageProjection,
} from '../project-hub/index.js';
import {
  authoritativeHeadDiagnostics,
  blockedByRefs,
  cardLabel,
  currentAuthoritativeHeads,
  hasUnresolvedBlocker,
  scanWorkNotes,
  workState,
} from './workos.js';
import { isCanonicalWorkItemId, isCanonicalWorkRunId, readWorkflowState } from '../workflow/workflow.js';
import {
  normalizedProjectContext,
  resolveProjectContext,
  type ProjectContext,
} from './project-context.js';

type Health = 'healthy' | 'degraded' | 'unavailable' | 'empty';

interface HubSection<T> {
  owner: string;
  freshness: string | null;
  health: Health;
  drift: string[];
  data: T;
  citationTargets?: string[];
}

export interface ProjectHubOperationsOptions {
  now?: () => number;
  loadVisualTriage?: (request: {
    projectId: string;
    generatedAt: string;
    vaultPath: string;
  }) => Promise<unknown> | unknown;
  loadProjectMemory?: (request: {
    projectId: string;
    generatedAt: string;
    vaultPath: string;
  }) => Promise<unknown> | unknown;
}

interface FileSummary {
  path: string;
  modifiedAt: string;
}

function filesBelow(vaultPath: string, root: string): FileSummary[] {
  const fullRoot = join(vaultPath, root);
  if (!existsSync(fullRoot)) return [];
  const out: FileSummary[] = [];
  if (statSync(fullRoot).isFile()) {
    return [{ path: root.replaceAll('\\', '/'), modifiedAt: statSync(fullRoot).mtime.toISOString() }];
  }
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) {
        out.push({
          path: relative(vaultPath, fullPath).replaceAll('\\', '/'),
          modifiedAt: statSync(fullPath).mtime.toISOString(),
        });
      }
    }
  };
  visit(fullRoot);
  return out;
}

function newest(files: FileSummary[]): string | null {
  return files.reduce<string | null>((latest, file) => !latest || file.modifiedAt > latest ? file.modifiedAt : latest, null);
}

function section<T>(owner: string, files: FileSummary[], data: T, drift: string[] = []): HubSection<T> {
  return {
    owner,
    freshness: newest(files),
    health: drift.length > 0 ? 'degraded' : files.length > 0 ? 'healthy' : 'empty',
    drift,
    data,
    citationTargets: files.map((file) => file.path).sort(),
  };
}

function frontmatterValue(content: string, key: string): string | null {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? null;
}

function workSection(vaultPath: string, context: ProjectContext): HubSection<Record<string, unknown>> {
  const files = filesBelow(vaultPath, context.roots.workOs);
  const issues = files.filter((file) => file.path.includes('/issues/') && file.path.endsWith('.md'));
  const states: Record<string, number> = {};
  for (const issue of issues) {
    const status = frontmatterValue(readFileSync(join(vaultPath, issue.path), 'utf-8'), 'status') ?? 'unknown';
    states[status] = (states[status] ?? 0) + 1;
  }
  const anchor = files.find((file) => file.path.endsWith('/_project.md'));
  const projectPrefix = `${context.projectId}/issue/`;
  const workNotes = scanWorkNotes(vaultPath).filter((note) => note.entity?.startsWith(projectPrefix));
  const authoritative = currentAuthoritativeHeads(workNotes)
    .filter((note) => note.entity?.startsWith(projectPrefix) && !note.entity.endsWith('/project'))
    .map((note) => ({
      entity: note.entity!,
      label: cardLabel(note),
      state: workState(note.raw),
      blockedBy: hasUnresolvedBlocker(workNotes, note.entity!) ? blockedByRefs(note.raw) : [],
      citationTargets: [note.note_id],
    }));
  const drift = [
    ...(anchor ? [] : ['missing_work_os_anchor']),
    ...authoritativeHeadDiagnostics(workNotes).map((item) => `${item.code}:${item.entity}`),
    ...(issues.length > 0 && authoritative.length === 0 ? ['work_os_authoritative_items_unavailable'] : []),
  ];
  return section('work-os', files, {
    root: context.roots.workOs,
    anchor: anchor?.path ?? null,
    issueCount: issues.length,
    states,
    authoritativeItems: authoritative,
  }, drift);
}

function knowledgeSection(vaultPath: string, context: ProjectContext): HubSection<Record<string, unknown>> {
  const files = filesBelow(vaultPath, context.roots.knowledge);
  const markdown = files.filter((file) => file.path.endsWith('.md'));
  return section('knowledge', files, { root: context.roots.knowledge, itemCount: markdown.length });
}

function aliasedRunField(
  raw: Record<string, unknown>,
  canonical: string,
  legacy: string,
  path: string,
  drift: string[],
): unknown {
  const current = raw[canonical];
  const previous = raw[legacy];
  if (current !== undefined && previous !== undefined && current !== previous) {
    drift.push(`run_${canonical}_conflict:${path}`);
    return undefined;
  }
  return current ?? previous;
}

function runtimeSection(vaultPath: string, context: ProjectContext, observedAt = Date.now()): HubSection<Record<string, unknown>> {
  const runFiles = filesBelow(vaultPath, `${context.roots.workOs}/runs`).filter((file) => file.path.endsWith('.json'));
  const agentFiles = filesBelow(vaultPath, `${context.roots.workOs}/agents`);
  const workflowFiles = filesBelow(vaultPath, `${context.roots.workOs}/workflow/status.md`);
  const runs: Array<Record<string, unknown>> = [];
  const drift: string[] = [];
  for (const file of runFiles) {
    try {
      const raw = JSON.parse(readFileSync(join(vaultPath, file.path), 'utf-8')) as Record<string, unknown>;
      const runProjectId = aliasedRunField(raw, 'projectId', 'project_id', file.path, drift);
      if (typeof runProjectId !== 'string') {
        drift.push(`run_project_id_missing:${file.path}`);
        continue;
      }
      if (runProjectId !== context.projectId) {
        drift.push(`run_project_mismatch:${file.path}`);
        continue;
      }
      const workRunId = aliasedRunField(raw, 'workRunId', 'work_run_id', file.path, drift);
      const validWorkRunId = isCanonicalWorkRunId(workRunId);
      if (!validWorkRunId) drift.push(`run_work_id_invalid:${file.path}`);
      const workItemId = aliasedRunField(raw, 'workItemId', 'work_item_id', file.path, drift);
      const validWorkItemId = isCanonicalWorkItemId(workItemId) && workItemId.startsWith(`${context.projectId}/`);
      if (!validWorkItemId) drift.push(`run_work_item_id_invalid:${file.path}`);
      const expiryValues = [
        raw.leaseExpiresAt,
        raw.lease_expires_at,
        raw.handoffExpiresAt,
        raw.handoff_expires_at,
        raw.expiresAt,
        raw.expires_at,
      ].filter((value): value is string => value !== undefined).map(String);
      const expiry = expiryValues[0];
      const expiryConflict = expiryValues.some((value) => value !== expiry);
      if (expiryConflict) drift.push(`run_expiry_conflict:${file.path}`);
      const expiryMs = expiry ? Date.parse(expiry) : Number.NaN;
      const validExpiry = !expiry || (!expiryConflict && Number.isFinite(expiryMs));
      if (expiry && !Number.isFinite(expiryMs)) drift.push(`run_expiry_invalid:${file.path}`);
      const stale = Boolean(expiry) && Number.isFinite(expiryMs) && expiryMs <= observedAt;
      if (stale) drift.push(`expired_work_run:${file.path}`);
      runs.push({
        projectId: runProjectId,
        workRunId: validWorkRunId ? workRunId : null,
        state: raw.state ?? null,
        stage: raw.stage ?? raw.agentStage ?? null,
        workItemId: validWorkItemId ? workItemId : null,
        resumable: validWorkRunId && validWorkItemId && validExpiry,
        path: file.path,
        stale,
        citationTargets: [file.path],
      });
    } catch {
      drift.push(`malformed_run:${file.path}`);
    }
  }
  let workflowState;
  try {
    workflowState = readWorkflowState(vaultPath, context.slug);
  } catch {
    workflowState = null;
    drift.push('malformed_workflow_state');
  }
  const activeStates = new Set(['planned', 'leased', 'running', 'awaiting_review']);
  const activeRuns = runs.filter((run) => activeStates.has(String(run.state)) && run.stale !== true);
  const stagedRun = activeRuns.find((run) => run.resumable === true && typeof run.stage === 'string' && run.stage.trim());
  return section('runtime', [...runFiles, ...agentFiles, ...workflowFiles], {
    activeRuns,
    staleRuns: runs.filter((run) => run.stale === true),
    runCount: runs.length,
    agentStateFiles: agentFiles.map((file) => file.path),
    workflowState: workflowState
      ? { stage: workflowState.stage, objective: workflowState.objective, path: workflowState.path }
      : null,
    stage: workflowState?.stage ?? (typeof stagedRun?.stage === 'string' ? stagedRun.stage : null),
    stageCitation: workflowState?.path ?? (typeof stagedRun?.path === 'string' ? stagedRun.path : null),
  }, drift);
}

function redactedEffectiveSetting(service: SettingsService, item: EffectiveSetting): Record<string, unknown> {
  const sensitivity = service.registry.definitions.find((definition) => definition.key === item.key)?.sensitivity;
  return {
    ...item,
    value: sensitivity === 'local'
      ? { redacted: true, configured: item.value !== null && item.value !== '' }
      : item.value,
    overriddenCandidates: item.overriddenCandidates.map((candidate) => ({
      ...candidate,
      value: sensitivity === 'local'
        ? { redacted: true, configured: candidate.value !== null && candidate.value !== '' }
        : candidate.value,
    })),
  };
}

async function settingsSection(
  service: SettingsService,
  project: ProjectContext,
): Promise<HubSection<Record<string, unknown>>> {
  try {
    const context = { ...service.defaultContext, workspaceProjectId: project.projectId };
    const resolved = await service.snapshotResolve(context);
    const effective = resolved.snapshot.effective.map((item) => redactedEffectiveSetting(service, item));
    const data = {
      schemaVersion: 1,
      snapshotId: resolved.snapshot.snapshotId,
      registryVersion: resolved.snapshot.registryVersion,
      context: resolved.snapshot.context,
      sourceRevisions: resolved.snapshot.sourceRevisions,
      effective,
      validation: resolved.validation,
      recoveryDiagnostics: resolved.recoveryDiagnostics,
    };
    const drift = [
      ...resolved.validation.issues.map((issue) => issue.code),
      ...resolved.recoveryDiagnostics.map((issue) => issue.code),
    ];
    return {
      owner: 'settings-platform',
      freshness: resolved.snapshot.createdAt,
      health: drift.length > 0 ? 'degraded' : 'healthy',
      drift: [...new Set(drift)].sort(),
      data: {
        ...data,
        snapshotHash: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
      },
    };
  } catch (error) {
    return {
      owner: 'settings-platform',
      freshness: null,
      health: 'unavailable',
      drift: ['settings_unavailable'],
      data: { error: (error as Error).message },
    };
  }
}

function capabilitySection(registry: AdapterRegistry): HubSection<Record<string, unknown>> {
  const adapters = registry.list().map((adapter) => ({
    name: adapter.name,
    capabilities: [...adapter.capabilities].sort(),
    available: adapter.isAvailable !== false,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const unavailable = adapters.filter((adapter) => !adapter.available).map((adapter) => `adapter_unavailable:${adapter.name}`);
  return {
    owner: 'capability-registry',
    freshness: null,
    health: unavailable.length ? 'degraded' : adapters.length ? 'healthy' : 'empty',
    drift: unavailable,
    data: { adapters },
  };
}

function workspaceSection(context: ProjectContext): HubSection<Record<string, unknown>> {
  if (!context.workspace) {
    return { owner: 'workspace-binding', freshness: null, health: 'empty', drift: ['workspace_not_bound'], data: { binding: null } };
  }
  return {
    owner: 'workspace-binding',
    freshness: null,
    health: context.workspace.available ? 'healthy' : 'unavailable',
    drift: context.workspace.available ? [] : ['workspace_unavailable'],
    data: { binding: { configured: true, available: context.workspace.available } },
  };
}

function integrationSection(context: ProjectContext): HubSection<Record<string, unknown>> {
  const projections = context.projections.map((projection) => ({ ...projection, stateOwner: 'provider', copiedState: false }));
  return {
    owner: 'external-provider',
    freshness: null,
    health: projections.length ? 'degraded' : 'empty',
    drift: projections.map((projection) => `projection_unverified:${projection.kind}`),
    data: { projections },
  };
}

function usageSection(vaultPath: string, context: ProjectContext): HubSection<Record<string, unknown>> {
  const root = '_llmwiki/usage/v1';
  const files = filesBelow(vaultPath, root).filter((file) => file.path.endsWith('.json'));
  try {
    const projection = projectUsage(new UsageLedger(join(vaultPath, ...root.split('/'))).list(), {
      filters: { project: context.projectId },
      groupBy: ['agent', 'provider', 'model', 'device', 'operation'],
    });
    return section('usage-ledger', files, {
      root,
      projection,
      chartReady: false,
      presentationOwner: 'obsidian-plugin',
    });
  } catch (error) {
    return {
      owner: 'usage-ledger',
      freshness: newest(files),
      health: 'unavailable',
      drift: ['usage_ledger_invalid'],
      data: { root, error: (error as Error).message },
    };
  }
}

function hostCapabilitySection(vaultPath: string, context: ProjectContext): HubSection<Record<string, unknown>> {
  const files = filesBelow(vaultPath, HOST_CAPABILITY_RELATIVE_ROOT).filter((file) => file.path.endsWith('.json'));
  try {
    const store = new HostCapabilityStore(vaultPath);
    const descriptors = store.listDescriptors();
    const connectors = store.listConnectors();
    const assignments = store.listAssignmentPlans().filter((plan) => plan.projectId === context.projectId);
    const drift = [
      ...descriptors.flatMap((item) => item.health.state === 'available'
        ? []
        : [`descriptor_${item.health.state}:${item.descriptor.descriptorId}`]),
      ...connectors.flatMap((item) => item.health.state === 'available'
        ? []
        : [`connector_${item.health.state}:${item.connector.connectorId}`]),
      ...connectors.flatMap((item) => item.configuration.secretRequired && !item.configuration.secretReference
        ? [`secret_reference_missing:${item.connector.connectorId}`]
        : []),
    ].sort();
    return section('host-capabilities', files, {
      root: HOST_CAPABILITY_RELATIVE_ROOT,
      descriptors: descriptors.map((item) => ({
        descriptorId: item.descriptor.descriptorId,
        descriptorVersion: item.descriptor.descriptorVersion,
        displayName: item.descriptor.displayName,
        capabilities: item.descriptor.capabilities,
        health: item.health.state,
        connectorRef: item.descriptor.connectorRef,
      })),
      connectors: connectors.map((item) => ({
        connectorId: item.connector.connectorId,
        connectorVersion: item.connector.connectorVersion,
        displayName: item.connector.displayName,
        kind: item.connector.kind,
        transport: item.connector.transport,
        health: item.health.state,
        secretReferenceConfigured: Boolean(item.configuration.secretReference),
      })),
      assignments: assignments.map((plan) => ({
        planId: plan.planId,
        workRunId: plan.workRunId,
        approval: plan.approval.status,
        selection: plan.selected,
        planFingerprint: fingerprintContract(plan),
      })),
      externalConnectionsOpened: 0,
    }, drift);
  } catch (error) {
    return {
      owner: 'host-capabilities',
      freshness: newest(files),
      health: 'unavailable',
      drift: ['host_capability_state_invalid'],
      data: {
        root: HOST_CAPABILITY_RELATIVE_ROOT,
        externalConnectionsOpened: 0,
        error: (error as Error).message,
      },
    };
  }
}

async function agentDomainSection(vaultPath: string, context: ProjectContext): Promise<HubSection<Record<string, unknown>>> {
  const root = '_llmwiki/agent-domain/v1';
  const files = filesBelow(vaultPath, root).filter((file) => file.path.endsWith('.json'));
  try {
    const stateRoot = join(vaultPath, ...root.split('/'));
    const projectId = context.projectId as AgentProjectId;
    const service = new AgentDomainService({ stateRoot });
    const bindings = await service.bindings.list({ projectId });
    const threads = await service.threads.list({ projectId });
    const expectedProjectFingerprint = canonicalDigest(normalizedProjectContext(context));
    const drift: string[] = [];
    const profiles: Array<Record<string, unknown> & { profileId: string }> = [];
    const dreamTime: Array<Record<string, unknown>> = [];

    for (const binding of bindings) {
      const profile = await service.profiles.readRevision(binding.profileId, binding.profileRevision);
      if (!profile) drift.push(`profile_revision_missing:${binding.profileId}@${binding.profileRevision}`);
      else profiles.push({
        profileId: profile.profileId,
        revision: profile.revision,
        displayName: profile.displayName,
        role: profile.role,
        capabilityClaims: profile.capabilityClaims,
        modelMode: profile.defaultModelPolicy.mode,
      });
      if (!binding.enabled) drift.push(`binding_disabled:${binding.bindingId}`);
      if (binding.projectContextFingerprint !== expectedProjectFingerprint) {
        drift.push(`binding_project_context_stale:${binding.bindingId}`);
      }

      const memory = new DreamTimeStore({
        memoryRoot: join(stateRoot, 'dreamtime'),
        projectId,
        profileId: binding.profileId,
      });
      const revisions = await memory.listRevisions();
      const events = await memory.listEvents();
      const proposalDirectory = join(
        stateRoot,
        'dreamtime',
        context.slug,
        binding.profileId.slice('agent/'.length),
        'proposals',
      );
      const proposals: Array<Record<string, unknown>> = [];
      const proposalFiles = existsSync(proposalDirectory)
        ? readdirSync(proposalDirectory).filter((file) => file.endsWith('.json')).sort()
        : [];
      for (const file of proposalFiles) {
        const proposalId = `memory-proposal/${file.slice(0, -'.json'.length)}` as MemoryProposalId;
        const proposal = await memory.readProposal(proposalId);
        if (!proposal) continue;
        const decision = await memory.readDecision(proposalId);
        if (proposal.unresolvedConflicts.length > 0) drift.push(`memory_conflict:${proposalId}`);
        proposals.push({
          proposalId,
          operation: proposal.operation,
          lifecycle: decision?.state ?? proposal.lifecycle,
          fingerprint: proposal.fingerprint,
          warningCount: proposal.warnings.length,
          conflictCount: proposal.unresolvedConflicts.length,
          modelLock: proposal.modelLock,
          provenance: proposal.provenance,
          createdAt: proposal.createdAt,
          expiresAt: proposal.expiresAt,
        });
      }
      dreamTime.push({
        profileId: binding.profileId,
        approvedMemory: revisions.at(-1)
          ? {
              revisionId: revisions.at(-1)!.revisionId,
              revision: revisions.at(-1)!.revision,
              fingerprint: revisions.at(-1)!.fingerprint,
            }
          : null,
        revisionCount: revisions.length,
        eventCount: events.length,
        proposals,
      });
    }

    const collaborationFiles = files.filter((file) => file.path.includes('/collaboration/'));
    const consultRecords = collaborationFiles.filter((file) => file.path.includes('/consults/'));
    const delegationRecords = collaborationFiles.filter((file) => file.path.includes('/delegations/'));
    return section('agent-domain', files, {
      root,
      projectId: context.projectId,
      profiles: profiles.sort((left, right) => left.profileId.localeCompare(right.profileId)),
      bindings: bindings.map((binding) => ({
        bindingId: binding.bindingId,
        revision: binding.revision,
        profileId: binding.profileId,
        profileRevision: binding.profileRevision,
        role: binding.role,
        enabled: binding.enabled,
        projectContextFingerprint: binding.projectContextFingerprint,
        connectorGrantRefs: binding.connectorGrantRefs,
      })),
      threads: threads.map((thread) => ({
        threadId: thread.threadId,
        revision: thread.revision,
        lifecycle: thread.lifecycle,
        profileId: thread.profileId,
        bindingId: thread.bindingId,
        relatedWorkRunIds: thread.references
          .filter((reference) => reference.kind === 'workRun')
          .map((reference) => reference.referenceId),
      })),
      dreamTime,
      collaboration: {
        consultRecordCount: consultRecords.length,
        delegationRecordCount: delegationRecords.length,
      },
    }, [...new Set(drift)].sort());
  } catch (error) {
    return {
      owner: 'agent-domain',
      freshness: newest(files),
      health: 'unavailable',
      drift: ['agent_domain_state_invalid'],
      data: { root, error: (error as Error).message },
    };
  }
}

async function visualTriageProjection(
  ctx: OperationContext,
  project: ProjectContext,
  generatedAt: string,
  options: ProjectHubOperationsOptions,
): Promise<ProjectHubVisualTriageProjection> {
  const empty: ProjectHubProjectionInput = {
    schemaVersion: PROJECT_HUB_PROJECTION_SCHEMA_VERSION,
    projectId: project.projectId,
    generatedAt,
    visualDocuments: [],
    observations: [],
    providerHealth: [],
  };
  const loaded = options.loadVisualTriage
    ? await options.loadVisualTriage({
        projectId: project.projectId,
        generatedAt,
        vaultPath: ctx.config.vault_path,
      })
    : empty;
  return composeProjectHubVisualTriageProjection(loaded);
}

function visualHubSection(
  projection: ProjectHubVisualTriageProjection,
): HubSection<ProjectHubVisualTriageProjection['sections']['visual']> {
  const data = projection.sections.visual;
  const drift = data.documents.flatMap((document) => [
    ...(document.sourceFreshness === 'current'
      ? []
      : [`map_source_${document.sourceFreshness}:${document.documentId}`]),
    ...(document.projectionStatus === 'current'
      ? []
      : [`map_projection_${document.projectionStatus}:${document.documentId}`]),
  ]).sort();
  return {
    owner: data.owner,
    freshness: data.documents.reduce<string | null>(
      (latest, document) =>
        !latest || document.sourceObservedAt > latest
          ? document.sourceObservedAt
          : latest,
      null,
    ),
    health: data.health,
    drift,
    data,
  };
}

function triageHubSection(
  projection: ProjectHubVisualTriageProjection,
): HubSection<ProjectHubVisualTriageProjection['sections']['triage']> {
  const data = projection.sections.triage;
  const drift = [
    ...data.providers.flatMap((provider) => [
      ...(provider.freshness === 'current'
        ? []
        : [`provider_${provider.freshness}:${provider.providerId}`]),
      ...(provider.health === 'available'
        ? []
        : [`provider_${provider.health}:${provider.providerId}`]),
    ]),
    ...data.observations.flatMap((observation) =>
      observation.trace.verifications
        .filter((verification) => verification.status === 'failed')
        .map(() => `verification_failed:${observation.observationId}`)),
  ].sort();
  return {
    owner: data.owner,
    freshness: [
      ...data.observations.map((observation) => observation.lastObservedAt),
      ...data.providers.flatMap((provider) =>
        provider.observedAt ? [provider.observedAt] : []),
    ].reduce<string | null>(
      (latest, observedAt) =>
        !latest || observedAt > latest ? observedAt : latest,
      null,
    ),
    health: data.health,
    drift,
    data,
  };
}

function projectReference(params: Record<string, unknown>): string {
  const reference = params.ref ?? params.project;
  if (typeof reference !== 'string' || !reference.trim()) {
    throw badRequest('ref or project is required');
  }
  return reference;
}
function recoveryMemory(
  projection: ProjectContextProjection | null,
  unavailable: boolean,
): ProjectHubRecoveryMemory {
  if (!projection) {
    return {
      schemaVersion: null,
      revision: null,
      fingerprint: null,
      freshness: unavailable ? 'unavailable' : 'missing',
      authority: 'unknown',
      reviewedClaimCount: 0,
      currentClaimCount: 0,
      conflictCount: 0,
      sessions: [],
    };
  }
  const claims = [
    ...projection.sections.goal,
    ...projection.sections.currentState,
    ...projection.sections.completed,
    ...projection.sections.openWork,
    ...projection.sections.relations,
  ];
  return {
    schemaVersion: projection.schemaVersion,
    revision: projection.revision,
    fingerprint: projection.fingerprint,
    freshness: projection.freshness.state,
    authority: projection.authority.state,
    reviewedClaimCount: claims.filter((claim) => claim.reviewStatus !== 'draft').length,
    currentClaimCount: claims.filter((claim) => claim.reviewStatus !== 'draft' && claim.state === 'current').length,
    conflictCount: projection.sections.conflicts.length,
    sessions: projection.sections.sessions.map((session) => ({
      sessionId: session.sessionId,
      status: session.status,
      freshness: session.freshness,
      citationTargets: session.evidenceRefs.map((evidence) => evidence.ref),
    })),
  };
}
function assertProjectMemoryProjection(value: unknown, projectId: string): ProjectContextProjection {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Project Memory projection is malformed');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 'project-context/v1' || candidate.projectId !== projectId || candidate.readOnly !== true) {
    throw new Error('Project Memory projection identity is invalid');
  }
  if (typeof candidate.fingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(candidate.fingerprint)) {
    throw new Error('Project Memory projection fingerprint is invalid');
  }
  const sections = candidate.sections;
  if (sections === null || typeof sections !== 'object' || Array.isArray(sections)) {
    throw new Error('Project Memory projection sections are malformed');
  }
  const sectionRecord = sections as Record<string, unknown>;
  const claimSections = ['goal', 'currentState', 'completed', 'openWork', 'relations'];
  for (const key of [...claimSections, 'conflicts', 'sessions']) {
    if (!Array.isArray(sectionRecord[key])) throw new Error(`Project Memory projection section ${key} is malformed`);
  }
  const freshness = candidate.freshness;
  if (freshness === null || typeof freshness !== 'object' || Array.isArray(freshness)) throw new Error('Project Memory freshness is malformed');
  if (!['current', 'stale', 'unknown'].includes((freshness as Record<string, unknown>).state as string)) throw new Error('Project Memory freshness state is invalid');
  const authority = candidate.authority;
  if (authority === null || typeof authority !== 'object' || Array.isArray(authority)) throw new Error('Project Memory authority is malformed');
  if (!['source', 'derived', 'unknown'].includes((authority as Record<string, unknown>).state as string)) throw new Error('Project Memory authority state is invalid');
  for (const [index, rawConflict] of (sectionRecord.conflicts as unknown[]).entries()) {
    if (rawConflict === null || typeof rawConflict !== 'object' || Array.isArray(rawConflict)) throw new Error(`Project Memory conflict[${index}] is malformed`);
    const conflict = rawConflict as Record<string, unknown>;
    if (typeof conflict.conflictId !== 'string' || !Array.isArray(conflict.claims)) throw new Error(`Project Memory conflict[${index}] is invalid`);
  }
  for (const key of claimSections) {
    for (const [index, rawClaim] of (sectionRecord[key] as unknown[]).entries()) {
      if (rawClaim === null || typeof rawClaim !== 'object' || Array.isArray(rawClaim)) throw new Error(`Project Memory claim ${key}[${index}] is malformed`);
      const claim = rawClaim as Record<string, unknown>;
      for (const field of ['claimId', 'key', 'sourceId']) {
        if (typeof claim[field] !== 'string' || !claim[field].trim()) throw new Error(`Project Memory claim ${key}[${index}].${field} is malformed`);
      }
      if (!['draft', 'reviewed', 'promoted'].includes(claim.reviewStatus as string)) throw new Error(`Project Memory claim ${key}[${index}].reviewStatus is invalid`);
      if (!['current', 'superseded', 'stale', 'unresolved'].includes(claim.state as string)) throw new Error(`Project Memory claim ${key}[${index}].state is invalid`);
      if (!Array.isArray(claim.evidenceRefs)) throw new Error(`Project Memory claim ${key}[${index}].evidenceRefs is malformed`);
    }
  }
  for (const [index, rawSession] of (sectionRecord.sessions as unknown[]).entries()) {
    if (rawSession === null || typeof rawSession !== 'object' || Array.isArray(rawSession)) throw new Error(`Project Memory session[${index}] is malformed`);
    const session = rawSession as Record<string, unknown>;
    for (const field of ['sessionId', 'status', 'freshness']) {
      if (typeof session[field] !== 'string' || !session[field].trim()) throw new Error(`Project Memory session[${index}].${field} is malformed`);
    }
    if (!['current', 'stale', 'unknown'].includes(session.freshness as string) || !Array.isArray(session.evidenceRefs)) throw new Error(`Project Memory session[${index}] freshness or evidence is invalid`);
  }
  return value as ProjectContextProjection;
}

export async function composeProjectHub(
  ctx: OperationContext,
  registry: AdapterRegistry,
  reference: string,
  settingsService = createSettingsService({ vaultPath: ctx.config.vault_path }),
  options: ProjectHubOperationsOptions = {},
): Promise<Record<string, unknown>> {
  const project = resolveProjectContext(ctx.config.vault_path, reference, 'project.hub.get');
  const generatedAt = new Date(options.now?.() ?? Date.now()).toISOString();
  const registryFiles = filesBelow(ctx.config.vault_path, project.roots.registryRecord);
  const visualTriage = await visualTriageProjection(
    ctx,
    project,
    generatedAt,
    options,
  );
  const sections = {
    identity: section('project-registry', registryFiles, {
      projectId: project.projectId,
      slug: project.slug,
      lifecycle: project.lifecycle,
      aliases: project.aliases,
      registryRecord: project.roots.registryRecord,
    }, project.diagnostics.filter((item) => item.severity !== 'info').map((item) => item.code)),
    work: workSection(ctx.config.vault_path, project),
    knowledge: knowledgeSection(ctx.config.vault_path, project),
    runtime: runtimeSection(ctx.config.vault_path, project, Date.parse(generatedAt)),
    settings: await settingsSection(settingsService, project),
    capabilities: capabilitySection(registry),
    workspace: workspaceSection(project),
    integrations: integrationSection(project),
    hostCapabilities: hostCapabilitySection(ctx.config.vault_path, project),
    usage: usageSection(ctx.config.vault_path, project),
    agents: await agentDomainSection(ctx.config.vault_path, project),
    visual: visualHubSection(visualTriage),
    triage: triageHubSection(visualTriage),
  };
  const memoryDiagnostics = durableProjectMemoryDiagnostics(ctx.config.vault_path, project.projectId);
  let memoryProjection: ProjectContextProjection | null = null;
  let memoryUnavailable = false;
  try {
    memoryProjection = assertProjectMemoryProjection(await (
      options.loadProjectMemory
        ? options.loadProjectMemory({
            projectId: project.projectId,
            generatedAt,
            vaultPath: ctx.config.vault_path,
          })
        : projectContextFromSource(
            createDurableProjectMemorySource(ctx.config.vault_path),
            project.projectId,
            { generatedAt },
          )
    ), project.projectId);
  } catch {
    memoryProjection = null;
    memoryUnavailable = true;
  }
  const recovery = composeProjectHubRecoverySnapshot({
    projectId: project.projectId,
    generatedAt,
    projectDiagnostics: project.diagnostics,
    sections: sections as Record<string, ProjectHubRecoverySection>,
    memory: recoveryMemory(memoryProjection, memoryUnavailable),
    memoryDiagnostics,
  });
  return {
    projectId: project.projectId,
    slug: project.slug,
    lifecycle: project.lifecycle,
    generatedAt,
    readOnly: true,
    diagnostics: project.diagnostics,
    sections,
    recovery,
    mutationRoutes: {
      identity: 'project.init',
      work: 'project.issue.* / workflow.agent.*',
      knowledge: 'source.register / memory.*',
      settings: 'settings owner (backend configuration)',
      integrations: 'provider-owned operations',
      hostCapabilities: 'host.descriptor.* / host.connector.* / host.assignment.*',
      usage: 'usage.append / usage.policy.evaluate',
      agents: 'agent.* / dreamtime.* / consult.* / delegation.*',
      visual: visualTriage.mutationRoutes.maps,
      triage: `${visualTriage.mutationRoutes.observations} / ${visualTriage.mutationRoutes.issuePlans} / ${visualTriage.mutationRoutes.contributions}`,
      localIssues: visualTriage.mutationRoutes.localIssues,
      remoteContributions: visualTriage.mutationRoutes.remoteMutations,
    },
  };
}

export function makeProjectHubOps(
  registry: AdapterRegistry,
  settingsService?: SettingsService,
  options: ProjectHubOperationsOptions = {},
): Operation[] {
  const get: Operation = {
    name: 'project.hub.get',
    namespace: 'project',
    description: 'Compose a read-only Project Hub from registry, Work-OS, knowledge, runtime, settings, capabilities, workspace, and provider-owned integrations.',
    mutating: false,
    params: {
      ref: { type: 'string', required: false, description: 'Canonical Project ID, registered alias/slug, or bound workspace path' },
      project: { type: 'string', required: false, description: 'Compatibility alias for ref' },
    },
    handler: async (ctx, params) => {
      return composeProjectHub(
        ctx,
        registry,
        projectReference(params),
        settingsService,
        options,
      );
    },
  };
  const derived = (
    name: string,
    description: string,
    render: (projection: ProjectHubVisualTriageProjection) => unknown,
    format: string,
  ): Operation => ({
    name,
    namespace: 'project',
    description,
    mutating: false,
    params: {
      ref: { type: 'string', required: false },
      project: { type: 'string', required: false },
    },
    handler: async (ctx, params) => {
      const reference = projectReference(params);
      const project = resolveProjectContext(
        ctx.config.vault_path,
        reference,
        name,
      );
      const generatedAt = new Date(options.now?.() ?? Date.now()).toISOString();
      const projection = await visualTriageProjection(
        ctx,
        project,
        generatedAt,
        options,
      );
      return {
        projectId: project.projectId,
        generatedAt,
        readOnly: true,
        format,
        projection: render(projection),
      };
    },
  });
  return [
    get,
    derived(
      'project.hub.text',
      'Render the read-only Project Hub visual and problem trace as Markdown.',
      renderProjectHubVisualTriageText,
      'markdown',
    ),
    derived(
      'project.hub.base',
      'Render the read-only Project Hub problem triage as an Obsidian Base projection.',
      renderProjectHubVisualTriageBase,
      'obsidian-base',
    ),
    derived(
      'project.hub.canvas',
      'Render the read-only Project Hub visual, issue, contribution, Work Run, and verification trace as Obsidian Canvas JSON.',
      renderProjectHubVisualTriageCanvas,
      'obsidian-canvas',
    ),
  ];
}
