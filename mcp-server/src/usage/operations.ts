import { join } from 'node:path';

import type { Operation, OperationContext } from '../core/types.js';
import {
  badRequest,
  conflict,
  internal,
  isOperationError,
} from '../core/types.js';
import { resolveProjectContext, type ProjectId } from '../project/project-context.js';
import {
  USAGE_DIMENSION_NAMES,
  UsageValidationError,
  validateUsageEvent,
  type UsageDimensionName,
  type UsageEvent,
} from './contracts.js';
import {
  UsageEventConflictError,
  UsageLedger,
  UsageLedgerCorruptionError,
  usageEventStorageKey,
} from './ledger.js';
import {
  evaluateUsagePolicy,
  validateUsagePolicy,
} from './policy.js';
import {
  projectUsage,
  type UsageDimensionFilter,
  type UsageProjectionQuery,
} from './projections.js';
import { UsagePrivacyError } from './redaction.js';

export const USAGE_LEDGER_RELATIVE_ROOT = '_llmwiki/usage/v1' as const;

// OperationNamespace is extended with `usage` at the shared registration seam.
const USAGE_NAMESPACE = 'usage' as Operation['namespace'];

function ledgerRoot(vaultPath: string): string {
  return join(vaultPath, ...USAGE_LEDGER_RELATIVE_ROOT.split('/'));
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} must be a non-empty string`);
  return value.trim();
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function closedParams(params: Record<string, unknown>, allowed: readonly string[]): void {
  const names = new Set(allowed);
  for (const key of Object.keys(params)) {
    if (!names.has(key)) throw badRequest(`Unsupported Usage operation parameter: ${key}`);
  }
}

function projectContext(vaultPath: string, params: Record<string, unknown>, operation: string) {
  return resolveProjectContext(vaultPath, requiredString(params.project, 'project'), operation);
}

function assertEventProject(event: UsageEvent, projectId: ProjectId): void {
  const attributed = event.dimensions.project;
  if (attributed.state !== 'known') {
    throw badRequest('Project-scoped Usage Events require an explicitly known Project attribution');
  }
  if (attributed.value !== projectId) {
    throw conflict('Usage Event Project attribution conflicts with Project Context', {
      expectedProjectId: projectId,
      eventProjectId: attributed.value,
    });
  }
}

function parseGroupBy(value: unknown): UsageDimensionName[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw badRequest('groupBy must be an array');
  return value.map((item, index) => {
    if (typeof item !== 'string' || !USAGE_DIMENSION_NAMES.includes(item as UsageDimensionName)) {
      throw badRequest(`groupBy[${index}] must be a supported Usage dimension`);
    }
    return item as UsageDimensionName;
  });
}

function parseFilters(value: unknown): Partial<Record<UsageDimensionName, UsageDimensionFilter>> {
  if (value === undefined) return {};
  const input = record(value, 'filters');
  const filters: Partial<Record<UsageDimensionName, UsageDimensionFilter>> = {};
  for (const [key, item] of Object.entries(input)) {
    if (!USAGE_DIMENSION_NAMES.includes(key as UsageDimensionName)) {
      throw badRequest(`filters.${key} is not a supported Usage dimension`);
    }
    if (item !== null && (typeof item !== 'string' || !item.length)) {
      throw badRequest(`filters.${key} must be an identifier or null`);
    }
    filters[key as UsageDimensionName] = item as UsageDimensionFilter;
  }
  return filters;
}

function projectQuery(
  params: Record<string, unknown>,
  projectId: ProjectId,
): UsageProjectionQuery {
  const filters = parseFilters(params.filters);
  if (filters.project !== undefined && filters.project !== projectId) {
    throw conflict('Usage projection Project filter conflicts with Project Context', {
      expectedProjectId: projectId,
    });
  }
  return {
    groupBy: parseGroupBy(params.groupBy),
    filters: { ...filters, project: projectId },
    from: optionalString(params.from, 'from'),
    to: optionalString(params.to, 'to'),
  };
}

function operationError(error: unknown): never {
  if (isOperationError(error)) throw error;
  if (error instanceof UsageEventConflictError) {
    throw conflict(error.message, { eventId: error.eventId, storageKey: error.storageKey });
  }
  if (error instanceof UsageLedgerCorruptionError) {
    throw internal('Usage ledger validation failed closed', { storageKey: error.storageKey });
  }
  if (error instanceof UsageValidationError || error instanceof UsagePrivacyError || error instanceof TypeError) {
    throw badRequest(error.message);
  }
  throw internal('Usage operation failed closed');
}

function boundary<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    operationError(error);
  }
}

function appendInput(vaultPath: string, params: Record<string, unknown>, operation: string): {
  event: UsageEvent;
  projectId: ProjectId;
} {
  closedParams(params, ['project', 'event']);
  const project = projectContext(vaultPath, params, operation);
  const event = validateUsageEvent(record(params.event, 'event'));
  assertEventProject(event, project.projectId);
  return { event, projectId: project.projectId };
}

function appendTarget(vaultPath: string, params: Record<string, unknown>): string {
  const { event } = appendInput(vaultPath, params, 'usage.append');
  return `${USAGE_LEDGER_RELATIVE_ROOT}/${usageEventStorageKey(event.idempotencyKey)}`;
}

function handleAppend(vaultPath: string, params: Record<string, unknown>) {
  const { event, projectId } = appendInput(vaultPath, params, 'usage.append');
  const result = new UsageLedger(ledgerRoot(vaultPath)).append(event);
  return { projectId, ...result };
}

function handleProject(vaultPath: string, params: Record<string, unknown>) {
  closedParams(params, ['project', 'groupBy', 'filters', 'from', 'to']);
  const project = projectContext(vaultPath, params, 'usage.project');
  const projection = projectUsage(
    new UsageLedger(ledgerRoot(vaultPath)).list(),
    projectQuery(params, project.projectId),
  );
  return { projectId: project.projectId, projection };
}

function handlePolicyEvaluation(vaultPath: string, params: Record<string, unknown>) {
  closedParams(params, ['project', 'policy', 'from', 'to']);
  const project = projectContext(vaultPath, params, 'usage.policy.evaluate');
  const policy = validateUsagePolicy(record(params.policy, 'policy'));
  if (policy.scopeFilters.project !== project.projectId) {
    throw conflict('Usage Policy Project scope conflicts with Project Context', {
      expectedProjectId: project.projectId,
    });
  }
  const projection = projectUsage(new UsageLedger(ledgerRoot(vaultPath)).list(), {
    filters: policy.scopeFilters,
    from: optionalString(params.from, 'from'),
    to: optionalString(params.to, 'to'),
  });
  return {
    projectId: project.projectId,
    projection,
    decision: evaluateUsagePolicy(policy, projection),
  };
}

export function makeUsageOps(vaultPath: string): Operation[] {
  const append: Operation = {
    name: 'usage.append',
    namespace: USAGE_NAMESPACE,
    description: 'Append one immutable Project-attributed Usage Event or replay its existing logical event.',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: (ctx: OperationContext, params: Record<string, unknown>) => [
        boundary(() => appendTarget(ctx.config.vault_path, params)),
      ],
      audit: 'required',
    },
    params: {
      project: { type: 'string', required: true, description: 'Canonical Project ID or registered compatibility reference' },
      event: { type: 'object', required: true, description: 'Versioned privacy-safe Usage Event' },
    },
    handler: async (_ctx, params) => boundary(() => handleAppend(vaultPath, params)),
  };
  const project: Operation = {
    name: 'usage.project',
    namespace: USAGE_NAMESPACE,
    description: 'Return a deterministic Project-owned Usage projection without mutating the Usage ledger.',
    mutating: false,
    params: {
      project: { type: 'string', required: true, description: 'Canonical Project ID or registered compatibility reference' },
      groupBy: { type: 'array', required: false, description: 'Usage dimensions used to form deterministic groups' },
      filters: { type: 'object', required: false, description: 'Additional Usage dimension filters; Project cannot drift' },
      from: { type: 'string', required: false, description: 'Inclusive canonical UTC RFC3339 start' },
      to: { type: 'string', required: false, description: 'Exclusive canonical UTC RFC3339 end' },
    },
    handler: async (_ctx, params) => boundary(() => handleProject(vaultPath, params)),
  };
  const evaluate: Operation = {
    name: 'usage.policy.evaluate',
    namespace: USAGE_NAMESPACE,
    description: 'Evaluate one versioned Project-scoped Usage budget/admission policy over immutable Usage facts.',
    mutating: false,
    params: {
      project: { type: 'string', required: true, description: 'Canonical Project ID or registered compatibility reference' },
      policy: { type: 'object', required: true, description: 'Versioned Usage Policy with an exact Project scope' },
      from: { type: 'string', required: false, description: 'Inclusive canonical UTC RFC3339 start' },
      to: { type: 'string', required: false, description: 'Exclusive canonical UTC RFC3339 end' },
    },
    handler: async (_ctx, params) => boundary(() => handlePolicyEvaluation(vaultPath, params)),
  };
  return [append, project, evaluate];
}
