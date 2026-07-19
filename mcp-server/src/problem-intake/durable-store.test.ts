import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';

import {
  canonicalDigest,
  InMemoryProblemIntake,
  type ProblemReport,
} from '../../../packages/problem-intake/dist/src/index.js';
import type { LocalIssueApplyReceipt, ProjectId } from './contracts.js';
import {
  JsonFileLocalIssueReceiptStore,
  JsonFileProblemObservationRepository,
} from './durable-store.js';

function root(): string {
  const path = join(tmpdir(), `llmwiki-problem-store-${randomUUID()}`);
  mkdirSync(path, { recursive: true });
  return path;
}

function report(projectId: ProjectId, ref: string): ProblemReport {
  return {
    schemaVersion: 1,
    projectId,
    provider: { id: 'manual', kind: 'manual', version: '1' },
    ruleId: 'bounded-problem',
    subject: { kind: 'vault_path', canonicalRef: ref },
    severity: 'warning',
    summary: `Problem at ${ref}`,
    evidenceRefs: [{ kind: 'vault_path', ref, summary: 'Reviewed evidence' }],
    observedAt: '2026-07-19T01:00:00.000Z',
  };
}

describe('durable Problem Intake stores', () => {
  test('reopens observations and issue receipts without crossing Project boundaries', () => {
    const vault = root();
    try {
      const repository = new JsonFileProblemObservationRepository(vault);
      const domain = new InMemoryProblemIntake(repository);
      const alpha = domain.ingest(report('project/alpha', 'alpha.md')).observation;
      domain.ingest(report('project/beta', 'beta.md'));
      repository.save(alpha);

      const reopened = new InMemoryProblemIntake(
        new JsonFileProblemObservationRepository(vault),
      );
      assert.equal(reopened.get(alpha.id).id, alpha.id);
      assert.equal(reopened.list('project/alpha').length, 1);
      assert.equal(reopened.list('project/beta').length, 1);
      assert.equal(reopened.list().length, 2);

      const digest = canonicalDigest('transition-token');
      const receipt: LocalIssueApplyReceipt = {
        schemaVersion: 1,
        projectId: 'project/alpha',
        status: 'applied',
        planFingerprint: canonicalDigest('plan'),
        transitionTokenDigest: digest,
        actor: 'reviewer',
        result: { entity: 'project/alpha/issue/bounded-problem' },
        updatedAt: '2026-07-19T02:00:00.000Z',
      };
      new JsonFileLocalIssueReceiptStore(vault).put(receipt);
      assert.deepEqual(
        new JsonFileLocalIssueReceiptStore(vault).get('project/alpha', digest),
        receipt,
      );
      assert.equal(
        new JsonFileLocalIssueReceiptStore(vault).get('project/beta', digest),
        undefined,
      );
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test('fails closed on malformed persisted observations and secret-bearing receipts', () => {
    const vault = root();
    try {
      const repository = new JsonFileProblemObservationRepository(vault);
      new InMemoryProblemIntake(repository).ingest(report('project/alpha', 'alpha.md'));
      const observationsRoot = join(
        vault,
        '01-Projects',
        'alpha',
        'problem-intake',
        'observations',
      );
      const [file] = readdirSync(observationsRoot);
      writeFileSync(join(observationsRoot, file!), '{"schemaVersion":1}', 'utf8');
      assert.throws(
        () => new JsonFileProblemObservationRepository(vault).list('project/alpha'),
      );

      const digest = canonicalDigest('transition-token');
      assert.throws(() => new JsonFileLocalIssueReceiptStore(vault).put({
        schemaVersion: 1,
        projectId: 'project/alpha',
        status: 'applied',
        planFingerprint: canonicalDigest('plan'),
        transitionTokenDigest: digest,
        actor: 'reviewer',
        result: { token: 'should-never-persist' },
        updatedAt: '2026-07-19T02:00:00.000Z',
      }));
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test('fails closed on a concurrent lock and never steals it', () => {
    const vault = root();
    try {
      const repository = new JsonFileProblemObservationRepository(vault);
      const observation = new InMemoryProblemIntake(repository)
        .ingest(report('project/alpha', 'alpha.md')).observation;
      const lock = join(vault, '01-Projects', 'alpha', 'problem-intake', '.store.lock');
      writeFileSync(lock, '{"pid":99999}', 'utf8');
      assert.throws(() => repository.save(observation), /locked/);
      assert.throws(
        () => writeFileSync(lock, 'replacement', { encoding: 'utf8', flag: 'wx' }),
      );
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
