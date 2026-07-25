import { ProblemIntakeError } from "./errors.js";

const SECRET_ASSIGNMENT =
  /\b(authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\b(\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi;
const TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,})\b/g;
const WINDOWS_PATH = /(?:^|[\s"'(])(?:[A-Za-z]:[\\/][^\s"'<>]*|\\\\[^\\\s]+\\[^\s"'<>]*)/g;
const PRIVATE_UNIX_PATH = /(?:^|[\s"'(])\/(?:Users|home|root|private\/var\/folders)\/[^\s"'<>]*/g;

function matches(value: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(value);
}

export function sensitiveDataClasses(value: string): string[] {
  const classes: string[] = [];
  if (matches(value, SECRET_ASSIGNMENT) || matches(value, TOKEN)) classes.push("secret");
  if (matches(value, WINDOWS_PATH) || matches(value, PRIVATE_UNIX_PATH)) classes.push("machine_path");
  return classes;
}

export function assertPersistenceSafe(value: string, context: string): void {
  const classes = sensitiveDataClasses(value);
  if (classes.length > 0) {
    throw new ProblemIntakeError(
      "SENSITIVE_DATA",
      `${context} contains prohibited ${classes.join(" and ")}`,
      { context, classes },
    );
  }
}

export interface RedactedText {
  value: string;
  redactions: string[];
}

export function redactExternalText(value: string, context: string): RedactedText {
  const redactions = new Set<string>();
  let safe = value.replace(SECRET_ASSIGNMENT, () => {
    redactions.add(`${context}:secret`);
    return "[REDACTED_SECRET]";
  });
  safe = safe.replace(TOKEN, () => {
    redactions.add(`${context}:secret-token`);
    return "[REDACTED_SECRET]";
  });
  safe = safe.replace(WINDOWS_PATH, (match) => {
    redactions.add(`${context}:machine-path`);
    return `${match[0]?.trim() === "" ? match[0] : ""}[REDACTED_MACHINE_PATH]`;
  });
  safe = safe.replace(PRIVATE_UNIX_PATH, (match) => {
    redactions.add(`${context}:machine-path`);
    return `${match[0]?.trim() === "" ? match[0] : ""}[REDACTED_MACHINE_PATH]`;
  });
  return { value: safe, redactions: [...redactions].sort() };
}
