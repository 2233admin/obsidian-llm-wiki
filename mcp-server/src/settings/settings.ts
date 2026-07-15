import {
  bundledRegistry,
  loadRegistry,
  SettingsService,
  targetForScope,
  type MutableSettingsScope,
  type RuntimeContext,
  type SecretReference,
  type SettingValue,
  type SettingsScope,
} from '../../../packages/settings-platform/dist/src/index.js';
import type { Operation, OperationWritePolicy } from '../core/types.js';
import { badRequest } from '../core/types.js';
import { resolveProjectContext } from '../project/project-context.js';

export interface SettingsOperationsOptions {
  vaultPath: string;
  userDevicePath?: string;
  userDeviceId?: string;
  vaultId?: string;
  workspaceProjectId?: string;
  sessionId?: string;
  pythonPath?: string;
  compilerPath?: string;
  registryPath?: string;
  environment?: NodeJS.ProcessEnv;
  clock?: () => string;
}

export function createSettingsService(options: SettingsOperationsOptions): SettingsService {
  return new SettingsService({
    registry: options.registryPath ? loadRegistry(options.registryPath) : bundledRegistry(),
    vaultPath: options.vaultPath,
    userDevicePath: options.userDevicePath,
    userDeviceId: options.userDeviceId,
    vaultId: options.vaultId,
    workspaceProjectId: options.workspaceProjectId,
    sessionId: options.sessionId,
    pythonPath: options.pythonPath,
    compilerPath: options.compilerPath,
    environment: options.environment,
    clock: options.clock,
  });
}

/** Host-only last-mile resolver. Never return this environment through an Operation. */
export async function resolveAgentModelProcessEnvironment(
  service: SettingsService,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const profile = await service.agentModelInvocationProfile();
  const childEnvironment = { ...environment };
  if (profile.mode === 'inherit') return childEnvironment;
  if (!profile.provider || !profile.baseUrl || !profile.model) {
    throw new Error('Agent model mode requires provider, base URL, and model settings');
  }
  const credentialLocator = profile.credential?.secretRef.provider === 'environment'
    ? profile.credential.secretRef.locator
    : undefined;
  childEnvironment.COMPILE_PROVIDER = profile.provider;
  childEnvironment.OPENAI_BASE_URL = profile.baseUrl;
  childEnvironment.COMPILE_MODEL = profile.model;
  delete childEnvironment.OPENAI_API_KEY;
  delete childEnvironment.ANTHROPIC_API_KEY;
  if (credentialLocator) delete childEnvironment[credentialLocator];
  if (profile.mode === 'local') return childEnvironment;

  const credential = profile.credential;
  const secret = credential?.secretRef.provider === 'environment'
    ? environment[credential.secretRef.locator]
    : undefined;
  if (typeof secret !== 'string' || !secret.length) {
    throw new Error('Cloud Agent model credential Secret Reference is not resolvable on this device');
  }
  childEnvironment.OPENAI_API_KEY = secret;
  return childEnvironment;
}

const MUTABLE_SCOPES = ['user-device', 'vault', 'workspace-project', 'session'] as const;
const SETTINGS_SCOPES = ['product', ...MUTABLE_SCOPES] as const;

