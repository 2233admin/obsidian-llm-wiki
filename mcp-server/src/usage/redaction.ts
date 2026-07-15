const REDACTED = '[REDACTED]';
const MACHINE_PATH = '[MACHINE_PATH]';

const SENSITIVE_FIELD = /(?:prompt|response|completion|secret|password|credential|authorization|authheader|apikey|accesstoken|refreshtoken|leasetoken|handofftoken)/i;
const PATH_FIELD = /(?:^|file|directory|repo|workspace|vault|machine)path$/i;
const SECRET_VALUE = /(?:\bbearer\s+[a-z0-9._~+/-]+=*|\b(?:sk|pk|ghp|github_pat|xox[baprs])-[-a-z0-9_]{8,}|\b(?:api[_-]?key|secret|password|authorization|access[_-]?token|refresh[_-]?token|lease[_-]?token|handoff[_-]?token)\s*[:=])/i;
const ABSOLUTE_PATH = /(?:^|[\s"'=:])(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/]|\/(?:users|home|var|tmp|private|opt|etc|mnt|srv|data)(?:\/|$)|~[\\/]|file:\/\/)/i;

export function containsSecretMaterial(value: string): boolean {
  return SECRET_VALUE.test(value);
}

export function containsMachinePath(value: string): boolean {
  return ABSOLUTE_PATH.test(value);
}

export function redactUsageValue(value: unknown, fieldName = ''): unknown {
  const normalizedFieldName = fieldName.replace(/[^A-Za-z0-9]/g, '');
  if (SENSITIVE_FIELD.test(normalizedFieldName)) return REDACTED;
  if (PATH_FIELD.test(normalizedFieldName)) return MACHINE_PATH;
  if (typeof value === 'string') {
    if (containsSecretMaterial(value)) return REDACTED;
    if (containsMachinePath(value)) return MACHINE_PATH;
    return value;
  }
  if (Array.isArray(value)) return value.map(item => redactUsageValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, redactUsageValue(item, key)]),
    );
  }
  return value;
}

export function assertSafeUsageString(value: string, fieldPath: string): void {
  if (containsSecretMaterial(value)) {
    throw new UsagePrivacyError('SECRET_MATERIAL', fieldPath);
  }
  if (containsMachinePath(value)) {
    throw new UsagePrivacyError('MACHINE_PATH', fieldPath);
  }
}

export class UsagePrivacyError extends Error {
  readonly code: 'SECRET_MATERIAL' | 'MACHINE_PATH';
  readonly fieldPath: string;

  constructor(code: UsagePrivacyError['code'], fieldPath: string) {
    super(`Usage data rejected by privacy policy (${code}) at ${fieldPath}`);
    this.name = 'UsagePrivacyError';
    this.code = code;
    this.fieldPath = fieldPath;
  }
}
