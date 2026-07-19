import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { loadVaultContributionPolicy } from './contribution-policy.js';
import { ContributionError } from './errors.js';

async function fixture(): Promise<{
  vault: string;
  write(value: unknown): Promise<void>;
  dispose(): Promise<void>;
}> {
  const vault = await mkdtemp(join(tmpdir(), 'contribution-policy-'));
  const runtime = join(vault, '.vault-mind');
  await mkdir(runtime);
  return {
    vault,
    write: (value) =>
      writeFile(
        join(runtime, 'contribution-policy.json'),
        JSON.stringify(value),
        'utf8',
      ),
    dispose: () => rm(vault, { recursive: true, force: true }),
  };
}

function validPolicy(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projects: {
      'project/example': {
        headRef: 'fix/reviewed-problem',
        changeSummary: 'Fix the reviewed regression',
        allowedPaths: ['src/problem.ts'],
        testCommands: ['bun test'],
        generatedFilePolicy: 'exclude',
        maxDiffBytes: 128_000,
      },
    },
  };
}

describe('machine-local contribution policy', () => {
  test('treats a missing file/project as no PR capability and loads exact schema v1', async () => {
    const item = await fixture();
    try {
      assert.equal(
        await loadVaultContributionPolicy(item.vault, 'project/example'),
        undefined,
      );
      await item.write(validPolicy());
      assert.equal(
        await loadVaultContributionPolicy(item.vault, 'project/other'),
        undefined,
      );
      const policy = await loadVaultContributionPolicy(item.vault, 'project/example');
      assert.ok(policy);
      assert.match(policy.policyFingerprint, /^sha256:[0-9a-f]{64}$/);
      const prepared = await policy.prepare({
        projectId: 'project/example',
        repositorySelection: 'project-context:github.com/example/repository',
        observation: {} as never,
      });
      assert.deepEqual(prepared.allowedPaths, ['src/problem.ts']);
      prepared.allowedPaths.push('mutated.ts');
      const replay = await policy.prepare({
        projectId: 'project/example',
        repositorySelection: 'project-context:github.com/example/repository',
        observation: {} as never,
      });
      assert.deepEqual(replay.allowedPaths, ['src/problem.ts']);
    } finally {
      await item.dispose();
    }
  });

  test('fails closed on unknown fields, traversal/absolute/pattern paths, secrets, and unsafe commands', async () => {
    const item = await fixture();
    try {
      const invalid: unknown[] = [
        { ...validPolicy(), extra: true },
        {
          schemaVersion: 1,
          projects: {
            'project/example': {
              ...(validPolicy().projects as Record<string, unknown>)['project/example'] as object,
              allowedPaths: ['../outside.ts'],
            },
          },
        },
        {
          schemaVersion: 1,
          projects: {
            'project/example': {
              ...(validPolicy().projects as Record<string, unknown>)['project/example'] as object,
              allowedPaths: ['C:\\Users\\Administrator\\secret.ts'],
            },
          },
        },
        {
          schemaVersion: 1,
          projects: {
            'project/example': {
              ...(validPolicy().projects as Record<string, unknown>)['project/example'] as object,
              allowedPaths: ['src/**/*.ts'],
            },
          },
        },
        {
          schemaVersion: 1,
          projects: {
            'project/example': {
              ...(validPolicy().projects as Record<string, unknown>)['project/example'] as object,
              changeSummary: 'token=github_pat_abcdefghijklmnopqrstuvwxyz123456',
            },
          },
        },
        {
          schemaVersion: 1,
          projects: {
            'project/example': {
              ...(validPolicy().projects as Record<string, unknown>)['project/example'] as object,
              testCommands: ['powershell -Command Get-ChildItem'],
            },
          },
        },
      ];
      for (const value of invalid) {
        await item.write(value);
        await assert.rejects(
          loadVaultContributionPolicy(item.vault, 'project/example'),
          (error: unknown) => error instanceof ContributionError,
        );
      }
    } finally {
      await item.dispose();
    }
  });
});
