import {
  lstat,
  readFile,
  realpath,
} from 'node:fs/promises';
import {
  isAbsolute,
  relative,
  resolve,
} from 'node:path';

import { ContributionError } from './errors.js';
import { fingerprint } from './fingerprint.js';
import { createStrictTestCommandPolicy } from './local-production.js';
import type {
  GovernedPullRequestPolicy,
  GovernedPullRequestPreparation,
} from './problem-bridge.js';
import {
  assertSafeRelativePaths,
  containsUnsafeRemoteMaterial,
} from './sanitize.js';

const POLICY_RELATIVE_PATH = '.vault-mind/contribution-policy.json';
const MAX_POLICY_BYTES = 128 * 1024;
const MAX_PROJECTS = 128;
const MAX_ALLOWED_PATHS = 128;
const MAX_TEST_COMMANDS = 32;
const MAX_DIFF_BYTES = 1_000_000;
const PROJECT_ID_RE = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;
const PATH_PATTERN_META_RE = /[*?[\]{}!]/;

type JsonRecord = Record<string, unknown>;

export interface LoadedGovernedPullRequestPolicy extends GovernedPullRequestPolicy {
  readonly policyFingerprint: `sha256:${string}`;
}

function record(value: unknown, label: string, allowed: readonly string[]): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContributionError('PR_UNAVAILABLE', `${label} must be an object`, {
      fallback: 'submit_issue',
    });
  }
  const result = value as JsonRecord;
  const unknown = Object.keys(result).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      `${label} has unknown fields: ${unknown.join(', ')}`,
      { fallback: 'submit_issue' },
    );
  }
  return result;
}

function stringKeyedRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContributionError('PR_UNAVAILABLE', `${label} must be an object`, {
      fallback: 'submit_issue',
    });
  }
  return value as JsonRecord;
}

function boundedString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      `${label} must be a non-empty string of at most ${max} characters`,
      { fallback: 'submit_issue' },
    );
  }
  const normalized = value.trim();
  if (containsUnsafeRemoteMaterial(normalized)) {
    throw new ContributionError(
      'SECRET_OR_PATH_UNSAFE',
      `${label} contains a secret or machine-local path`,
      { fallback: 'submit_issue' },
    );
  }
  return normalized;
}

function boundedStrings(
  value: unknown,
  label: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      `${label} must contain 1 through ${maxItems} items`,
      { fallback: 'submit_issue' },
    );
  }
  return value.map((item, index) =>
    boundedString(item, `${label}[${index}]`, maxLength));
}

function safeRef(value: unknown, label: string): string {
  const ref = boundedString(value, label, 255);
  if (
    !SAFE_REF_RE.test(ref)
    || ref.includes('..')
    || ref.startsWith('/')
    || ref.endsWith('/')
    || ref.endsWith('.')
    || ref.includes('@{')
  ) {
    throw new ContributionError('PR_UNAVAILABLE', `${label} is unsafe`, {
      fallback: 'submit_issue',
    });
  }
  return ref;
}

function safeSegment(value: unknown, label: string): string {
  const segment = boundedString(value, label, 100);
  if (!SAFE_SEGMENT_RE.test(segment) || segment === '.' || segment === '..') {
    throw new ContributionError('PR_UNAVAILABLE', `${label} is unsafe`, {
      fallback: 'submit_issue',
    });
  }
  return segment;
}

function parsePreparation(value: unknown, label: string): GovernedPullRequestPreparation {
  const item = record(value, label, [
    'headRef',
    'changeSummary',
    'allowedPaths',
    'testCommands',
    'pushTarget',
    'generatedFilePolicy',
    'maxDiffBytes',
  ]);
  const allowedPaths = assertSafeRelativePaths(
    boundedStrings(item.allowedPaths, `${label}.allowedPaths`, MAX_ALLOWED_PATHS, 500),
    `${label}.allowedPaths`,
  );
  if (allowedPaths.some((path) =>
    path.startsWith(':(')
    || PATH_PATTERN_META_RE.test(path)
    || containsUnsafeRemoteMaterial(path)
  )) {
    throw new ContributionError(
      'SECRET_OR_PATH_UNSAFE',
      `${label}.allowedPaths must contain literal repository-relative paths`,
      { fallback: 'submit_issue' },
    );
  }
  if (new Set(allowedPaths).size !== allowedPaths.length) {
    throw new ContributionError('PR_UNAVAILABLE', `${label}.allowedPaths contains duplicates`, {
      fallback: 'submit_issue',
    });
  }
  const testCommands = boundedStrings(
    item.testCommands,
    `${label}.testCommands`,
    MAX_TEST_COMMANDS,
    500,
  );
  const commandPolicy = createStrictTestCommandPolicy();
  for (const command of testCommands) {
    if (containsUnsafeRemoteMaterial(command)) {
      throw new ContributionError(
        'SECRET_OR_PATH_UNSAFE',
        `${label}.testCommands contains a secret or machine-local path`,
        { fallback: 'submit_issue' },
      );
    }
    commandPolicy.parse(command);
  }
  if (
    item.generatedFilePolicy !== 'exclude'
    && item.generatedFilePolicy !== 'include_reviewed'
  ) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      `${label}.generatedFilePolicy is unsupported`,
      { fallback: 'submit_issue' },
    );
  }
  let maxDiffBytes: number | undefined;
  if (item.maxDiffBytes !== undefined) {
    if (
      !Number.isInteger(item.maxDiffBytes)
      || (item.maxDiffBytes as number) < 1
      || (item.maxDiffBytes as number) > MAX_DIFF_BYTES
    ) {
      throw new ContributionError(
        'PR_UNAVAILABLE',
        `${label}.maxDiffBytes must be between 1 and ${MAX_DIFF_BYTES}`,
        { fallback: 'submit_issue' },
      );
    }
    maxDiffBytes = item.maxDiffBytes as number;
  }
  let pushTarget: GovernedPullRequestPreparation['pushTarget'];
  if (item.pushTarget !== undefined) {
    const target = record(item.pushTarget, `${label}.pushTarget`, [
      'owner',
      'repository',
      'ref',
      'mode',
    ]);
    if (target.mode !== 'branch' && target.mode !== 'fork') {
      throw new ContributionError(
        'PR_UNAVAILABLE',
        `${label}.pushTarget.mode must be branch or fork`,
        { fallback: 'submit_issue' },
      );
    }
    pushTarget = {
      owner: safeSegment(target.owner, `${label}.pushTarget.owner`),
      repository: safeSegment(target.repository, `${label}.pushTarget.repository`),
      ref: safeRef(target.ref, `${label}.pushTarget.ref`),
      mode: target.mode,
    };
  }
  return {
    headRef: safeRef(item.headRef, `${label}.headRef`),
    changeSummary: boundedString(item.changeSummary, `${label}.changeSummary`, 1_000),
    allowedPaths,
    testCommands,
    ...(pushTarget ? { pushTarget } : {}),
    generatedFilePolicy: item.generatedFilePolicy,
    ...(maxDiffBytes ? { maxDiffBytes } : {}),
  };
}

