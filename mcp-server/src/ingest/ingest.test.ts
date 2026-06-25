import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Operation, OperationContext } from '../core/types.js';
import { makeIngestOps } from './ingest.js';

const ctx: OperationContext = {
  vault: { execute: async () => ({}) },
  adapters: null,
  config: { vault_path: '' },
  logger: { info() {}, warn() {}, error() {} },
  dryRun: false,
};

function operation(name: string): Operation {
  const op = makeIngestOps().find((candidate) => candidate.name === name);
  assert.ok(op, `missing operation ${name}`);
  return op;
}

async function preflight(url: string, preferredProvider = 'auto'): Promise<Record<string, unknown>> {
  return operation('ingest.link.preflight').handler(ctx, { url, preferredProvider }) as Promise<Record<string, unknown>>;
}

test('ingest preflight routes YouTube to media without claiming capture is ready by default', async () => {
  const old = process.env.VAULT_MIND_MEDIA_CMD;
  delete process.env.VAULT_MIND_MEDIA_CMD;
  try {
    const result = await preflight('https://www.youtube.com/watch?v=abc123');
    assert.equal(result.platform, 'youtube');
    assert.equal(result.sourceKind, 'video');
    assert.equal((result.provider as Record<string, unknown>).id, 'media');
    assert.equal(result.status, 'needs_provider');
    assert.equal(result.can_auto_ingest, false);
  } finally {
    if (old === undefined) delete process.env.VAULT_MIND_MEDIA_CMD;
    else process.env.VAULT_MIND_MEDIA_CMD = old;
  }
});

test('ingest preflight marks media capture ready only when media provider configured', async () => {
  const old = process.env.VAULT_MIND_MEDIA_CMD;
  process.env.VAULT_MIND_MEDIA_CMD = 'media-transcribe';
  try {
    const result = await preflight('https://youtu.be/abc123');
    assert.equal(result.status, 'ready');
    assert.equal((result.provider as Record<string, unknown>).command, 'media-transcribe');
  } finally {
    if (old === undefined) delete process.env.VAULT_MIND_MEDIA_CMD;
    else process.env.VAULT_MIND_MEDIA_CMD = old;
  }
});

test('ingest preflight rejects relative malformed URLs', async () => {
  await assert.rejects(() => preflight('/not/a/url'), /url must be absolute/);
});

test('ingest preflight routes short-video platforms through a resolver plus media pipeline', async () => {
  const douyin = await preflight('https://v.douyin.com/tDOzAyddx1s/');
  assert.equal(douyin.platform, 'douyin');
  assert.equal((douyin.provider as Record<string, unknown>).id, 'media');
  assert.equal(douyin.access_context, 'browser_required');
  assert.deepEqual((douyin.pipeline as Array<Record<string, unknown>>).map((step) => step.id), ['opencli', 'media']);

  const tiktok = await preflight('https://www.tiktok.com/@example/video/1234567890');
  assert.equal(tiktok.platform, 'tiktok');
  assert.deepEqual((tiktok.pipeline as Array<Record<string, unknown>>).map((step) => step.id), ['opencli', 'media']);
});

test('ingest preflight routes Bilibili video sources to media', async () => {
  const bilibili = await preflight('https://www.bilibili.com/video/BV1xx411c7mD');
  assert.equal(bilibili.platform, 'bilibili');
  assert.equal((bilibili.provider as Record<string, unknown>).id, 'media');
});

test('ingest preflight routes Weibo and Zhihu to OPENCLI', async () => {
  const weibo = await preflight('https://weibo.com/1234567890/ExamplePost');
  assert.equal(weibo.platform, 'weibo');
  assert.equal((weibo.provider as Record<string, unknown>).id, 'opencli');

  const zhihu = await preflight('https://www.zhihu.com/question/123456789/answer/987654321');
  assert.equal(zhihu.platform, 'zhihu');
  assert.equal((zhihu.provider as Record<string, unknown>).id, 'opencli');
});
