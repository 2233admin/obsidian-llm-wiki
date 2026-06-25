import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Operation, OperationContext } from '../core/types.js';
import { AdapterRegistry } from '../adapters/registry.js';
import { FilesystemAdapter } from '../adapters/filesystem.js';
import { unifiedQuery } from '../unified-query.js';
import { makeProjectOps } from './project.js';

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

test('project visual exports generate Canvas and Bases files without touching issues', async () => {
  const vault = tempVault();
  try {
    await op(vault, 'project.init').handler(ctx(vault), { project: 'visual' });
    await op(vault, 'project.issue.create').handler(ctx(vault), {
      project: 'visual',
      title: 'Design visual layer',
      summary: 'canvas-source-token',
      status: 'started',
      priority: 'High',
      tags: ['visual'],
    });
    await op(vault, 'project.issue.create').handler(ctx(vault), {
      project: 'visual',
      title: 'Review Bases dashboard',
      summary: 'base-source-token',
      status: 'backlog',
      blocked_by: ['ISSUE-1'],
    });
    await op(vault, 'project.issue.link').handler(ctx(vault), {
      project: 'visual',
      id: 'ISSUE-2',
      relation: 'relates',
      target: 'ISSUE-1',
    });

    const canvasPath = '10-Projects/visual/views/project-map.canvas';
    const canvasDryRun = (await op(vault, 'project.canvas.export').handler(ctx(vault), {
      project: 'visual',
    })) as { path: string; dryRun: boolean; nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

    assert.equal(canvasDryRun.path, canvasPath);
    assert.equal(canvasDryRun.dryRun, true);
    assert.equal(existsSync(vaultJoin(vault, canvasPath)), false);
    assert.ok(canvasDryRun.nodes.some((node) => node.type === 'text' && String(node.text).includes('LLMwiki project map')));
    assert.ok(canvasDryRun.nodes.some((node) => node.type === 'group' && node.label === 'In Progress'));
    assert.ok(canvasDryRun.nodes.some((node) => node.type === 'file' && node.file === '10-Projects/visual/docket/issues/ISSUE-1.md'));
    assert.ok(canvasDryRun.edges.some((edge) => edge.label === 'blocks'));
    assert.ok(canvasDryRun.edges.some((edge) => edge.label === 'relates'));

    await op(vault, 'project.canvas.export').handler(ctx(vault), { project: 'visual', dryRun: false });
    const canvas = JSON.parse(readFileSync(vaultJoin(vault, canvasPath), 'utf-8')) as {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    assert.ok(canvas.nodes.some((node) => node.type === 'file'));
    assert.ok(canvas.edges.some((edge) => edge.label === 'blocks'));

    const basePath = '10-Projects/visual/views/issues.base';
    const baseDryRun = (await op(vault, 'project.base.export').handler(ctx(vault), {
      project: 'visual',
    })) as { path: string; sourceFolder: string; fields: string[]; dryRun: boolean };

    assert.equal(baseDryRun.path, basePath);
    assert.equal(baseDryRun.sourceFolder, '10-Projects/visual/docket/issues');
    assert.deepEqual(baseDryRun.fields, ['id', 'title', 'status', 'state_type', 'priority', 'assignee', 'blocked_by', 'updated_at', 'tags']);
    assert.equal(existsSync(vaultJoin(vault, basePath)), false);

    await op(vault, 'project.base.export').handler(ctx(vault), { project: 'visual', dryRun: false });
    const base = readFileSync(vaultJoin(vault, basePath), 'utf-8');
    assert.match(base, /file\.inFolder\("10-Projects\/visual\/docket\/issues"\)/);
    assert.match(base, /type: table/);

    const registry = new AdapterRegistry();
    const fsAdapter = new FilesystemAdapter(vault);
    await fsAdapter.init();
    registry.register(fsAdapter);
    const query = await unifiedQuery(registry, 'LLMwiki project map', { maxResults: 10 });
    assert.ok(query.results.some((result) => result.path === canvasPath));
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('project visual exports handle empty projects and overwrite=false', async () => {
  const vault = tempVault();
  try {
    const canvasPath = '10-Projects/empty/views/project-map.canvas';
    const result = (await op(vault, 'project.canvas.export').handler(ctx(vault), {
      project: 'empty',
      dryRun: false,
    })) as { path: string; nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

    assert.equal(result.path, canvasPath);
    assert.ok(result.nodes.some((node) => node.type === 'text' && String(node.text).includes('0 issues')));
    assert.equal(result.edges.length, 0);
    assert.ok(existsSync(vaultJoin(vault, canvasPath)));

    await assert.rejects(
      () => op(vault, 'project.canvas.export').handler(ctx(vault), {
        project: 'empty',
        dryRun: false,
        overwrite: false,
      }),
      /Already exists/,
    );
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

function tempVault(): string {
  return mkdtempSync(join(tmpdir(), 'llmwiki-visual-'));
}

function op(vault: string, name: string): Operation {
  const found = makeProjectOps(vault).find((operation) => operation.name === name);
  assert.ok(found, `${name} operation exists`);
  return found;
}

function ctx(vault: string): OperationContext {
  return {
    vault: { execute: async () => null },
    adapters: null,
    config: { vault_path: vault },
    logger,
    dryRun: false,
  } as OperationContext;
}

function vaultJoin(vault: string, relPath: string): string {
  return join(vault, ...relPath.split('/'));
}
