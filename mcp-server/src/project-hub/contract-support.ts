import { createHash } from 'node:crypto';

export type RecoveryFingerprint = `sha256:${string}`;

export interface RecoveryTextBounds {
  minBytes: number;
  maxBytes: number;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const ABSOLUTE_OR_HOME_PATH = /^(?:[A-Za-z]:[\\/]|[\\/]{1,2}|~(?:[\\/]|$))/u;
const SENSITIVE_KEY = /(?:authorization|cookie|token|secret|password|credential|api[-_]?key|access[-_]?key|refresh[-_]?token|private[-_]?key|prompt|transcript|environment|process[-_]?env|headers?)/iu;
const SENSITIVE_VALUE = /(?:^|\b)(?:bearer|basic)\s+[A-Za-z0-9+/=._~-]{8,}|(?:^|\s)(?:gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{10,}|AIza[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|npm_[A-Za-z0-9]{10,}|pypi-[A-Za-z0-9_-]{10,})(?:$|\s)|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
const RAW_MATERIAL_MARKER = /(?:raw\s+)?(?:system|user|assistant)?\s*(?:prompt|transcript)|(?:begin|end)\s+(?:raw\s+)?(?:prompt|transcript)|transcript[_ -]?body/iu;

function canonicalize(value: unknown, depth = 0): unknown {
  if (depth > 64) throw new Error('Recovery contract value exceeds maximum nesting depth');
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(objectValue)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item, depth + 1)]),
    );
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('Recovery contract value contains a non-JSON value');
}

export function canonicalRecoveryJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function fingerprintRecoveryValue(value: unknown): RecoveryFingerprint {
  return `sha256:${createHash('sha256').update(canonicalRecoveryJson(value), 'utf8').digest('hex')}`;
}

export function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(canonicalRecoveryJson(value), 'utf8');
}

export function assertClosedRecoveryObject(
  value: unknown,
  requiredKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const objectValue = value as Record<string, unknown>;
  const allowed = new Set(requiredKeys);
  for (const key of Object.keys(objectValue)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`);
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(objectValue, key)) {
      throw new Error(`${label} is missing required key ${key}`);
    }
  }
  return objectValue;
}

function unsafeString(value: string): boolean {
  return CONTROL_CHARACTERS.test(value)
    || ABSOLUTE_OR_HOME_PATH.test(value)
    || SENSITIVE_VALUE.test(value)
    || RAW_MATERIAL_MARKER.test(value);
}

export function hasUnsafeRecoveryMaterial(value: unknown): boolean {
  const visit = (item: unknown, depth: number): boolean => {
    if (depth > 32) return true;
    if (typeof item === 'string') return unsafeString(item);
    if (Array.isArray(item)) return item.some((entry) => visit(entry, depth + 1));
    if (item !== null && typeof item === 'object') {
      return Object.entries(item as Record<string, unknown>).some(([key, entry]) => {
        if (SENSITIVE_KEY.test(key) && entry !== null && entry !== undefined && entry !== '') return true;
        return visit(entry, depth + 1);
      });
    }
    return false;
  };
  return visit(value, 0);
}

export function safeRecoveryText(
  value: unknown,
  label: string,
  bounds: RecoveryTextBounds,
): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  if (!Number.isInteger(bounds.minBytes) || bounds.minBytes < 0) throw new Error(`${label} has an invalid minimum byte bound`);
  if (!Number.isInteger(bounds.maxBytes) || bounds.maxBytes < bounds.minBytes) throw new Error(`${label} has an invalid maximum byte bound`);
  if (CONTROL_CHARACTERS.test(value)) throw new Error(`${label} contains control characters`);
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!normalized) throw new Error(`${label} must not be empty`);
  if (hasUnsafeRecoveryMaterial(normalized)) throw new Error(`${label} contains unsafe material`);
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (bytes < bounds.minBytes) throw new Error(`${label} is below the minimum byte bound`);
  if (bytes > bounds.maxBytes) throw new Error(`${label} exceeds the maximum byte bound`);
  return normalized;
}
