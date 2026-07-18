import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  serializeManagedMindMapSection,
  type MindMapDocument,
  type VisualEditPlan,
} from '../../../packages/visual-workspace/dist/src/index.js';
import { AdapterRegistry } from '../adapters/registry.js';
import type { GraphData, VaultMindAdapter } from '../adapters/interface.js';
import { makeAdapterGraphOps } from '../core/operations.js';
import type { Operation, OperationContext } from '../core/types.js';
import { adjudicateOperationWrite } from '../core/write-policy.js';
import { makeVisualWorkspaceOps, type VisualMapApplyResult, type VisualMapReadResult } from './operations.js';

const INITIAL_DOCUMENT: MindMapDocument = {
  schemaVersion: 1,
  id: 'release-map',
  title: 'Release Map',
  rootId: 'root',
  nodes: [
    { id: 'root', label: 'Release' },
    { id: 'test', label: 'Test' },
  ],
  edges: [{ from: 'root', to: 'test' }],
};

const NEXT_DOCUMENT: MindMapDocument = {
  ...INITIAL_DOCUMENT,
  nodes: [
    { id: 'root', label: 'Release' },
    { id: 'test', label: 'Verify' },
    { id: 'ship', label: 'Ship' },
  ],
  edges: [
    { from: 'root', to: 'test' },
    { from: 'root', to: 'ship' },
  ],
};

function vp(root: string, relativePath: string): string {
  return join(root, ...relativePath.split('/'));
}

function sourceFor(document: MindMapDocument = INITIAL_DOCUMENT): string {
  return [
    '# Notes',
    '',
    'Prose before the managed section.',
    '',
    serializeManagedMindMapSection(document),
    '',
    'Prose after the managed section.',
    '',
  ].join('\n');
}

