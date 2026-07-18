import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Operation, OperationContext, VaultMindConfig, WriteEffect } from './types.js';
import { makeErr } from './types.js';
import { validateParams } from './validate.js';
import { resolveProjectContext } from '../project/project-context.js';

type CollabPolicy = {
  agents?: string[];
  team?: string[];
  allowed_write_paths?: string[];
  protected_paths?: string[];
};

export type OperationRegistry = Map<string, Operation>;

export interface OperationWriteVerdict {
  operation: Operation;
  params: Record<string, unknown>;
  realWrite: boolean;
  targets: string[];
  audit: 'required' | 'none';
  children?: OperationWriteVerdict[];
}

type BatchChildResult = {
  ok?: unknown;
  result?: unknown;
  error?: unknown;
};

const DEFAULT_PROTECTED_PATHS = ['20-Decisions/**', '30-Architecture/**', '40-Runbooks/**', 'README.md'];
const DREAMTIME_CADENCE_AUTHORIZED_ROLES = new Set(['human', 'approver', 'admin']);
const globCache = new Map<string, RegExp>();

export function adjudicateOperationWrite(
  ctx: OperationContext,
  operation: Operation,
  params: Record<string, unknown>,
  registry: OperationRegistry,
): OperationWriteVerdict {
  const verdict = operation.name === 'vault.batch'
    ? adjudicateBatchWrite(ctx, operation, params, registry)
    : adjudicateSingleWrite(ctx, operation, params);

  if (verdict.realWrite && verdict.targets.length === 0) {
    throw makeErr(-32602, `Operation Write Policy for ${operation.name} produced no write targets`);
  }
  if (verdict.realWrite) {
    enforceCollaborationPolicy(ctx.config, operation.name, verdict.params, verdict.targets);
  }
  return verdict;
}

