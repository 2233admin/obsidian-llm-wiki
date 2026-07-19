import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';

import { ContributionError } from './errors.js';
import { sha256 } from './fingerprint.js';
import {
  createLocalContributionProductionPorts,
  createStrictTestCommandPolicy,
} from './local-production.js';
import { resolveRepository } from './repository.js';

function git(repository: string, args: string[]): string {
  return execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, 'utf8');
}

describe('local production contribution ports', () => {
  test('prepares only reviewed paths, verifies in an isolated worktree, and cleans the artifact', {
    timeout: 60_000,
  }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'llmwiki-local-production-test-'));
    const repositoryPath = join(root, 'repository');
    const artifactRoot = join(root, 'artifacts');
    mkdirSync(repositoryPath, { recursive: true });
    try {
      execFileSync('git', ['init', '-b', 'main', repositoryPath], { windowsHide: true });
      git(repositoryPath, ['config', 'user.name', 'Contribution Test']);
      git(repositoryPath, ['config', 'user.email', 'contribution-test@localhost.invalid']);
      write(join(repositoryPath, 'src', 'value.txt'), 'before\n');
      write(join(repositoryPath, 'outside.txt'), 'outside before\n');
      write(
        join(repositoryPath, 'test', 'basic.test.mjs'),
        [
          "import assert from 'node:assert/strict';",
          "import test from 'node:test';",
          "test('artifact smoke', () => assert.equal(2 + 2, 4));",
          '',
        ].join('\n'),
      );
      git(repositoryPath, ['add', '.']);
      git(repositoryPath, ['commit', '-m', 'initial']);
      const baseSha = git(repositoryPath, ['rev-parse', 'HEAD']);

      write(join(repositoryPath, 'src', 'value.txt'), 'after\n');
      write(join(repositoryPath, 'src', 'new.txt'), 'new\n');
      write(join(repositoryPath, 'outside.txt'), 'outside after\n');

      const repository = resolveRepository([{
        id: 'upstream',
        provider: 'github',
        role: 'upstream',
        owner: 'example',
        name: 'repository',
        canonicalUrl: 'https://github.com/example/repository',
        apiEndpoint: 'https://api.github.com',
        provenance: {
          source: 'project_binding',
          evidenceDigest: sha256('local-production-test'),
        },
      }]);
      const ports = createLocalContributionProductionPorts({
        binding: {
          projectId: 'project/example',
          repositoryMappingFingerprint: repository.mappingFingerprint,
          localRepositoryPath: repositoryPath,
        },
        tempRoot: artifactRoot,
        linkNodeModules: false,
      });

      const prepared = await ports.worktree.prepare({
        repository,
        baseRef: 'main',
        baseSha,
        headRef: 'fix/reviewed',
        changeSummary: 'Prepare reviewed contribution',
        allowedPaths: ['src'],
        maxDiffBytes: 100_000,
      });
      assert.deepEqual(
        prepared.changedFiles.map((file) => file.path),
        ['src/new.txt', 'src/value.txt'],
      );
      assert.ok(prepared.diffBytes > 0);
      assert.notEqual(prepared.headSha, baseSha);
      await assert.rejects(
        ports.artifacts.resolve({
          artifactId: prepared.artifactId,
          artifactDigest: prepared.artifactDigest,
        }),
        (error: unknown) =>
          error instanceof ContributionError && error.code === 'STALE_PLAN',
      );

      const evidence = await ports.verifier.verify({
        artifactId: prepared.artifactId,
        artifactDigest: prepared.artifactDigest,
        commands: ['node --test test/basic.test.mjs'],
      });
      assert.equal(evidence.length, 1);
      assert.equal(evidence[0]?.status, 'passed');
      const workspace = await ports.artifacts.resolve({
        artifactId: prepared.artifactId,
        artifactDigest: prepared.artifactDigest,
      });
      assert.deepEqual(
        splitNull(git(workspace.cwd, [
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-r',
          '-z',
          prepared.headSha,
        ])),
        ['src/new.txt', 'src/value.txt'],
      );

      await ports.artifacts.release?.({
        artifactId: prepared.artifactId,
        artifactDigest: prepared.artifactDigest,
      });
      assert.equal(existsSync(workspace.cwd), false);
      await ports.dispose();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('strict command policy rejects shell and eval escape hatches', () => {
    const policy = createStrictTestCommandPolicy();
    assert.deepEqual(policy.parse('npm run typecheck -- --pretty false'), [
      'npm',
      'run',
      'typecheck',
      '--',
      '--pretty',
      'false',
    ]);
    assert.throws(() => policy.parse('node -e "process.exit(0)"'), ContributionError);
    assert.throws(() => policy.parse('npm test && curl https://example.com'), ContributionError);
    assert.throws(() => policy.parse('git status'), ContributionError);
  });
});

function splitNull(value: string): string[] {
  return value.split('\0').filter(Boolean);
}