function makeHarness() {
  const root = join(tmpdir(), `llmwiki-visual-${randomUUID()}`);
  const mapPath = '01-Projects/alpha/maps/release.md';
  mkdirSync(vp(root, 'Projects'), { recursive: true });
  mkdirSync(vp(root, '01-Projects/alpha/maps'), { recursive: true });
  writeFileSync(vp(root, 'Projects/alpha.md'), [
    '---',
    'type: project',
    'entity: project/alpha',
    'status: active',
    '---',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(vp(root, mapPath), sourceFor(), 'utf8');

  const ops = makeVisualWorkspaceOps(root);
  const byName = new Map(ops.map((operation) => [operation.name, operation]));
  const ctx: OperationContext = {
    vault: null as never,
    adapters: null,
    config: {
      vault_path: root,
      collaboration: { actor: 'agent:codex', role: 'agent' },
    },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
  const call = async (name: string, params: Record<string, unknown>) => {
    const operation = byName.get(name);
    assert.ok(operation, `missing operation: ${name}`);
    return operation.handler(ctx, params);
  };
  return { root, mapPath, ops, ctx, call };
}

async function plan(
  harness: ReturnType<typeof makeHarness>,
  path = harness.mapPath,
  actor = 'agent:codex',
): Promise<VisualEditPlan> {
  const result = await harness.call('visual.map.plan', {
    project: 'project/alpha',
    path,
    nextDocument: NEXT_DOCUMENT,
    actor,
    origin: 'assistant',
    warnings: ['Graph evidence remains a suggestion until this plan is applied.'],
  }) as { plan: VisualEditPlan };
  return result.plan;
}

function textDigest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function writePendingReceipt(
  harness: ReturnType<typeof makeHarness>,
  editPlan: VisualEditPlan,
  token: string,
): string {
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  const receiptPath = `01-Projects/alpha/maps/.llmwiki/receipts/${tokenHash}.json`;
  mkdirSync(vp(harness.root, '01-Projects/alpha/maps/.llmwiki/receipts'), { recursive: true });
  writeFileSync(vp(harness.root, receiptPath), `${JSON.stringify({
    schemaVersion: 1,
    status: 'pending',
    projectId: 'project/alpha',
    path: harness.mapPath,
    planFingerprint: editPlan.fingerprint,
    actor: 'agent:codex',
    transitionTokenDigest: `sha256:${tokenHash}`,
    sourceBeforeSha256: editPlan.source.sha256,
    sourceAfterSha256: textDigest(sourceFor(NEXT_DOCUMENT)),
  }, null, 2)}\n`, 'utf8');
  return receiptPath;
}

describe('Visual Workspace MCP operations', () => {
  test('registers read/plan/apply with read and plan remaining write-free', async () => {
    const harness = makeHarness();
    try {
      assert.deepEqual(
        harness.ops.map((operation) => [operation.name, operation.mutating ?? false]),
        [
          ['visual.map.read', false],
          ['visual.map.plan', false],
          ['visual.map.apply', true],
        ],
      );
      const before = readFileSync(vp(harness.root, harness.mapPath), 'utf8');
      const read = await harness.call('visual.map.read', {
        project: 'project/alpha',
        path: harness.mapPath,
      }) as VisualMapReadResult;
      const editPlan = await plan(harness);

      assert.equal(read.projectId, 'project/alpha');
      assert.equal(read.path, harness.mapPath);
      assert.deepEqual(read.document, INITIAL_DOCUMENT);
      assert.equal(read.source, before);
      assert.equal(editPlan.source.path, harness.mapPath);
      assert.deepEqual(editPlan.preview.after.document, NEXT_DOCUMENT);
      assert.equal(readFileSync(vp(harness.root, harness.mapPath), 'utf8'), before);
      assert.equal(existsSync(vp(harness.root, '01-Projects/alpha/maps/.llmwiki')), false);
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  });

  test('applies atomically, preserves outside prose, writes a receipt, and replays without another write', async () => {
    const harness = makeHarness();
    try {
      const editPlan = await plan(harness);
      const request = {
        project: 'project/alpha',
        plan: editPlan,
        presentedFingerprint: editPlan.fingerprint,
        actor: 'agent:codex',
        transitionToken: 'apply-release-map-v1',
      };
      const first = await harness.call('visual.map.apply', request) as VisualMapApplyResult;
      const written = readFileSync(vp(harness.root, harness.mapPath), 'utf8');
      const receiptFullPath = vp(harness.root, first.receiptPath);
      const receiptBeforeReplay = readFileSync(receiptFullPath, 'utf8');
      const receiptMtime = statSync(receiptFullPath).mtimeMs;
      const replay = await harness.call('visual.map.apply', request) as VisualMapApplyResult;

      assert.equal(first.replayed, false);
      assert.equal(replay.replayed, true);
      assert.equal(replay.sourceSha256, first.sourceSha256);
      assert.match(written, /Prose before the managed section\./);
      assert.match(written, /Prose after the managed section\./);
      assert.deepEqual(
        (await harness.call('visual.map.read', {
          project: 'project/alpha',
          path: harness.mapPath,
        }) as VisualMapReadResult).document,
        NEXT_DOCUMENT,
      );
      assert.equal(readFileSync(receiptFullPath, 'utf8'), receiptBeforeReplay);
      assert.equal(statSync(receiptFullPath).mtimeMs, receiptMtime);
      const receipt = JSON.parse(receiptBeforeReplay) as Record<string, unknown>;
      assert.equal(receipt.status, 'applied');
      assert.equal('transitionToken' in receipt, false);
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  });

  test('allows the authenticated confirmer to differ from the immutable plan proposer', async () => {
    const harness = makeHarness();
    try {
      const editPlan = await plan(harness, harness.mapPath, 'assistant:planner');
      const result = await harness.call('visual.map.apply', {
        project: 'project/alpha',
        plan: editPlan,
        presentedFingerprint: editPlan.fingerprint,
        actor: 'agent:codex',
        transitionToken: 'confirmed-by-codex',
      }) as VisualMapApplyResult;

      assert.equal(editPlan.provenance.actor, 'assistant:planner');
      assert.equal(result.actor, 'agent:codex');
      assert.equal(result.replayed, false);
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  });

  test('rechecks the complete source under the shared path lock before creating an intent', async () => {
    const harness = makeHarness();
    try {
      const editPlan = await plan(harness);
      writeFileSync(vp(harness.root, harness.mapPath), `${sourceFor()}\nconcurrent edit\n`, 'utf8');
      await assert.rejects(
        () => harness.call('visual.map.apply', {
          project: 'project/alpha',
          plan: editPlan,
          presentedFingerprint: editPlan.fingerprint,
          actor: 'agent:codex',
          transitionToken: 'stale-plan',
        }),
        /source changed/i,
      );
      const receiptRoot = vp(harness.root, '01-Projects/alpha/maps/.llmwiki/receipts');
      assert.equal(
        existsSync(receiptRoot)
          ? readdirSync(receiptRoot).some((entry) => entry.endsWith('.json'))
          : false,
        false,
      );
      assert.match(readFileSync(vp(harness.root, harness.mapPath), 'utf8'), /concurrent edit/);
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  });

  test('fails closed for cross-project paths, traversal, actor drift, and token reuse', async () => {
    const harness = makeHarness();
    try {
      await assert.rejects(
        () => harness.call('visual.map.read', {
          project: 'project/alpha',
          path: '01-Projects/beta/maps/release.md',
        }),
        /under 01-Projects\/alpha\/maps/,
      );
      await assert.rejects(
        () => harness.call('visual.map.read', {
          project: 'project/alpha',
          path: '01-Projects/alpha/maps/../../beta/maps/release.md',
        }),
        /vault-relative path/,
      );

      const editPlan = await plan(harness);
      await assert.rejects(
        () => harness.call('visual.map.apply', {
          project: 'project/alpha',
          plan: editPlan,
          presentedFingerprint: editPlan.fingerprint,
          actor: 'person:alice',
          transitionToken: 'actor-drift',
        }),
        /actor must match/,
      );

      const first = await harness.call('visual.map.apply', {
        project: 'project/alpha',
        plan: editPlan,
        presentedFingerprint: editPlan.fingerprint,
        actor: 'agent:codex',
        transitionToken: 'shared-token',
      }) as VisualMapApplyResult;
      assert.equal(first.replayed, false);

      const secondPath = '01-Projects/alpha/maps/second.md';
      writeFileSync(vp(harness.root, secondPath), sourceFor(), 'utf8');
      const secondPlan = await plan(harness, secondPath);
      await assert.rejects(
        () => harness.call('visual.map.apply', {
          project: 'project/alpha',
          plan: secondPlan,
          presentedFingerprint: secondPlan.fingerprint,
          actor: 'agent:codex',
          transitionToken: 'shared-token',
        }),
        /already used/,
      );
      assert.deepEqual(
        (await harness.call('visual.map.read', {
          project: 'project/alpha',
          path: secondPath,
        }) as VisualMapReadResult).document,
        INITIAL_DOCUMENT,
      );
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  });

  test('blocks an exact replay when a durable pending receipt has outcome-unknown state', async () => {
    const harness = makeHarness();
    try {
      const editPlan = await plan(harness);
      const token = 'outcome-unknown-token';
      writePendingReceipt(harness, editPlan, token);
      writeFileSync(vp(harness.root, harness.mapPath), `${sourceFor()}\nunknown concurrent bytes\n`, 'utf8');

      await assert.rejects(
        () => harness.call('visual.map.apply', {
          project: 'project/alpha',
          plan: editPlan,
          presentedFingerprint: editPlan.fingerprint,
          actor: 'agent:codex',
          transitionToken: token,
        }),
        /outcome-unknown/,
      );
      assert.match(readFileSync(vp(harness.root, harness.mapPath), 'utf8'), /unknown concurrent bytes/);
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  });

  test('recovers a pending intent both before and after the deterministic map replacement', async () => {
    const beforeWrite = makeHarness();
    try {
      const editPlan = await plan(beforeWrite);
      const token = 'recover-before-write';
      const receiptPath = writePendingReceipt(beforeWrite, editPlan, token);
      const result = await beforeWrite.call('visual.map.apply', {
        project: 'project/alpha',
        plan: editPlan,
        presentedFingerprint: editPlan.fingerprint,
        actor: 'agent:codex',
        transitionToken: token,
      }) as VisualMapApplyResult;

      assert.equal(result.replayed, true);
      assert.deepEqual(
        (await beforeWrite.call('visual.map.read', {
          project: 'project/alpha',
          path: beforeWrite.mapPath,
        }) as VisualMapReadResult).document,
        NEXT_DOCUMENT,
      );
      assert.equal(JSON.parse(readFileSync(vp(beforeWrite.root, receiptPath), 'utf8')).status, 'applied');
    } finally {
      rmSync(beforeWrite.root, { recursive: true, force: true });
    }

    const afterWrite = makeHarness();
    try {
      const editPlan = await plan(afterWrite);
      const token = 'recover-after-write';
      const receiptPath = writePendingReceipt(afterWrite, editPlan, token);
      writeFileSync(vp(afterWrite.root, afterWrite.mapPath), sourceFor(NEXT_DOCUMENT), 'utf8');
      const result = await afterWrite.call('visual.map.apply', {
        project: 'project/alpha',
        plan: editPlan,
        presentedFingerprint: editPlan.fingerprint,
        actor: 'agent:codex',
        transitionToken: token,
      }) as VisualMapApplyResult;

      assert.equal(result.replayed, true);
      assert.equal(JSON.parse(readFileSync(vp(afterWrite.root, receiptPath), 'utf8')).status, 'applied');
    } finally {
      rmSync(afterWrite.root, { recursive: true, force: true });
    }
  });

  test('never steals an existing path lock even when the lock metadata is old', async () => {
    const harness = makeHarness();
    try {
      const editPlan = await plan(harness);
      const lockPath = `${vp(harness.root, harness.mapPath)}.lock`;
      writeFileSync(lockPath, JSON.stringify({ pid: 1, timestamp: 0 }), 'utf8');
      await assert.rejects(
        () => harness.call('visual.map.apply', {
          project: 'project/alpha',
          plan: editPlan,
          presentedFingerprint: editPlan.fingerprint,
          actor: 'agent:codex',
          transitionToken: 'locked-map',
        }),
        /reconciled explicitly/,
      );
      assert.equal(existsSync(lockPath), true);
      const receiptRoot = vp(harness.root, '01-Projects/alpha/maps/.llmwiki/receipts');
      assert.equal(
        existsSync(receiptRoot)
          ? readdirSync(receiptRoot).some((entry) => entry.endsWith('.json'))
          : false,
        false,
      );
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  });

  test('declares exact Write Policy targets for the map and hashed receipt', async () => {
    const harness = makeHarness();
    try {
      const editPlan = await plan(harness);
      const apply = harness.ops.find((operation) => operation.name === 'visual.map.apply');
      assert.ok(apply?.mutating);
      const targets = apply.writePolicy.targets(harness.ctx, {
        project: 'project/alpha',
        plan: editPlan,
        transitionToken: 'write-policy-token',
      });
      assert.equal(targets[0], harness.mapPath);
      assert.match(
        targets[1]!,
        /^01-Projects\/alpha\/maps\/\.llmwiki\/receipts\/[a-f0-9]{64}\.json$/,
      );
      const verdict = adjudicateOperationWrite(
        harness.ctx,
        apply,
        {
          project: 'project/alpha',
          plan: editPlan,
          presentedFingerprint: editPlan.fingerprint,
          actor: 'agent:codex',
          transitionToken: 'write-policy-token',
        },
        new Map(harness.ops.map((operation) => [operation.name, operation])),
      );
      assert.equal(verdict.realWrite, true);
      assert.deepEqual(verdict.targets, targets);
    } finally {
      rmSync(harness.root, { recursive: true, force: true });
    }
  });
});

function graphAdapter(name: string, graph: () => Promise<GraphData>): VaultMindAdapter {
  return {
    name,
    capabilities: ['graph'],
    graph,
    async init() {},
    async dispose() {},
  };
}

describe('graph.adapters.query operation activation', () => {
  test('registers a read-only operation and preserves isolated adapter evidence', async () => {
    const registry = new AdapterRegistry();
    registry.register(graphAdapter('graphify', async () => ({
      nodes: [{ path: 'release.md' }, { path: 'test.md' }],
      edges: [{
        from: 'release.md',
        to: 'test.md',
        type: 'link',
        evidence: [{
          adapter: 'graphify',
          relation: 'depends-on',
          confidence: 'extracted',
          sourcePath: 'release.md',
        }],
      }],
    })));
    registry.register(graphAdapter('other', async () => ({ nodes: [], edges: [] })));

    const operation = makeAdapterGraphOps(registry)[0] as Operation;
    const result = await operation.handler(null as never, { adapters: ['graphify'] }) as {
      snapshots: Array<{ adapter: string; graph: GraphData }>;
    };

    assert.equal(operation.name, 'graph.adapters.query');
    assert.equal(operation.mutating ?? false, false);
    assert.deepEqual(result.snapshots.map((snapshot) => snapshot.adapter), ['graphify']);
    assert.deepEqual(result.snapshots[0]!.graph.edges[0]!.evidence, [{
      adapter: 'graphify',
      relation: 'depends-on',
      confidence: 'extracted',
      sourcePath: 'release.md',
    }]);
  });
});
