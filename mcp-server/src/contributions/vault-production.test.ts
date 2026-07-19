import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ProjectContext } from '../project/project-context.js';
import type { ProblemObservation } from '../problem-intake/contracts.js';
import type {
  ContributionTransport,
  PreparedIsolatedPatch,
  RegressionTestEvidence,
  RepositoryPreflightFacts,
} from './contracts.js';
import { ContributionError } from './errors.js';
import { fingerprint, sha256 } from './fingerprint.js';
import type { GovernedContributionRuntime } from './problem-bridge.js';
import { MemoryContributionReceiptStore } from './receipts.js';
import {
  createVaultGovernedContributionPort,
} from './vault-production.js';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

function context(): ProjectContext {
  return {
    projectId: 'project/example',
    slug: 'example',
    lifecycle: 'active',
    aliases: [],
    roots: {
      registry: 'Projects',
      registryRecord: 'Projects/example.md',
      workOs: '01-Projects/example',
      knowledge: '10-Projects/example',
      runtime: '.vault-mind',
    },
    workspace: { path: 'D:\\explicit\\repository', available: true },
    projections: [{ kind: 'github', target: 'example/repository' }],
    resolvedBy: 'project_id',
    diagnostics: [],
  } as unknown as ProjectContext;
}

function observation(linkedIssue: string | null): ProblemObservation {
  return {
    id: 'observation-1',
    projectId: 'project/example',
    revision: 2,
    linkedIssue,
  } as unknown as ProblemObservation;
}

class RuntimeTransport implements ContributionTransport {
  readonly provider = 'github';

  async preflight(): Promise<RepositoryPreflightFacts> {
    return {
      provider: 'github',
      repositoryId: 'repo-1',
      canonicalUrl: 'https://github.com/example/repository',
      defaultBranch: 'main',
      baseRef: 'main',
      baseSha: BASE_SHA,
      revision: 'repository-revision',
      health: 'available',
      permissions: {
        issuesWrite: true,
        pushBranch: true,
        createPullRequest: true,
        markReadyForReview: true,
      },
      capturedAt: '2026-07-19T00:00:00.000Z',
      warnings: [],
    };
  }

  async preflightPushTarget() {
    return {
      provider: 'github',
      repositoryId: 'repo-1',
      owner: 'example',
      repository: 'repository',
      canonicalUrl: 'https://github.com/example/repository',
      revision: 'repository-revision',
      canPush: true,
      capturedAt: '2026-07-19T00:00:00.000Z',
    };
  }

  async createIssue(): Promise<never> {
    throw new Error('not used');
  }

  async pushBranch(): Promise<never> {
    throw new Error('not used');
  }

  async createDraftPullRequest(): Promise<never> {
    throw new Error('not used');
  }
}

function runtime(disposals: { count: number }): GovernedContributionRuntime {
  const prepared: PreparedIsolatedPatch = {
    artifactId: 'artifact:one',
    artifactDigest: sha256('artifact:one'),
    isolation: 'isolated',
    baseRef: 'main',
    baseSha: BASE_SHA,
    headRef: 'fix/problem',
    headSha: HEAD_SHA,
    changedFiles: [{ path: 'src/problem.ts', generated: false }],
    diffSummary: '1 file changed',
    diffDigest: sha256('diff'),
    diffBytes: 100,
  };
  return {
    transport: new RuntimeTransport(),
    worktree: { async prepare() { return prepared; } },
    verifier: {
      async verify({ commands }): Promise<RegressionTestEvidence[]> {
        return commands.map((command) => ({
          command,
          status: 'passed',
          exitCode: 0,
          outputDigest: sha256(command),
          summary: 'passed',
        }));
      },
    },
    async dispose() {
      disposals.count += 1;
    },
  };
}

describe('vault governed contribution multiplexer', () => {
  test('re-resolves Project Context, defaults unique repository, and enables PR only with policy', async () => {
    let contexts = 0;
    let policyEnabled = false;
    const disposals = { count: 0 };
    const port = createVaultGovernedContributionPort({
      vaultPath: 'D:\\vault',
      contextResolver() {
        contexts += 1;
        return context();
      },
      async policyLoader() {
        if (!policyEnabled) return undefined;
        return {
          policyFingerprint: fingerprint({ policy: 'enabled' }),
          prepare() {
            return {
              headRef: 'fix/problem',
              changeSummary: 'Fix reviewed problem',
              allowedPaths: ['src/problem.ts'],
              testCommands: ['bun test'],
              generatedFilePolicy: 'exclude',
            };
          },
        };
      },
      runtimeFactory: () => runtime(disposals),
      receiptsFactory: () => new MemoryContributionReceiptStore(),
      now: () => '2026-07-19T01:00:00.000Z',
    });

    const unlinked = await port.inspect({
      choice: 'submit_issue',
      projectId: 'project/example',
      repository: '',
      observation: observation(null),
    });
    assert.equal(unlinked.available, false);
    assert.match(unlinked.unavailableReason ?? '', /Work-OS issue/i);

    const issue = await port.inspect({
      choice: 'submit_issue',
      projectId: 'project/example',
      repository: '',
      observation: observation('01-Projects/example/issues/problem.md'),
    });
    assert.equal(issue.available, true);

    const noPolicy = await port.inspect({
      choice: 'prepare_pull_request',
      projectId: 'project/example',
      repository: 'example/repository',
      observation: observation('01-Projects/example/issues/problem.md'),
    });
    assert.equal(noPolicy.available, false);
    assert.match(noPolicy.unavailableReason ?? '', /policy/i);

    await assert.rejects(
      port.inspect({
        choice: 'submit_issue',
        projectId: 'project/example',
        repository: 'https://github.com/example/repository',
        observation: observation('01-Projects/example/issues/problem.md'),
      }),
      (error: unknown) =>
        error instanceof ContributionError && error.code === 'INVALID_INPUT',
    );

    policyEnabled = true;
    const withPolicy = await port.inspect({
      choice: 'prepare_pull_request',
      projectId: 'project/example',
      repository: '',
      observation: observation('01-Projects/example/issues/problem.md'),
    });
    assert.equal(withPolicy.available, true);
    assert.ok(withPolicy.patch);
    assert.ok(contexts >= 5, 'Project Context must be resolved per operation');
    assert.ok(disposals.count >= 1, 'policy drift must replace the cached port');

    assert.deepEqual(await port.repositorySelection('project/example'), {
      id: 'project-context:github.com/example/repository',
      display: 'example/repository',
    });
    await port.dispose();
  });
});
