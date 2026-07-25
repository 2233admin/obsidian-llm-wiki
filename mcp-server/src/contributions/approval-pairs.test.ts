import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createUiWorkRunApprovalConfirmationAdapter,
  type UiWorkRunApprovalGrant,
} from './approval-pairs.js';
import type { ConfirmationRequest } from './contracts.js';
import { sha256 } from './fingerprint.js';

function request(): ConfirmationRequest {
  return {
    planFingerprint: sha256('plan'),
    action: 'create_issue',
    transitionToken: 'transition',
    confirmationToken: 'approval',
    actor: 'alice',
    projectId: 'project/example',
    observationId: 'observation-1',
    externalSideEffect: true,
  };
}

describe('UI work-run approval adapter', () => {
  test('denies by default and accepts only an exact unexpired pair', async () => {
    const input = request();
    assert.equal(
      (await createUiWorkRunApprovalConfirmationAdapter().verify(input)).approved,
      false,
    );
    const grant: UiWorkRunApprovalGrant = {
      schemaVersion: 1,
      approved: true,
      workRunId: 'work-run-1',
      projectId: input.projectId,
      observationId: input.observationId,
      actor: input.actor,
      planFingerprint: input.planFingerprint,
      action: input.action,
      approvalTokenDigest: sha256(input.confirmationToken),
      transitionTokenDigest: sha256(input.transitionToken),
      expiresAt: '2026-07-20T00:00:00.000Z',
    };
    const adapter = createUiWorkRunApprovalConfirmationAdapter({
      findByApprovalTokenDigest(digest) {
        return digest === grant.approvalTokenDigest ? grant : undefined;
      },
    }, () => '2026-07-19T00:00:00.000Z');
    assert.deepEqual(await adapter.verify(input), {
      approved: true,
      workRunId: 'work-run-1',
    });
    assert.equal(
      (await adapter.verify({ ...input, actor: 'mallory' })).approved,
      false,
    );
    assert.equal(
      (await adapter.verify({ ...input, transitionToken: 'other' })).approved,
      false,
    );
  });
});
