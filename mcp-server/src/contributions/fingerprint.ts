import { createHash } from 'node:crypto';

import type {
  ForgeExecutionPlanProjection,
  PushTargetPreflightFacts,
  RepositoryPreflightFacts,
  Sha256Digest,
} from './contracts.js';
import { ContributionError } from './errors.js';

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string): Sha256Digest {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function fingerprint(value: unknown): Sha256Digest {
  return sha256(canonicalJson(value));
}

export function assertSha256(value: unknown, label: string): asserts value is Sha256Digest {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new ContributionError('INVALID_INPUT', `${label} must be a lowercase sha256 digest`);
  }
}

export function repositoryFactsFingerprint(facts: RepositoryPreflightFacts): Sha256Digest {
  const {
    capturedAt: _capturedAt,
    warnings: _warnings,
    revision: _revision,
    ...stableFacts
  } = facts;
  return fingerprint(stableFacts);
}

export function pushTargetFactsFingerprint(facts: PushTargetPreflightFacts): Sha256Digest {
  const {
    capturedAt: _capturedAt,
    revision: _revision,
    ...stableFacts
  } = facts;
  return fingerprint(stableFacts);
}

export function forgeProjectionFingerprint(
  plan:
    | Omit<ForgeExecutionPlanProjection, 'projectionFingerprint'>
    | ForgeExecutionPlanProjection,
): Sha256Digest {
  const {
    projectionFingerprint: _projectionFingerprint,
    ...withoutFingerprint
  } = plan as ForgeExecutionPlanProjection;
  return fingerprint(withoutFingerprint);
}
