const SENSITIVE_KEY_PATTERN =
  /(?:authorization|cookie|token|secret|password|passphrase|api[-_]?key|private[-_]?key|client[-_]?secret|headers?|env)/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_CREDENTIAL_PATTERN = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s,;]*/g;
const POSIX_HOME_PATH_PATTERN = /\/(?:Users|home|root)\/[^\s,;]*/g;

export const REDACTED = "[REDACTED]" as const;
export const REDACTED_LOCAL_PATH = "[REDACTED_LOCAL_PATH]" as const;

function redactString(value: string): string {
  return value
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(URL_CREDENTIAL_PATTERN, `$1${REDACTED}@`)
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, REDACTED_LOCAL_PATH)
    .replace(POSIX_HOME_PATH_PATTERN, REDACTED_LOCAL_PATH);
}

export function redactDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactDiagnosticValue);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactDiagnosticValue(entry),
      ]),
    );
  }
  return value;
}