export function auditOperationWrite(ctx: OperationContext, verdict: OperationWriteVerdict, result: unknown): void {
  const actor = ctx.config.collaboration?.actor;
  if (!verdict.realWrite || verdict.audit === 'none' || !actor || ctx.config.collaboration?.enforce === false) return;

  try {
    const day = new Date().toISOString().slice(0, 10);
    const auditDir = resolve(ctx.config.vault_path, '.wiki-audit');
    mkdirSync(auditDir, { recursive: true });
    const auditResult = auditResultForVerdict(verdict, result);
    const entry = {
      ts: new Date().toISOString(),
      actor,
      role: ctx.config.collaboration?.role,
      tool: verdict.operation.name,
      targets: verdict.targets.map(normalizePolicyPath),
      ok: auditResult.ok,
      resultPaths: resultPaths(result),
      children: auditResult.children,
    };
    appendFileSync(resolve(auditDir, `${day}.jsonl`), JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) {
    process.stderr.write(`obsidian-llm-wiki: [warn] audit write failed: ${(e as Error).message}\n`);
  }
}

export function writeEffectsForVerdict(
  ctx: OperationContext,
  verdict: OperationWriteVerdict,
  result: unknown,
): WriteEffect[] {
  if (!verdict.realWrite) return [];
  if (verdict.children) {
    const batchResults = Array.isArray((result as { results?: unknown })?.results)
      ? ((result as { results: unknown[] }).results)
      : [];
    return verdict.children.flatMap((child, index) => {
      const childResult = batchResults[index] as BatchChildResult | undefined;
      if (childResult?.ok !== true) return [];
      return writeEffectsForVerdict(ctx, child, childResult?.result);
    });
  }
  if (!verdict.operation.mutating) return [];
  return verdict.operation.writePolicy.effects?.(ctx, verdict.params, result) ?? [];
}

export function dryRunFalse(params: Record<string, unknown>): boolean {
  return params.dryRun === false || params.dry_run === false;
}

export function targetParams(...keys: string[]) {
  return (_ctx: OperationContext, params: Record<string, unknown>): string[] =>
    keys.flatMap((key) => (typeof params[key] === 'string' ? [params[key] as string] : []));
}

export function staticTargets(...targets: string[]) {
  return (): string[] => targets;
}

export function targetOrWildcard(param: string, fallback: string) {
  return (_ctx: OperationContext, params: Record<string, unknown>): string[] =>
    typeof params[param] === 'string' ? [params[param] as string] : [fallback];
}

function resolvedPolicyProject(
  config: VaultMindConfig,
  args: Record<string, unknown>,
  operation: string,
): string {
  if (typeof args.project !== 'string' || !args.project.trim()) {
    throw makeErr(-32602, 'project required for write policy');
  }
  return resolveProjectContext(
    config.vault_path,
    args.project,
    operation,
    { recordCompatibility: false },
  ).slug;
}

export function memoryPolicyBasePath(
  config: VaultMindConfig,
  args: Record<string, unknown>,
  operation = 'memory.write',
): string {
  const actor = safeMemorySegment(config.collaboration?.actor || process.env.VAULT_MIND_ACTOR || 'agent', 'actor');
  const project = typeof args.project === 'string' && args.project.trim()
    ? resolveProjectContext(
        config.vault_path,
        args.project,
        operation,
        { recordCompatibility: false },
      ).slug
    : undefined;
  return project ? `10-Projects/${project}/agents/${actor}/memory` : `00-Inbox/Agent-Memory/${actor}`;
}

export function projectPolicyBasePath(args: Record<string, unknown>): string {
  return `01-Projects/${policyProjectSegment(args)}`;
}

export function workflowPolicyBasePath(
  config: VaultMindConfig,
  args: Record<string, unknown>,
  operation: string,
): string {
  return `01-Projects/${resolvedPolicyProject(config, args, operation)}/workflow`;
}

export function workflowAgentPolicyBasePath(
  config: VaultMindConfig,
  args: Record<string, unknown>,
  operation: string,
): string {
  return `01-Projects/${resolvedPolicyProject(config, args, operation)}/agents/${workflowAgentPolicySegment(config, args)}`;
}

export function sourcePolicyTargetPaths(
  config: VaultMindConfig,
  args: Record<string, unknown>,
  operation = 'source.register',
): string[] {
  if (typeof args.project === 'string' && args.project.trim() && typeof args.platform === 'string' && args.platform.trim()) {
    const project = resolvedPolicyProject(config, args, operation);
    const platform = safeMemorySegment(args.platform, 'platform');
    return ['_llmwiki/source-registry.json', `10-Projects/${project}/sources/${platform}/**`];
  }
  if (typeof args.project === 'string' && args.project.trim()) {
    const project = resolvedPolicyProject(config, args, operation);
    return ['_llmwiki/source-registry.json', `10-Projects/${project}/sources/**`];
  }
  if (typeof args.platform === 'string' && args.platform.trim()) {
    const platform = safeMemorySegment(args.platform, 'platform');
    return ['_llmwiki/source-registry.json', `00-Inbox/Sources/${platform}/**`];
  }
  return ['_llmwiki/source-registry.json', '00-Inbox/Sources/**', '10-Projects/*/sources/**'];
}

export function touchMarkdown(path: unknown, event: 'create' | 'modify' | 'delete'): WriteEffect {
  return { type: 'touchMarkdown', path, event };
}

export function resultPath(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  const path = (result as { path?: unknown; outputPath?: unknown; written_to?: unknown; written?: unknown }).path;
  if (typeof path === 'string') return path;
  const outputPath = (result as { outputPath?: unknown }).outputPath;
  if (typeof outputPath === 'string') return outputPath;
  const writtenTo = (result as { written_to?: unknown }).written_to;
  if (typeof writtenTo === 'string') return writtenTo;
  const written = (result as { written?: unknown }).written;
  return typeof written === 'string' ? written : undefined;
}

export function normalizePolicyPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function adjudicateSingleWrite(
  ctx: OperationContext,
  operation: Operation,
  params: Record<string, unknown>,
): OperationWriteVerdict {
  if (!operation.mutating) {
    return { operation, params, realWrite: false, targets: [], audit: 'none' };
  }

  const triggerAllowsWrite = operation.writePolicy.realWrite === 'always' || dryRunFalse(params);
  const realWrite = triggerAllowsWrite && (operation.writePolicy.shouldWrite?.(ctx, params) ?? true);
  const targets = realWrite ? operation.writePolicy.targets(ctx, params).map(normalizePolicyPath) : [];
  return { operation, params, realWrite, targets, audit: operation.writePolicy.audit };
}

function adjudicateBatchWrite(
  ctx: OperationContext,
  operation: Operation,
  params: Record<string, unknown>,
  registry: OperationRegistry,
): OperationWriteVerdict {
  if (!Array.isArray(params.operations)) {
    return { operation, params, realWrite: false, targets: [], audit: 'none' };
  }

  const children = params.operations.map((item) => {
    if (!item || typeof item !== 'object') throw makeErr(-32602, 'Invalid batch operation');
    const method = (item as { method?: unknown }).method;
    if (typeof method !== 'string') throw makeErr(-32602, 'Batch operation method required');
    if (method === 'vault.batch') throw makeErr(-32602, 'Recursive batch not allowed');
    const child = registry.get(method);
    if (!child) throw makeErr(-32602, `Unknown batch operation: ${method}`);
    const rawParams = (item as { params?: unknown }).params;
    const childParams = {
      ...((rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)) ? rawParams as Record<string, unknown> : {}),
    };
    if (params.dryRun !== undefined && childParams.dryRun === undefined) childParams.dryRun = params.dryRun;
    if (params.dry_run !== undefined && childParams.dry_run === undefined) childParams.dry_run = params.dry_run;
    const validated = validateParams(child.params, childParams);
    return adjudicateOperationWrite(ctx, child, validated, registry);
  });

  return {
    operation,
    params,
    realWrite: children.some((child) => child.realWrite),
    targets: children.flatMap((child) => child.targets),
    audit: children.some((child) => child.realWrite && child.audit === 'required') ? 'required' : 'none',
    children,
  };
}

