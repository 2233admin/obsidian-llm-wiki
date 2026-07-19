import { isAbsolute } from 'node:path';

import type {
  ContributionEvidence,
  ContributionRedaction,
  ExternalContributionContent,
  PullRequestChangedFile,
} from './contracts.js';
import { assertSha256 } from './fingerprint.js';
import { ContributionError } from './errors.js';

const MAX_TITLE = 200;
const MAX_BODY = 16_000;
const MAX_EVIDENCE = 20;
const MAX_EVIDENCE_SUMMARY = 500;
const MAX_LABELS = 20;
const SECRET_PATTERNS = [
  /\b(?:authorization|proxy-authorization)\s*:\s*\S+/gi,
  /\b(?:api[_-]?key|token|password|secret)\s*[=:]\s*["']?[A-Za-z0-9_./+=-]{8,}/gi,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];
const WINDOWS_PATH = /(?:^|[\s("'`])(?:[A-Za-z]:\\|\\\\)[^\s)"'`]+/g;
const UNIX_PATH = /(?:^|[\s("'`])\/(?:Users|home|var|tmp|private|opt|etc)\/[^\s)"'`]+/g;

function boundedString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ContributionError('INVALID_INPUT', `${label} is required`);
  }
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (normalized.length > max) {
    throw new ContributionError('INVALID_INPUT', `${label} exceeds ${max} characters`);
  }
  return normalized;
}

function redactText(
  value: string,
  field: string,
  redactions: ContributionRedaction[],
): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, () => {
      redactions.push({ field, reason: 'secret', replacement: '[REDACTED SECRET]' });
      return '[REDACTED SECRET]';
    });
  }
  result = result.replace(WINDOWS_PATH, (match) => {
    const prefix = /^\s/.test(match) ? match[0] : '';
    redactions.push({ field, reason: 'machine_path', replacement: '[REDACTED LOCAL PATH]' });
    return `${prefix}[REDACTED LOCAL PATH]`;
  });
  result = result.replace(UNIX_PATH, (match) => {
    const prefix = /^\s/.test(match) ? match[0] : '';
    redactions.push({ field, reason: 'machine_path', replacement: '[REDACTED LOCAL PATH]' });
    return `${prefix}[REDACTED LOCAL PATH]`;
  });
  return result;
}

export function sanitizeContent(input: {
  title: unknown;
  body: unknown;
  bodyAuthorship: unknown;
  evidence: unknown;
  labels?: unknown;
}): {
  content: ExternalContributionContent;
  redactions: ContributionRedaction[];
} {
  if (input.bodyAuthorship !== 'human') {
    throw new ContributionError(
      'INVALID_INPUT',
      'Remote contribution body must be human-authored and explicitly reviewed',
    );
  }
  const redactions: ContributionRedaction[] = [];
  const title = redactText(boundedString(input.title, 'title', MAX_TITLE), 'content.title', redactions);
  const body = redactText(boundedString(input.body, 'body', MAX_BODY), 'content.body', redactions);
  if (!Array.isArray(input.evidence) || input.evidence.length > MAX_EVIDENCE) {
    throw new ContributionError('INVALID_INPUT', `evidence must contain at most ${MAX_EVIDENCE} items`);
  }
  const evidence: ContributionEvidence[] = input.evidence.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ContributionError('INVALID_INPUT', `evidence[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const allowed = new Set(['ref', 'summary', 'digest']);
    const unknown = Object.keys(record).filter((key) => !allowed.has(key));
    if (unknown.length) {
      throw new ContributionError('INVALID_INPUT', `evidence[${index}] has unknown fields: ${unknown.join(', ')}`);
    }
    assertSha256(record.digest, `evidence[${index}].digest`);
    return {
      ref: redactText(boundedString(record.ref, `evidence[${index}].ref`, 500), `content.evidence[${index}].ref`, redactions),
      summary: redactText(
        boundedString(record.summary, `evidence[${index}].summary`, MAX_EVIDENCE_SUMMARY),
        `content.evidence[${index}].summary`,
        redactions,
      ),
      digest: record.digest,
    };
  });
  const labelsInput = input.labels ?? [];
  if (!Array.isArray(labelsInput) || labelsInput.length > MAX_LABELS) {
    throw new ContributionError('INVALID_INPUT', `labels must contain at most ${MAX_LABELS} items`);
  }
  const labels = [...new Set(labelsInput.map((value, index) =>
    boundedString(value, `labels[${index}]`, 50).toLowerCase(),
  ))].sort();
  return {
    content: { title, body, bodyAuthorship: 'human', evidence, labels },
    redactions,
  };
}

export function assertSafeRelativePaths(
  paths: string[],
  label: string,
): string[] {
  return paths.map((value, index) => {
    const path = boundedString(value, `${label}[${index}]`, 500).replaceAll('\\', '/');
    if (
      isAbsolute(path)
      || /^[A-Za-z]:\//.test(path)
      || path.startsWith('/')
      || path.split('/').some((segment) => segment === '..' || !segment)
    ) {
      throw new ContributionError('SECRET_OR_PATH_UNSAFE', `${label}[${index}] must be repository-relative`);
    }
    return path;
  });
}

export function validateGeneratedFilePolicy(
  files: PullRequestChangedFile[],
  policy: 'exclude' | 'include_reviewed',
): void {
  for (const file of files) {
    assertSafeRelativePaths([file.path], 'changedFiles.path');
    if (file.generated && policy === 'exclude') {
      throw new ContributionError(
        'PR_UNAVAILABLE',
        `Generated file ${file.path} is excluded by policy`,
        { fallback: 'submit_issue' },
      );
    }
  }
}

export function containsUnsafeRemoteMaterial(value: unknown): boolean {
  const text = JSON.stringify(value);
  const secret = SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
  WINDOWS_PATH.lastIndex = 0;
  UNIX_PATH.lastIndex = 0;
  return secret || WINDOWS_PATH.test(text) || UNIX_PATH.test(text);
}
