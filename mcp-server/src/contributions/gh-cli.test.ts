import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type {
  ExecFilePort,
  ExecFileRequest,
  ExecFileResult,
} from './gh-cli.js';
import { GhCliContributionTransport } from './gh-cli.js';
import { sha256 } from './fingerprint.js';
import { resolveRepository } from './repository.js';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

class FakeExecFile implements ExecFilePort {
  readonly calls: ExecFileRequest[] = [];
  ready = false;

  async run(request: ExecFileRequest): Promise<ExecFileResult> {
    this.calls.push(request);
    const key = `${request.file} ${request.args.join(' ')}`;
    if (key.includes('auth status')) return { exitCode: 0, stdout: '', stderr: '' };
    if (key.includes('repo view')) {
      const fork = key.includes('contributor/obsidian-llm-wiki');
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: fork ? 'fork-1' : 'repo-1',
          url: fork
            ? 'https://github.com/contributor/obsidian-llm-wiki'
            : 'https://github.com/2233admin/obsidian-llm-wiki',
          defaultBranchRef: { name: 'main' },
          viewerPermission: 'WRITE',
          hasIssuesEnabled: true,
          isArchived: false,
          updatedAt: '2026-07-19T08:00:00Z',
        }),
        stderr: '',
      };
    }
    if (key.includes(' api ')) return { exitCode: 0, stdout: `${BASE_SHA}\n`, stderr: '' };
    if (key.includes('issue create')) {
      return {
        exitCode: 0,
        stdout: 'https://github.com/2233admin/obsidian-llm-wiki/issues/17\n',
        stderr: '',
      };
    }
    if (key.includes('issue view')) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: 'I_17',
          number: 17,
          url: 'https://github.com/2233admin/obsidian-llm-wiki/issues/17',
          updatedAt: 'issue-rev-1',
        }),
        stderr: '',
      };
    }
    if (key.includes('git -C') || request.file === 'git') {
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    }
    if (key.includes('pr create')) {
      return {
        exitCode: 0,
        stdout: 'https://github.com/2233admin/obsidian-llm-wiki/pull/31\n',
        stderr: '',
      };
    }
    if (key.includes('pr ready')) {
      this.ready = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (key.includes('pr view')) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          id: 'PR_31',
          number: 31,
          url: 'https://github.com/2233admin/obsidian-llm-wiki/pull/31',
          updatedAt: this.ready ? 'pr-rev-2' : 'pr-rev-1',
          isDraft: !this.ready,
        }),
        stderr: '',
      };
    }
    return { exitCode: 1, stdout: '', stderr: `unexpected command: ${key}` };
  }
}

function repository() {
  return resolveRepository([{
    id: 'upstream',
    provider: 'github',
    role: 'upstream',
    owner: '2233admin',
    name: 'obsidian-llm-wiki',
    canonicalUrl: 'https://github.com/2233admin/obsidian-llm-wiki',
    apiEndpoint: 'https://api.github.com',
    provenance: {
      source: 'git_remote',
      evidenceDigest: sha256('upstream'),
    },
  }]);
}

describe('gh CLI contribution transport', () => {
  test('uses only injected argv-based exec calls for preflight and narrow mutations', async () => {
    const exec = new FakeExecFile();
    let artifactReleased = false;
    const transport = new GhCliContributionTransport(exec, {
      async resolve() {
        return { cwd: 'D:\\isolated\\opaque-worktree', headSha: HEAD_SHA };
      },
      async release() {
        artifactReleased = true;
      },
    });
    const repo = repository();
    const preflight = await transport.preflight({ repository: repo });
    assert.equal(preflight.permissions.issuesWrite, true);
    assert.equal(preflight.baseSha, BASE_SHA);
    const forkPreflight = await transport.preflightPushTarget({
      repository: repo,
      target: {
        owner: 'contributor',
        repository: 'obsidian-llm-wiki',
        ref: 'fix/verified',
        mode: 'fork',
      },
    });
    assert.equal(forkPreflight.repositoryId, 'fork-1');
    assert.equal(forkPreflight.canPush, true);

    const issue = await transport.createIssue({
      repository: repo,
      title: 'Human-reviewed issue',
      body: 'Bounded evidence.',
      labels: ['bug'],
      idempotencyKey: sha256('issue'),
    });
    assert.equal(issue.remoteId, '17');

    const pushed = await transport.pushBranch({
      repository: repo,
      artifactId: 'patch:1',
      artifactDigest: sha256('artifact'),
      baseSha: BASE_SHA,
      expectedHeadSha: HEAD_SHA,
      headRef: 'fix/verified',
      target: {
        owner: '2233admin',
        repository: 'obsidian-llm-wiki',
        ref: 'fix/verified',
        mode: 'branch',
      },
      idempotencyKey: sha256('push'),
    });
    assert.equal(pushed.revision, HEAD_SHA);
    assert.equal(artifactReleased, true);

    const draft = await transport.createDraftPullRequest({
      repository: repo,
      baseRef: 'main',
      headRef: 'fix/verified',
      title: 'Human-reviewed PR',
      body: 'Passing regression evidence.',
      draft: true,
      idempotencyKey: sha256('draft'),
    });
    assert.equal(draft.remoteId, '31');

    const ready = await transport.markReadyForReview({
      repository: repo,
      pullRequestId: '31',
      expectedRevision: 'pr-rev-1',
      idempotencyKey: sha256('ready'),
    });
    assert.equal(ready.revision, 'pr-rev-2');

    assert.ok(exec.calls.every((call) => Array.isArray(call.args)));
    assert.ok(exec.calls.every((call) => call.env?.GH_PROMPT_DISABLED === '1'));
    assert.ok(exec.calls.every((call) => !call.args.includes('--show-token')));
    assert.ok(exec.calls.some((call) =>
      call.file === 'git'
      && call.args.includes('push')
      && call.args.includes(`${HEAD_SHA}:refs/heads/fix/verified`),
    ));
    assert.ok(exec.calls.some((call) =>
      call.file === 'gh'
      && call.args.includes('create')
      && call.args.includes('--draft'),
    ));
  });
});