function enforceCollaborationPolicy(
  config: VaultMindConfig,
  toolName: string,
  params: Record<string, unknown>,
  targets: string[],
): void {
  const collab = config.collaboration;
  const actor = collab?.actor;
  const cadenceTargets = toolName === 'dreamtime.cadence.run'
    ? authorizedDreamTimeCadenceTargets(config, params, targets)
    : undefined;
  if (!actor || collab?.enforce === false || targets.length === 0) return;

  const policy = readVaultCollabPolicy(config.vault_path);
  const role = collab?.role || (policy.agents?.includes(actor) ? 'agent' : policy.team?.includes(actor) ? 'human' : 'agent');
  const allowed = [
    ...defaultAllowedPaths(actor, role),
    ...(policy.allowed_write_paths ?? []),
    ...(collab?.allowed_write_paths ?? []),
  ];
  const protectedPaths = [
    ...DEFAULT_PROTECTED_PATHS,
    ...(policy.protected_paths ?? []),
    ...(collab?.protected_paths ?? []),
  ];

  for (const target of targets) {
    const protectedHit = matchAny(target, protectedPaths);
    const allowedHit = settingsOperationAllowsTarget(toolName, target)
      || cadenceTargets?.has(normalizePolicyPath(target)) === true
      || governedBackendOperationAllowsTarget(toolName, target)
      || (allowed.length > 0 && matchAny(target, allowed));
    if (protectedHit && !allowedHit) {
      throw makeErr(-32403, `Collaboration policy blocked ${toolName} by ${actor}: protected path ${target}`);
    }
    if (!allowedHit) {
      throw makeErr(-32403, `Collaboration policy blocked ${toolName} by ${actor}: ${target} is outside allowed write paths`);
    }
  }
}

