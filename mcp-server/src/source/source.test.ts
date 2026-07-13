import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Operation, OperationContext } from '../core/types.js';
import { makeSourceOps } from './source.js';

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

test('source.register stores a URL source, registry row, source note, and preflight plan', async () => {
  const vault = tempVault();
  try {
    const register = op(vault, 'source.register');
    const result = (await register.handler(ctx(vault), {
      input: 'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333',
      title: 'Example Bilibili Video',
      tags: ['video', 'research'],
    })) as Record<string, unknown>;

    assert.equal(result.ok, true);
    assert.equal(result.platform, 'bilibili');
    assert.equal(result.sourceKind, 'video');
    assert.equal(result.registryPath, '_llmwiki/source-registry.json');
    assert.equal(typeof result.path, 'string');
    assert.ok(existsSync(vaultJoin(vault, result.path as string)));

    const registry = JSON.parse(readFileSync(vaultJoin(vault, '_llmwiki/source-registry.json'), 'utf-8')) as {
      sources: Record<string, unknown>;
    };
    assert.equal(Object.keys(registry.sources).length, 1);
    const note = readFileSync(vaultJoin(vault, result.path as string), 'utf-8');
    assert.match(note, /## Preflight/);
    assert.match(note, /Example Bilibili Video/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('source.register upserts the same canonical URL instead of duplicating it', async () => {
  const vault = tempVault();
  try {
    const register = op(vault, 'source.register');
    const first = (await register.handler(ctx(vault), {
      input: 'https://x.com/example/status/123#ignored',
    })) as Record<string, unknown>;
    const second = (await register.handler(ctx(vault), {
      input: 'https://x.com/example/status/123',
      notes: 'second pass',
    })) as Record<string, unknown>;

    assert.equal(first.id, second.id);
    const registry = JSON.parse(readFileSync(vaultJoin(vault, '_llmwiki/source-registry.json'), 'utf-8')) as {
      sources: Record<string, unknown>;
    };
    assert.equal(Object.keys(registry.sources).length, 1);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('source.register writes project-scoped Source Notes when project is provided', async () => {
  const vault = tempVault();
  try {
    registerProject(vault, 'local-linear');
    const register = op(vault, 'source.register');
    const result = (await register.handler(ctx(vault), {
      input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      project: 'local-linear',
    })) as Record<string, unknown>;

    assert.equal(result.platform, 'youtube');
    assert.match(result.path as string, /^10-Projects\/local-linear\/sources\/youtube\//);
    assert.equal(result.projectId, 'project/local-linear');
    assert.ok(existsSync(vaultJoin(vault, result.path as string)));
    assert.match(readFileSync(vaultJoin(vault, result.path as string), 'utf-8'), /project-id: "project\/local-linear"/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('source.register rejects unknown project without creating a domain root', async () => {
  const vault = tempVault();
  try {
    const register = op(vault, 'source.register');
    await assert.rejects(
      () => register.handler(ctx(vault), {
        input: 'https://example.com/project-source',
        project: 'missing-project',
      }),
      /Project not found/,
    );
    assert.equal(existsSync(vaultJoin(vault, '10-Projects/missing-project')), false);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('source.register supports vaultPath without modifying the original note', async () => {
  const vault = tempVault();
  try {
    const originalPath = 'Notes/original.md';
    mkdirSync(vaultJoin(vault, 'Notes'), { recursive: true });
    writeFileSync(vaultJoin(vault, originalPath), '# Original\n', 'utf-8');

    const register = op(vault, 'source.register');
    const result = (await register.handler(ctx(vault), {
      inputType: 'vaultPath',
      input: originalPath,
    })) as Record<string, unknown>;

    assert.equal(result.platform, 'vault');
    assert.equal(result.sourceKind, 'vaultPath');
    assert.match(result.path as string, /^00-Inbox\/Sources\/vault\//);
    assert.equal(readFileSync(vaultJoin(vault, originalPath), 'utf-8'), '# Original\n');
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('source.register rejects reserved Phase 1 input types', async () => {
  const vault = tempVault();
  try {
    const register = op(vault, 'source.register');
    await assert.rejects(
      () => register.handler(ctx(vault), { inputType: 'text', input: 'raw text' }),
      /does not support inputType=text/,
    );
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

function tempVault(): string {
  return mkdtempSync(join(tmpdir(), 'llmwiki-source-'));
}

function registerProject(vault: string, slug: string): void {
  mkdirSync(vaultJoin(vault, 'Projects'), { recursive: true });
  writeFileSync(
    vaultJoin(vault, `Projects/${slug}.md`),
    `---\ntype: project\nentity: project/${slug}\nstatus: active\n---\n`,
    'utf-8',
  );
}

function op(vault: string, name: string): Operation {
  const found = makeSourceOps(vault).find((operation) => operation.name === name);
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
