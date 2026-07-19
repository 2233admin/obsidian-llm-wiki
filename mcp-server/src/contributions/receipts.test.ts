import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { PendingContributionReceipt } from './contracts.js';
import { ContributionError } from './errors.js';
import { sha256 } from './fingerprint.js';
import { JsonFileContributionReceiptStore } from './receipts.js';

function pending(plan: string, token: string): PendingContributionReceipt {
  return {
    schemaVersion: 1,
    status: 'pending',
    action: 'create_issue',
    planFingerprint: sha256(plan),
    projectId: 'project/alpha',
    observationId: 'observation/one',
    actor: 'person:reviewer',
    transitionTokenDigest: sha256(token),
    confirmationTokenDigest: sha256(`confirmation:${token}`),
    remoteFactsFingerprint: sha256('remote-facts'),
    createdAt: '2026-07-19T08:00:00.000Z',
  };
}

test('file receipts preserve transition-token tombstones across cancelled retries', async () => {
  const root = join(tmpdir(), `llmwiki-contribution-token-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  try {
    const store = new JsonFileContributionReceiptStore(root);
    const first = pending('plan-a', 'token-a');
    await store.claim(first);
    await store.replace({
      ...first,
      status: 'cancelled',
      cancelledAt: '2026-07-19T08:01:00.000Z',
      reason: 'not sent',
    });
    await store.claim(pending('plan-a', 'token-b'));
    await assert.rejects(
      () => store.claim(pending('plan-b', 'token-a')),
      (error: unknown) =>
        error instanceof ContributionError && error.code === 'REPLAY_CONFLICT',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