function authorizedDreamTimeCadenceTargets(
  config: VaultMindConfig,
  params: Record<string, unknown>,
  targets: string[],
): Set<string> {
  const actor = config.collaboration?.actor?.trim();
  const role = config.collaboration?.role ?? '';
  if (!actor || !DREAMTIME_CADENCE_AUTHORIZED_ROLES.has(role)) {
    throw makeErr(
      -32403,
      'Collaboration policy blocked dreamtime.cadence.run: authenticated human, approver, or admin required',
    );
  }
  if (typeof params.actor !== 'string' || params.actor.trim() !== actor) {
    throw makeErr(
      -32403,
      'Collaboration policy blocked dreamtime.cadence.run: requested actor must match authenticated actor',
    );
  }
  if (typeof params.project !== 'string' || !params.project.trim()) {
    throw makeErr(-32602, 'project required for write policy');
  }
  const project = resolveProjectContext(
    config.vault_path,
    params.project,
    'dreamtime.cadence.run',
    { recordCompatibility: false },
  );
  if (params.project !== project.projectId) {
    throw makeErr(
      -32403,
      `Collaboration policy blocked dreamtime.cadence.run: canonical Project ID ${project.projectId} required`,
    );
  }

  const allowed = new Set([
    '_llmwiki/agent-domain/v1/**',
    '_llmwiki/usage/v1/**',
    `01-Projects/${project.slug}/runs/**`,
    `10-Projects/${project.slug}/agents/**`,
  ]);
  const normalizedTargets = targets.map(normalizePolicyPath);
  if (normalizedTargets.length !== allowed.size
    || new Set(normalizedTargets).size !== allowed.size
    || normalizedTargets.some((target) => !allowed.has(target))) {
    throw makeErr(
      -32403,
      `Collaboration policy blocked dreamtime.cadence.run by ${actor}: write targets exceed exact Project Context authority`,
    );
  }
  return allowed;
}

function settingsOperationAllowsTarget(toolName: string, target: string): boolean {
  if (toolName !== 'settings.assignment.set' && toolName !== 'settings.assignment.unset') return false;
  return /^_llmwiki\/settings\/(?:vault\.json|projects\/[A-Za-z0-9._-]+\.json|(?:user-device|session)\/[A-Za-z0-9._-]+)$/.test(
    normalizePolicyPath(target),
  );
}

function governedBackendOperationAllowsTarget(toolName: string, target: string): boolean {
  const normalized = normalizePolicyPath(target);
  if (toolName === 'visual.map.apply') {
    return /^01-Projects\/[a-z0-9][a-z0-9-]*\/maps\/(?:[^/]+\/)*[^/]+$/.test(normalized)
      && !normalized.split('/').some((segment) => segment === '.' || segment === '..');
  }
  if (toolName === 'host.proxy.invoke') return normalized === 'external/host-capability/**';
  if (toolName === 'dreamtime.promotion.handoff') {
    return normalized === '00-Inbox/AI-Output/vault-dreamtime/**';
  }
  if (new Set([
    'dreamtime.checkpoint.propose',
    'dreamtime.learn.propose',
    'dreamtime.review.propose',
    'consult.execute',
    'delegation.plan',
    'delegation.approve',
  ]).has(toolName) && normalized === '_llmwiki/usage/v1/**') {
    return true;
  }
  if (new Set([
    'agent.profile.create',
    'agent.profile.update',
    'agent.binding.create',
    'agent.binding.update',
    'agent.thread.create',
    'agent.thread.append',
    'agent.thread.transition',
    'dreamtime.checkpoint.propose',
    'dreamtime.learn.propose',
    'dreamtime.review.propose',
    'dreamtime.approve',
    'dreamtime.reject',
    'consult.execute',
    'delegation.plan',
    'delegation.approve',
    'delegation.transition',
    'delegation.artifact.project',
  ]).has(toolName)) {
    return normalized === '_llmwiki/agent-domain/v1/**';
  }
  if (!new Set([
    'host.descriptor.register',
    'host.connector.register',
    'host.assignment.plan',
    'host.assignment.approve',
  ]).has(toolName)) return false;
  return /^_llmwiki\/host-capabilities\/v1\/(?:descriptors|connectors|assignments)(?:\/[A-Za-z0-9._*-]+(?:\.json)?)?$/.test(normalized);
}

function readVaultCollabPolicy(vaultPath: string): CollabPolicy {
  const policyPath = resolve(vaultPath, '.vault-collab.json');
  if (!existsSync(policyPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(policyPath, 'utf-8')) as CollabPolicy;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object');
    return parsed;
  } catch (e) {
    throw makeErr(-32602, `.vault-collab.json invalid: ${(e as Error).message}`);
  }
}