export function makeSettingsOps(options: SettingsOperationsOptions, service = createSettingsService(options)): Operation[] {

  return [
    {
      name: 'settings.definitions.list',
      namespace: 'settings',
      description: 'List the versioned canonical setting definitions and presentation metadata.',
      mutating: false,
      params: {},
      handler: async () => service.definitionsList(),
    },
    {
      name: 'settings.definitions.get',
      namespace: 'settings',
      description: 'Get one canonical setting definition by namespaced key.',
      mutating: false,
      params: { key: { type: 'string', required: true } },
      handler: async (_ctx, params) => {
        try {
          return service.definitionsGet(requiredString(params.key, 'key'));
        } catch (error) {
          throw badRequest((error as Error).message);
        }
      },
    },
    {
      name: 'settings.scopes.get',
      namespace: 'settings',
      description: 'Read one redacted scoped settings document and its revision.',
      mutating: false,
      params: {
        scope: { type: 'string', required: true, enum: [...SETTINGS_SCOPES] },
        targetId: { type: 'string', required: false },
      },
      handler: async (_ctx, params) => {
        const scope = settingsScopeParam(params.scope);
        return service.scopesGet(
          scope,
          resolvedTargetId(options.vaultPath, scope, optionalString(params.targetId), service.defaultContext, 'settings.scopes.get'),
        );
      },
    },
    {
      name: 'settings.snapshot.resolve',
      namespace: 'settings',
      description: 'Resolve the deterministic redacted Settings Snapshot for a runtime context.',
      mutating: false,
      params: { context: { type: 'object', required: false } },
      handler: async (_ctx, params) => service.snapshotResolve(
        runtimeContext(params.context, service.defaultContext, options.vaultPath, 'settings.snapshot.resolve'),
      ),
    },
    {
      name: 'settings.snapshot.explain',
      namespace: 'settings',
      description: 'Explain one effective setting, including precedence, unset scopes, and overridden candidates.',
      mutating: false,
      params: {
        key: { type: 'string', required: true },
        context: { type: 'object', required: false },
      },
      handler: async (_ctx, params) => service.snapshotExplain(
        requiredString(params.key, 'key'),
        runtimeContext(params.context, service.defaultContext, options.vaultPath, 'settings.snapshot.explain'),
      ),
    },
    {
      name: 'settings.assignment.set',
      namespace: 'settings',
      description: 'Set one assignment with complete-scope validation and optimistic expected-revision commit.',
      mutating: true,
      writePolicy: settingsWritePolicy(options.vaultPath, service.defaultContext, 'settings.assignment.set'),
      params: {
        scope: { type: 'string', required: true, enum: [...MUTABLE_SCOPES] },
        targetId: { type: 'string', required: false },
        key: { type: 'string', required: true },
        value: { type: 'unknown', required: true },
        expectedRevision: { type: 'number', required: true },
        updatedBy: { type: 'string', required: false },
        reason: { type: 'string', required: false },
        expiresAt: { type: 'string', required: false },
      },
      handler: async (ctx, params) => {
        const scope = scopeParam(params.scope);
        return service.assignmentSet({
          scope,
          targetId: resolvedTargetId(
            options.vaultPath,
            scope,
            optionalString(params.targetId),
            service.defaultContext,
            'settings.assignment.set',
          ),
          key: requiredString(params.key, 'key'),
          value: params.value as SettingValue | SecretReference,
          expectedRevision: requiredRevision(params.expectedRevision),
          updatedBy: optionalString(params.updatedBy) ?? ctx.config.collaboration?.actor ?? 'mcp',
          reason: optionalString(params.reason),
          expiresAt: optionalString(params.expiresAt),
        });
      },
    },
    {
      name: 'settings.assignment.unset',
      namespace: 'settings',
      description: 'Unset one assignment with complete-scope validation and optimistic expected-revision commit.',
      mutating: true,
      writePolicy: settingsWritePolicy(options.vaultPath, service.defaultContext, 'settings.assignment.unset'),
      params: {
        scope: { type: 'string', required: true, enum: [...MUTABLE_SCOPES] },
        targetId: { type: 'string', required: false },
        key: { type: 'string', required: true },
        expectedRevision: { type: 'number', required: true },
        updatedBy: { type: 'string', required: false },
        reason: { type: 'string', required: false },
      },
      handler: async (ctx, params) => {
        const scope = scopeParam(params.scope);
        return service.assignmentUnset({
          scope,
          targetId: resolvedTargetId(
            options.vaultPath,
            scope,
            optionalString(params.targetId),
            service.defaultContext,
            'settings.assignment.unset',
          ),
          key: requiredString(params.key, 'key'),
          expectedRevision: requiredRevision(params.expectedRevision),
          updatedBy: optionalString(params.updatedBy) ?? ctx.config.collaboration?.actor ?? 'mcp',
          reason: optionalString(params.reason),
        });
      },
    },
    {
      name: 'settings.validate',
      namespace: 'settings',
      description: 'Validate definitions, complete scope documents, effective values, and cross-setting constraints.',
      mutating: false,
      params: { context: { type: 'object', required: false } },
      handler: async (_ctx, params) => service.validate(
        runtimeContext(params.context, service.defaultContext, options.vaultPath, 'settings.validate'),
      ),
    },
    {
      name: 'settings.migrations.plan',
      namespace: 'settings',
      description: 'Plan Settings document schema migrations without writing.',
      mutating: false,
      params: { context: { type: 'object', required: false } },
      handler: async (_ctx, params) => service.migrationsPlan(
        runtimeContext(params.context, service.defaultContext, options.vaultPath, 'settings.migrations.plan'),
      ),
    },
    {
      name: 'settings.doctor',
      namespace: 'settings',
      description: 'Report evidence-backed available, degraded, unavailable, and disabled capability health.',
      mutating: false,
      params: { context: { type: 'object', required: false } },
      handler: async (_ctx, params) => service.doctor(
        runtimeContext(params.context, service.defaultContext, options.vaultPath, 'settings.doctor'),
      ),
    },
  ];
}

