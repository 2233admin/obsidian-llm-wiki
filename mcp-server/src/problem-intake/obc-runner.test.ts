import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';
import {
  InMemoryProblemIntake,
} from '../../../packages/problem-intake/dist/src/index.js';

import type { ProblemIntakeDependencies, ProjectOperationPort } from './contracts.js';
import { ProblemIntakeExecutor } from './executor.js';
import { InMemoryLocalIssueReceiptStore } from './in-memory-store.js';
import { runObcProblemScan, type ObcRunner } from './obc-runner.js';
import { makeProblemIntakeOps } from './operations.js';
import type { OperationContext } from '../core/types.js';

function harness() {
  const root = join(tmpdir(), `llmwiki-problem-${randomUUID()}`);
  mkdirSync(join(root, 'Projects'), { recursive: true });
  mkdirSync(join(root, '01-Projects', 'alpha'), { recursive: true });
  writeFileSync(join(root, 'Projects', 'alpha.md'), [
    '---',
    'type: project',
    'entity: project/alpha',
    'status: active',
    '---',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(join(root, '01-Projects', 'alpha', '_project.md'), [
    '---',
    'type: project',
    'entity: project/alpha',
    'status: active',
    '---',
    '',
  ].join('\n'), 'utf8');
  const domain = new InMemoryProblemIntake();
  const projectOperations: ProjectOperationPort = {
    async call() {
      throw new Error('not used');
    },
  };
  const dependencies: ProblemIntakeDependencies = {
    domain,
    issueReceipts: new InMemoryLocalIssueReceiptStore(),
    projectOperations,
    clock: { now: () => '2026-07-19T02:00:00.000Z' },
  };
  const executor = new ProblemIntakeExecutor(dependencies);
  return { root, domain, dependencies, executor };
}

function report(root: string): Awaited<ReturnType<ObcRunner['check']>> {
  return {
    version: '1.0',
    summary: { error: 1, ok: 1 },
    diagnostics: [
      {
        id: 'link_1',
        code: 'BROKEN_CERTAIN',
        severity: 'error',
        source_file: join(root, '01-Projects', 'alpha', 'note.md'),
        line: 3,
        raw_text: '[[Missing]]',
        target_raw: 'Missing',
        message: 'Target not found: Missing',
        candidates: [],
        fragment_exists: false,
        fragment_type: null,
        suggested_fix: null,
        safety_level: 'S0',
      },
      {
        id: 'link_2',
        code: 'OK_EXACT',
        severity: 'ok',
        source_file: join(root, '01-Projects', 'alpha', 'note.md'),
        line: 4,
        raw_text: '[[Exists]]',
        target_raw: 'Exists',
        message: 'Exact match',
        candidates: [],
        fragment_exists: false,
        fragment_type: null,
        suggested_fix: null,
        safety_level: 'S0',
      },
    ],
  };
}

describe('OBC Problem Intake runner', () => {
  test('normalizes absolute OBC scan paths to vault-relative evidence and persists only problems', async () => {
    const h = harness();
    try {
      const runner: ObcRunner = { async check() { return report(h.root); } };
      const result = await runObcProblemScan({
        projectId: 'project/alpha',
        vaultPath: h.root,
        runner,
        executor: h.executor,
        observedAt: '2026-07-19T01:00:00.000Z',
      });
      assert.equal(result.diagnosticCount, 2);
      assert.equal(result.createdCount, 1);
      assert.equal(result.ignoredPassingCount, 1);
      assert.equal(result.observations[0]?.provider.id, 'obc');
      assert.equal(
        result.observations[0]?.subject.canonicalRef,
        '01-Projects/alpha/note.md',
      );
      assert.equal(
        result.observations[0]?.evidenceRefs.find(
          (evidence) => evidence.kind === 'vault_path',
        )?.ref,
        '01-Projects/alpha/note.md',
      );
      assert.equal(JSON.stringify(result).includes(h.root), false);
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  test('rejects OBC evidence outside the configured vault before persistence', async () => {
    const h = harness();
    try {
      const unsafe = report(h.root);
      (unsafe.diagnostics[0] as Record<string, unknown>).source_file =
        join(tmpdir(), 'another-vault', 'secret.md');
      const runner: ObcRunner = { async check() { return unsafe; } };
      await assert.rejects(
        () => runObcProblemScan({
          projectId: 'project/alpha',
          vaultPath: h.root,
          runner,
          executor: h.executor,
        }),
        /outside the configured vault/,
      );
      assert.equal(h.domain.list('project/alpha').length, 0);
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  test('exposes the agreed operation names and routes scan through an injected runner', async () => {
    const h = harness();
    try {
      let scans = 0;
      const runner: ObcRunner = {
        async check() {
          scans += 1;
          return report(h.root);
        },
      };
      const operations = makeProblemIntakeOps(h.root, h.dependencies, { obcRunner: runner });
      assert.deepEqual(
        operations.map((operation) => operation.name),
        [
          'problem.intake.scan',
          'problem.intake.observe',
          'problem.intake.list',
          'problem.intake.lifecycle.apply',
          'problem.intake.verification.apply',
          'problem.intake.issue.plan',
          'problem.intake.issue.apply',
          'problem.intake.contribution.plan',
          'problem.intake.contribution.apply',
        ],
      );
      const scan = operations.find((operation) => operation.name === 'problem.intake.scan');
      assert.ok(scan);
      const context: OperationContext = {
        vault: null as never,
        adapters: null,
        config: {
          vault_path: h.root,
          collaboration: { actor: 'agent:codex', role: 'agent' },
        },
        logger: { info() {}, warn() {}, error() {} },
        dryRun: false,
      };
      const result = await scan.handler(context, { project: 'project/alpha' }) as {
        createdCount: number;
        observations: Array<{ id: string; revision: number }>;
      };
      assert.equal(result.createdCount, 1);
      assert.equal(scans, 1);
      const verification = operations.find(
        (operation) => operation.name === 'problem.intake.verification.apply',
      );
      assert.ok(verification);
      await assert.rejects(
        () => verification.handler(context, {
          projectId: 'project/alpha',
          observationId: result.observations[0]!.id,
          expectedRevision: result.observations[0]!.revision,
          status: 'reproduced',
          actor: 'agent:other',
          providerVersion: '1.0',
          evidenceRefs: [{
            kind: 'provider_finding',
            ref: 'obc/link_1',
            summary: 'Still reproduced',
          }],
        }),
        /actor must match the authenticated collaboration actor/,
      );
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });
});