function globToRegExp(glob: string): RegExp {
  const cached = globCache.get(glob);
  if (cached) return cached;
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    const next = glob[i + 1];
    if (ch === '*' && next === '*') {
      pattern += '.*';
      i += 1;
    } else if (ch === '*') {
      pattern += '[^/]*';
    } else if (ch === '?') {
      pattern += '[^/]';
    } else {
      pattern += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const re = new RegExp(`^${pattern}$`);
  globCache.set(glob, re);
  return re;
}

function matchAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(normalizePolicyPath(pattern)).test(path));
}

function safeMemorySegment(value: string, label: string): string {
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
    throw makeErr(-32602, `${label} must be single safe path segment`);
  }
  return trimmed;
}

function slugPolicySegment(value: string, label: string): string {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!segment) throw makeErr(-32602, `${label} must contain one [a-z0-9] character`);
  return segment;
}

function policyProjectSegment(args: Record<string, unknown>): string {
  if (typeof args.project !== 'string' || !args.project.trim()) {
    throw makeErr(-32602, 'project required for write policy');
  }
  return policyProjectRefSegment(args.project);
}

function policyProjectRefSegment(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('project/')) {
    const slug = trimmed.slice('project/'.length);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      throw makeErr(-32602, 'project ID must use project/<lowercase-kebab-slug>');
    }
    return slug;
  }
  return slugPolicySegment(trimmed, 'project');
}

function workflowAgentPolicySegment(config: VaultMindConfig, args: Record<string, unknown>): string {
  const raw = typeof args.agent === 'string' && args.agent.trim()
    ? args.agent
    : config.collaboration?.actor || process.env.VAULT_MIND_ACTOR || 'agent';
  return slugPolicySegment(raw, 'agent');
}

function defaultAllowedPaths(actor: string, role: string | undefined): string[] {
  const workflowActor = slugPolicySegment(actor, 'actor');
  if (role === 'human') return [`00-Inbox/${actor}`, `00-Inbox/${actor}/**`];
  return [
    `00-Inbox/AI-Output/${actor}`,
    `00-Inbox/AI-Output/${actor}/**`,
    `00-Inbox/Agent-Memory/${actor}`,
    `00-Inbox/Agent-Memory/${actor}/**`,
    `10-Projects/*/agents/${actor}`,
    `10-Projects/*/agents/${actor}/**`,
    `10-Projects/*/project.md`,
    `Projects/*.md`,
    `.vault-mind/project-migrations/**`,
    `01-Projects/*/_project.md`,
    `01-Projects/*/issues/**`,
    `01-Projects/*/views/**`,
    `01-Projects/*/workflow/**`,
    `01-Projects/*/runs/**`,
    `01-Projects/*/agents/${workflowActor}`,
    `01-Projects/*/agents/${workflowActor}/**`,
  ];
}

function auditResultForVerdict(
  verdict: OperationWriteVerdict,
  result: unknown,
): {
  ok: boolean;
  children?: Array<{ tool: string; ok: boolean; realWrite: boolean; targets: string[]; resultPaths: string[]; error?: unknown }>;
} {
  if (!verdict.children) return { ok: resultSucceeded(result) };

  const batchResults = Array.isArray((result as { results?: unknown })?.results)
    ? ((result as { results: unknown[] }).results)
    : [];
  const children = verdict.children.map((child, index) => {
    const childResult = batchResults[index] as BatchChildResult | undefined;
    const ok = childResult?.ok === true;
    return {
      tool: child.operation.name,
      ok,
      realWrite: child.realWrite,
      targets: child.targets.map(normalizePolicyPath),
      resultPaths: ok ? resultPaths(childResult?.result) : [],
      error: ok ? undefined : childResult?.error,
    };
  });

  return { ok: children.every((child) => child.ok), children };
}

function resultSucceeded(result: unknown): boolean {
  if (typeof result !== 'object' || result === null || !('ok' in result)) return true;
  return (result as { ok?: unknown }).ok !== false;
}

function resultPaths(result: unknown): string[] {
  if (typeof result !== 'object' || result === null) return [];
  const paths = [
    (result as { path?: unknown }).path,
    (result as { outputPath?: unknown }).outputPath,
    (result as { written_to?: unknown }).written_to,
    (result as { written?: unknown }).written,
    (result as { eventsPath?: unknown }).eventsPath,
  ];
  return paths.filter((path): path is string => typeof path === 'string').map(normalizePolicyPath);
}
