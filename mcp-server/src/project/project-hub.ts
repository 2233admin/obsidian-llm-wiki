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
import { createSettingsService } from '../settings/settings.js';
import { UsageLedger } from '../usage/ledger.js';
import { projectUsage } from '../usage/projections.js';
import { HOST_CAPABILITY_RELATIVE_ROOT, HostCapabilityStore } from '../host-capabilities/store.js';
import { fingerprintContract } from '../host-capabilities/contracts.js';
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
import { createWorkflowReadModel } from '../workflow/workflow-read-model.js';
import { createDurableProjectMemorySource } from '../core/project-memory-operations.js';
import { projectContextFromSource } from '../project-memory/index.js';
import {
  composeRecoveryOpenStage,
  type RecoveryOpenOwners,
} from '../project-hub/recovery-open.js';
import { searchRecovery, type RecoverySearchDependencies } from '../project-hub/search.js';
import { createProjectSearchSource, type ProjectSearchSource } from '../project-hub/search-source.js';
import { createAgentSelectionSource, type RecoveryAgentSelectionSource } from '../project-hub/agent-selection.js';
import { composeRecoveryPlannedStage } from '../project-hub/action-plan.js';
import {
  RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
  validateRecoveryFlowRequestV2,
  type RecoveryFlowRequestV2,
} from '../project-hub/recovery-flow.js';
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
  recoveryFlow?: {
    now?: () => number;
    openOwners?: RecoveryOpenOwners;
    searchSource?: ProjectSearchSource;
    agentSelection?: RecoveryAgentSelectionSource;
  };
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

function defaultRecoveryOwners(vaultPath: string, registry: AdapterRegistry): RecoveryOpenOwners {
  const memorySource = createDurableProjectMemorySource(vaultPath);
  return {
    workflow: createWorkflowReadModel(vaultPath),
    loadWorkItems: (projectId) => scanWorkNotes(vaultPath)
      .filter((note) => note.entity?.startsWith(`${projectId}/issue/`) && note.entity !== `${projectId}/issue/project`)
      .map((note) => ({
        entity: note.entity!,
        label: cardLabel(note),
        state: workState(note.raw),
        blockedBy: hasUnresolvedBlocker(scanWorkNotes(vaultPath), note.entity!) ? blockedByRefs(note.raw) : [],
        citationTargets: [note.note_id],
        currentStage: null,
      })),
    loadProjectMemory: async (projectId) => {
      const context = await projectContextFromSource(memorySource, projectId);
      const claims = [
        ...context.sections.goal,
        ...context.sections.currentState,
        ...context.sections.completed,
        ...context.sections.openWork,
        ...context.sections.relations,
      ];
      return {
        projectId,
        revision: context.revision,
        fingerprint: context.fingerprint as `sha256:${string}`,
        freshness: context.freshness.state,
        reviewedDecisions: claims.map((claim) => ({
          decisionId: claim.claimId,
          text: typeof claim.value === 'string' ? claim.value : JSON.stringify(claim.value),
          citationTargets: claim.evidenceRefs.map((reference) => reference.ref),
          reviewStatus: claim.reviewStatus,
          state: claim.state,
        })),
        citationTargets: context.evidenceRefs.map((reference) => reference.ref),
      };
    },
    listSessions: async (projectId) => (await memorySource.listSessions(projectId)).flatMap((session) => {
      const workItemId = (session as typeof session & { workItemId?: unknown }).workItemId;
      return typeof workItemId === 'string' ? [{ sessionId: session.sessionId, projectId: session.projectId, workItemId, capturedAt: session.capturedAt ?? null, status: session.status, revision: session.revision ?? null, citationTargets: (session.sourceRefs ?? []).map((reference) => typeof reference === 'string' ? reference : reference.ref) }] : [];
    }),
    // S04B owns the apply Operation; this read-only adapter must not claim it.
    loadCapabilities: async () => [],
  };
}

