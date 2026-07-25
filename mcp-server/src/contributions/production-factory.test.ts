import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import type { ProjectContext } from '../project/project-context.js';
import { ContributionError } from './errors.js';
import {
  createProjectContextGhContributionProduction,
  repositoryCandidateFromProjectContext,
} from './production-factory.js';
import { sha256 } from './fingerprint.js';

function projectContext(workspacePath: string): ProjectContext {
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
    workspace: { path: workspacePath, available: true },
    projections: [{
      kind: 'github',
      target: 'https://github.com/example/repository.git',
    }],
    resolvedBy: 'project_id',
    diagnostics: [],
  } as unknown as ProjectContext;
}

describe('Project Context contribution production factory', () => {
  test('binds one GitHub projection, JSON receipts, and the governed service seam', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'llmwiki-contribution-factory-'));
    const workspace = join(vault, 'workspace');
    mkdirSync(workspace);
    try {
      const context = projectContext(workspace);
      const candidate = repositoryCandidateFromProjectContext(context);
      assert.equal(candidate.canonicalUrl, 'https://github.com/example/repository');
      assert.equal(candidate.provenance.source, 'project_binding');

      const production = createProjectContextGhContributionProduction({
        vaultPath: vault,
        context,
        canonicalBinding: {
          async verify() {},
        },
        confirmation: {
          async verify() {
            return { approved: false };
          },
        },
        linkNodeModules: false,
      });
      const local = await production.inspect({
        disposition: 'local_only',
        projectId: 'project/example',
        observationId: 'observation:1',
        actor: 'tester',
        now: '2026-07-19T00:00:00.000Z',
        canonicalPlanId: 'plan:1',
        canonicalPlanFingerprint: sha256('plan:1'),
      });
      assert.equal(local.disposition, 'local_only');
      assert.deepEqual(production.repositoryCandidates, [candidate]);
      await assert.rejects(
        async () => production.inspect({
          disposition: 'local_only',
          projectId: 'project/other',
          observationId: 'observation:1',
          actor: 'tester',
          now: '2026-07-19T00:00:00.000Z',
          canonicalPlanId: 'plan:1',
          canonicalPlanFingerprint: sha256('plan:1'),
        }),
        (error: unknown) =>
          error instanceof ContributionError && error.code === 'INVALID_INPUT',
      );
      await production.dispose();
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test('fails closed when GitHub projections are absent or ambiguous', () => {
    const context = projectContext('D:\\explicit\\workspace');
    assert.throws(
      () => repositoryCandidateFromProjectContext({
        ...context,
        projections: [],
      }),
      ContributionError,
    );
    assert.throws(
      () => repositoryCandidateFromProjectContext({
        ...context,
        projections: [
          ...context.projections,
          { kind: 'github-repo', target: 'other/repository' },
        ],
      }),
      ContributionError,
    );
  });
});
