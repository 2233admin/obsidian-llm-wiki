import { DomainValidationError } from "./errors.js";

const FORBIDDEN_KEYS = new Set([
  "secret",
  "secretvalue",
  "secretmaterial",
  "apikey",
  "authorization",
  "authorizationheader",
  "oauthtoken",
  "refreshtoken",
  "accesstoken",
  "leasetoken",
  "handofftoken",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "processid",
  "pid",
  "processhandle",
  "runtimesession",
  "workspacepath",
  "repopath",
  "filepath",
  "directorypath",
  "absolutepath",
  "cwd",
  "homedirectory",
  "environment",
  "headers",
]);

const ABSOLUTE_PATH_PATTERNS = [
  /^(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|file:\/\/|\/(?:[^/\s]+\/)+[^/\s]*)/,
  /(?:^|\s)(?:[A-Za-z]:[\\/]|\\\\[^\\]|\/(?:home|Users|var|tmp|etc|opt)\/|~[\\/])/,
];

const SECRET_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/,
];

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function assertSafeSharedState(value: unknown, label = "record"): void {
  const visit = (current: unknown, path: string): void => {
    if (typeof current === "string") {
      if (ABSOLUTE_PATH_PATTERNS.some((pattern) => pattern.test(current))) {
        throw new DomainValidationError("Machine-local or absolute paths are forbidden in shared Agent Domain state", path);
      }
      if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(current))) {
        throw new DomainValidationError("Secret material is forbidden in shared Agent Domain state", path);
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      if (FORBIDDEN_KEYS.has(normalizedKey(key))) {
        throw new DomainValidationError(`Forbidden sensitive or device-local field ${key}`, childPath);
      }
      visit(child, childPath);
    }
  };
  visit(value, label);
}

export function assertSafeSingleSegment(value: string, label: string): void {
  if (!value || value !== value.trim() || value === "." || value === ".." || /[\\/]/.test(value)) {
    throw new DomainValidationError(`${label} must be one safe path segment`);
  }
}