function defaultRecoverySearchSource(vaultPath: string): ProjectSearchSource {
  return createProjectSearchSource({
    'work-os': (projectId) => scanWorkNotes(vaultPath)
      .filter((note) => note.entity?.startsWith(`${projectId}/issue/`) && note.entity !== `${projectId}/issue/project`)
      .map((note) => ({ itemId: note.entity!, itemType: 'issue', label: cardLabel(note), text: note.body || cardLabel(note), projectId, citationTargets: [note.note_id], provenance: 'work-os' })),
  });
}

function defaultRecoveryAgentSelection(vaultPath: string): RecoveryAgentSelectionSource {
  return createAgentSelectionSource(async (projectId, capabilities) => {
    const service = new AgentDomainService({ stateRoot: join(vaultPath, '_llmwiki', 'agent-domain', 'v1') });
    const bindings = await service.bindings.list({ projectId: projectId as AgentProjectId });
    const expectedContext = resolveProjectContext(vaultPath, projectId, 'project.hub.recovery.flow');
    const expectedFingerprint = canonicalDigest(normalizedProjectContext(expectedContext));
    const records = [];
    for (const binding of bindings) {
      const profile = await service.profiles.readRevision(binding.profileId, binding.profileRevision);
      if (!profile) continue;
      records.push({
        role: binding.role,
        bindingId: binding.bindingId,
        bindingRevision: binding.revision,
        profileId: profile.profileId,
        profileRevision: profile.revision,
        enabled: binding.enabled,
        projectId: binding.projectId,
        projectContextCurrent: binding.projectContextFingerprint === expectedFingerprint,
        profileCurrent: profile.revision === binding.profileRevision,
        capabilityClaims: profile.capabilityClaims,
        capabilityCompatible: capabilities.every((capability) => capability.state === 'available' || capability.state === 'degraded'),
      });
    }
    return records;
  });
}

async function recoveryFlow(
  ctx: OperationContext,
  registry: AdapterRegistry,
  params: Record<string, unknown>,
  options: ProjectHubOperationsOptions,
): Promise<unknown> {
  const request = validateRecoveryFlowRequestV2(params.request) as RecoveryFlowRequestV2;
  const configured = options.recoveryFlow ?? {};
  const owners = configured.openOwners ?? defaultRecoveryOwners(ctx.config.vault_path, registry);
  const searchSource = configured.searchSource ?? defaultRecoverySearchSource(ctx.config.vault_path);
  const agentSelection = configured.agentSelection ?? defaultRecoveryAgentSelection(ctx.config.vault_path);
  const now = configured.now ?? options.now;
  if (request.action === 'open') return composeRecoveryOpenStage(request.projectId, owners, new Date(now?.() ?? Date.now()).toISOString());
  if (request.action === 'search') return searchRecovery({ request, dependencies: { openOwners: owners, searchSource, agentSelection, now } as RecoverySearchDependencies });
  if (request.action === 'restart') return composeRecoveryOpenStage(request.projectId, owners, new Date(now?.() ?? Date.now()).toISOString());
  return composeRecoveryPlannedStage(request, { openOwners: owners, searchSource, agentSelection, now });
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
  return {
    projectId: project.projectId,
    slug: project.slug,
    lifecycle: project.lifecycle,
    generatedAt,
    readOnly: true,
    diagnostics: project.diagnostics,
    sections,
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
  const recoveryFlowOperation: Operation = {
    name: 'project.hub.recovery.flow',
    namespace: 'project',
    description: 'Compose the read-only stateless Project recovery Flow through open, search, candidate selection, and immutable Plan preview.',
    mutating: false,
    params: {
      request: { type: 'object', required: true, description: `Closed ${RECOVERY_FLOW_REQUEST_SCHEMA_VERSION} request.` },
    },
    handler: async (ctx, params) => recoveryFlow(ctx, registry, params, options),
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
    recoveryFlowOperation,
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