async function readPolicyFile(vaultPath: string): Promise<unknown | undefined> {
  if (!isAbsolute(vaultPath)) {
    throw new ContributionError('INVALID_INPUT', 'vaultPath must be absolute');
  }
  const vault = resolve(vaultPath);
  const policyPath = resolve(vault, POLICY_RELATIVE_PATH);
  let stat;
  try {
    stat = await lstat(policyPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new ContributionError('PR_UNAVAILABLE', 'Contribution policy cannot be inspected', {
      fallback: 'submit_issue',
    }, { cause: error });
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_POLICY_BYTES) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      'Contribution policy must be a bounded regular file',
      { fallback: 'submit_issue' },
    );
  }
  const [realVault, realPolicy] = await Promise.all([realpath(vault), realpath(policyPath)]);
  const containment = relative(realVault, realPolicy);
  if (containment.startsWith('..') || isAbsolute(containment)) {
    throw new ContributionError(
      'SECRET_OR_PATH_UNSAFE',
      'Contribution policy escaped the vault',
      { fallback: 'submit_issue' },
    );
  }
  let text: string;
  try {
    text = await readFile(policyPath, 'utf8');
  } catch (error) {
    throw new ContributionError('PR_UNAVAILABLE', 'Contribution policy cannot be read', {
      fallback: 'submit_issue',
    }, { cause: error });
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_POLICY_BYTES) {
    throw new ContributionError('PR_UNAVAILABLE', 'Contribution policy is too large', {
      fallback: 'submit_issue',
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ContributionError('PR_UNAVAILABLE', 'Contribution policy is invalid JSON', {
      fallback: 'submit_issue',
    }, { cause: error });
  }
}

/**
 * Loads a machine-local, closed-schema PR policy for exactly one canonical
 * Project. Missing policy is a safe capability absence, not an implicit grant.
 */
export async function loadVaultContributionPolicy(
  vaultPath: string,
  projectId: `project/${string}`,
): Promise<LoadedGovernedPullRequestPolicy | undefined> {
  if (!PROJECT_ID_RE.test(projectId)) {
    throw new ContributionError('INVALID_INPUT', 'projectId must be canonical');
  }
  const raw = await readPolicyFile(vaultPath);
  if (raw === undefined) return undefined;
  const root = record(raw, 'contributionPolicy', ['schemaVersion', 'projects']);
  if (root.schemaVersion !== 1) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      'contributionPolicy.schemaVersion must be 1',
      { fallback: 'submit_issue' },
    );
  }
  const projects = stringKeyedRecord(root.projects, 'contributionPolicy.projects');
  const projectEntries = Object.entries(projects);
  if (projectEntries.length > MAX_PROJECTS) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      `contributionPolicy.projects exceeds ${MAX_PROJECTS} entries`,
      { fallback: 'submit_issue' },
    );
  }
  const preparations = new Map<string, GovernedPullRequestPreparation>();
  for (const [key, value] of projectEntries) {
    if (!PROJECT_ID_RE.test(key)) {
      throw new ContributionError(
        'PR_UNAVAILABLE',
        'contributionPolicy.projects keys must be canonical Project IDs',
        { fallback: 'submit_issue' },
      );
    }
    preparations.set(
      key,
      parsePreparation(
        value,
        `contributionPolicy.projects[${JSON.stringify(key)}]`,
      ),
    );
  }
  const preparation = preparations.get(projectId);
  if (!preparation) return undefined;
  const policyFingerprint = fingerprint({
    schemaVersion: 1,
    projectId,
    preparation,
  });
  return {
    policyFingerprint,
    prepare(input) {
      if (input.projectId !== projectId) {
        throw new ContributionError(
          'PR_UNAVAILABLE',
          'Contribution policy does not govern this Project',
          { fallback: 'submit_issue' },
        );
      }
      return structuredClone(preparation);
    },
  };
}
