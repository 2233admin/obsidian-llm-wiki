import type { ProjectId } from '../../../packages/problem-intake/dist/src/index.js';
import { ProblemIntakeExecutionError } from './contracts.js';

const PROJECT_ID_RE = /^project\/[a-z0-9][a-z0-9-]*$/;
const ID_RE = /^[a-z0-9][a-z0-9._:/-]{0,255}$/;
const ABSOLUTE_WINDOWS_PATH_RE = /(?:^|[\s("'`])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/])/;
const ABSOLUTE_HOME_PATH_RE = /(?:^|[\s("'`])\/(?:Users|home|root)\//;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/i;
const URL_CREDENTIAL_RE = /https?:\/\/[^\s/@:]+:[^\s/@]+@/i;
const SECRET_ASSIGNMENT_RE =
  /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|client[-_ ]?secret|private[-_ ]?key)\b\s*[:=]\s*\S+/i;
const SENSITIVE_KEY_RE =
  /(?:authorization|cookie|token(?!Digest)|secret|password|passphrase|api[-_]?key|private[-_]?key|client[-_]?secret|headers?|env)/i;

export function invalid(message: string, data?: unknown): never {
  throw new ProblemIntakeExecutionError('INVALID_INPUT', message, data);
}

export function asRecord(
  value: unknown,
  path: string,
  allowed?: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${path} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (allowed) {
    const allowedKeys = new Set(allowed);
    for (const key of Object.keys(record)) {
      if (!allowedKeys.has(key)) invalid(`${path}.${key} is not supported`);
    }
  }
  return record;
}

export function requiredString(
  value: unknown,
  path: string,
  maxLength = 500,
): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${path} must be a non-empty string`);
  const parsed = value.trim();
  if (parsed.length > maxLength) invalid(`${path} exceeds ${maxLength} characters`);
  assertSecretSafeText(parsed, path);
  return parsed;
}

export function stableId(value: unknown, path: string): string {
  const parsed = requiredString(value, path, 256).toLowerCase();
  if (!ID_RE.test(parsed)) invalid(`${path} must be a stable lowercase identifier`);
  return parsed;
}

export function canonicalProjectId(value: unknown, path = 'projectId'): ProjectId {
  const parsed = requiredString(value, path, 160);
  if (!PROJECT_ID_RE.test(parsed)) {
    invalid(`${path} must use canonical project/<lowercase-kebab-slug>`);
  }
  return parsed as ProjectId;
}

export function timestamp(value: unknown, path: string): string {
  const parsed = requiredString(value, path, 64);
  if (!Number.isFinite(Date.parse(parsed))) invalid(`${path} must be an ISO timestamp`);
  return new Date(parsed).toISOString();
}

export function assertSecretSafeText(value: string, path: string): void {
  if (
    BEARER_RE.test(value)
    || URL_CREDENTIAL_RE.test(value)
    || SECRET_ASSIGNMENT_RE.test(value)
  ) {
    invalid(`${path} contains credential-like material`);
  }
  if (ABSOLUTE_WINDOWS_PATH_RE.test(value) || ABSOLUTE_HOME_PATH_RE.test(value)) {
    invalid(`${path} contains a machine-local absolute path`);
  }
}

export function assertNoSensitiveMaterial(value: unknown, path: string): void {
  if (typeof value === 'string') {
    assertSecretSafeText(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        invalid(`${path}.${key} is forbidden; use an opaque Settings snapshot or secret reference`);
      }
      assertNoSensitiveMaterial(entry, `${path}.${key}`);
    }
  }
}