function settingsWritePolicy(
  vaultPath: string,
  defaultContext: RuntimeContext,
  operation: string,
): OperationWritePolicy {
  return {
    realWrite: 'always',
    targets: (_ctx, params) => {
      const scope = typeof params.scope === 'string' ? params.scope : 'unknown';
      const defaultTarget = MUTABLE_SCOPES.includes(scope as MutableSettingsScope)
        ? targetForScope(scope as MutableSettingsScope, defaultContext)
        : undefined;
      const suppliedTarget = typeof params.targetId === 'string' ? params.targetId : undefined;
      if (scope === 'workspace-project') {
        const targetId = suppliedTarget ?? defaultContext.workspaceProjectId;
        if (!targetId) throw badRequest('workspace-project settings require targetId or workspaceProjectId context');
        const project = resolveProjectContext(vaultPath, targetId, operation);
        return [`_llmwiki/settings/projects/${project.slug}.json`];
      }
      const targetId = safeTarget(suppliedTarget ?? defaultTarget ?? 'current');
      if (scope === 'vault') return ['_llmwiki/settings/vault.json'];
      return [`_llmwiki/settings/${scope}/${targetId}`];
    },
    audit: 'required',
  };
}

function runtimeContext(
  value: unknown,
  defaults: RuntimeContext,
  vaultPath: string,
  operation: string,
): RuntimeContext {
  if (value === undefined) return canonicalRuntimeContext(defaults, vaultPath, operation);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('context must be an object');
  const context = value as Record<string, unknown>;
  return canonicalRuntimeContext({
    userDeviceId: optionalString(context.userDeviceId) ?? defaults.userDeviceId,
    ...(optionalString(context.vaultId) ?? defaults.vaultId ? { vaultId: optionalString(context.vaultId) ?? defaults.vaultId } : {}),
    ...(optionalString(context.workspaceProjectId) ?? defaults.workspaceProjectId
      ? { workspaceProjectId: optionalString(context.workspaceProjectId) ?? defaults.workspaceProjectId }
      : {}),
    ...(optionalString(context.sessionId) ?? defaults.sessionId ? { sessionId: optionalString(context.sessionId) ?? defaults.sessionId } : {}),
  }, vaultPath, operation);
}

function canonicalRuntimeContext(context: RuntimeContext, vaultPath: string, operation: string): RuntimeContext {
  if (!context.workspaceProjectId) return { ...context };
  return {
    ...context,
    workspaceProjectId: resolveProjectContext(vaultPath, context.workspaceProjectId, operation).projectId,
  };
}

function resolvedTargetId(
  vaultPath: string,
  scope: SettingsScope,
  targetId: string | undefined,
  defaults: RuntimeContext,
  operation: string,
): string | undefined {
  const resolved = targetId ?? (scope === 'product' ? undefined : targetForScope(scope, defaults));
  if (scope !== 'workspace-project' || !resolved) return resolved;
  return resolveProjectContext(vaultPath, resolved, operation).projectId;
}

function scopeParam(value: unknown): MutableSettingsScope {
  if (typeof value !== 'string' || !MUTABLE_SCOPES.includes(value as MutableSettingsScope)) {
    throw badRequest(`scope must be one of ${MUTABLE_SCOPES.join(', ')}`);
  }
  return value as MutableSettingsScope;
}

function settingsScopeParam(value: unknown): SettingsScope {
  if (typeof value !== 'string' || !SETTINGS_SCOPES.includes(value as SettingsScope)) {
    throw badRequest(`scope must be one of ${SETTINGS_SCOPES.join(', ')}`);
  }
  return value as SettingsScope;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${name} must be a non-empty string`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw badRequest('expectedRevision must be a non-negative integer');
  return value as number;
}

function safeTarget(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'current';
}
