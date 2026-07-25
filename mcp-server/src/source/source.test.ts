import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

test('source.register audit targets use the canonical Project Context before paths', () => {
  const vault = tempVault();
  try {
    registerProject(vault, 'local-linear', 'Local Linear');
    const register = op(vault, 'source.register');
    const targets = register.writePolicy!.targets(ctx(vault), {
      project: 'Local Linear',
      platform: 'github',
    });
    assert.deepEqual(targets, [
      '_llmwiki/source-registry.json',
      '10-Projects/local-linear/sources/github/**',
    ]);
    assert.throws(
      () => register.writePolicy!.targets(ctx(vault), { project: 'missing', platform: 'github' }),
      /Project not found: missing/,
    );
    assert.equal(existsSync(vaultJoin(vault, '10-Projects')), false);
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

test('source.ingest.plan is deterministic and creates no run, capture, or vault write', async () => {
  const vault = tempVault();
  const old = process.env.VAULT_MIND_OPENCLI_CMD;
  process.env.VAULT_MIND_OPENCLI_CMD = 'opencli';
  try {
    const register = op(vault, 'source.register');
    const registered = (await register.handler(ctx(vault), {
      input: 'https://example.com/article',
    })) as Record<string, unknown>;
    const registryPath = vaultJoin(vault, '_llmwiki/source-registry.json');
    const registryBefore = readFileSync(registryPath, 'utf8');
    const filesBefore = allFiles(vault);
    const planOperation = op(vault, 'source.ingest.plan');

    assert.equal(planOperation.mutating, false);
    const first = await planOperation.handler(ctx(vault), { id: registered.id }) as Record<string, unknown>;
    const second = await planOperation.handler(ctx(vault), { id: registered.id }) as Record<string, unknown>;

    assert.deepEqual(first, second);
    assert.equal(first.status, 'ready');
    assert.equal(first.reportOnly, true);
    assert.equal(first.willCreateIngestRun, false);
    assert.deepEqual(first.writes, []);
    assert.deepEqual(first.externalEffects, []);
    assert.match(first.idempotencyKey as string, /^sha256:[a-f0-9]{64}$/);
    assert.equal(readFileSync(registryPath, 'utf8'), registryBefore);
    assert.deepEqual(allFiles(vault), filesBefore);
  } finally {
    if (old === undefined) delete process.env.VAULT_MIND_OPENCLI_CMD;
    else process.env.VAULT_MIND_OPENCLI_CMD = old;
    rmSync(vault, { recursive: true, force: true });
  }
});

test('source.ingest.plan reports missing provider capability without capture side effects', async () => {
  const vault = tempVault();
  const oldPrimary = process.env.VAULT_MIND_MEDIA_CMD;
  const oldFallback = process.env.MEDIA_TRANSCRIBE_CMD;
  delete process.env.VAULT_MIND_MEDIA_CMD;
  delete process.env.MEDIA_TRANSCRIBE_CMD;
  try {
    const registered = await op(vault, 'source.register').handler(ctx(vault), {
      input: 'https://www.youtube.com/watch?v=abc123',
    }) as Record<string, unknown>;
    const plan = await op(vault, 'source.ingest.plan').handler(ctx(vault), {
      id: registered.id,
    }) as Record<string, unknown>;
    assert.equal(plan.status, 'needs_capability');
    assert.ok((plan.capabilityRequirements as Array<Record<string, unknown>>).some(
      (requirement) => requirement.provider === 'media' && requirement.status === 'unavailable',
    ));
    assert.equal(existsSync(vaultJoin(vault, '_llmwiki/ingest-runs')), false);
  } finally {
    if (oldPrimary === undefined) delete process.env.VAULT_MIND_MEDIA_CMD;
    else process.env.VAULT_MIND_MEDIA_CMD = oldPrimary;
    if (oldFallback === undefined) delete process.env.MEDIA_TRANSCRIBE_CMD;
    else process.env.MEDIA_TRANSCRIBE_CMD = oldFallback;
    rmSync(vault, { recursive: true, force: true });
  }
});

test('source.ingest.plan binds a vaultPath plan to the current source bytes', async () => {
  const vault = tempVault();
  try {
    mkdirSync(vaultJoin(vault, 'Notes'), { recursive: true });
    writeFileSync(vaultJoin(vault, 'Notes/source.md'), '# Version one\n', 'utf8');
    const registered = await op(vault, 'source.register').handler(ctx(vault), {
      inputType: 'vaultPath',
      input: 'Notes/source.md',
    }) as Record<string, unknown>;
    const planOperation = op(vault, 'source.ingest.plan');
    const first = await planOperation.handler(ctx(vault), { id: registered.id }) as Record<string, unknown>;
    writeFileSync(vaultJoin(vault, 'Notes/source.md'), '# Version two\n', 'utf8');
    const second = await planOperation.handler(ctx(vault), { id: registered.id }) as Record<string, unknown>;

    assert.equal(first.status, 'ready');
    assert.notEqual(first.sourceVersion, second.sourceVersion);
    assert.notEqual(first.idempotencyKey, second.idempotencyKey);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('source.ingest.plan rejects a corrupted vaultPath registry entry before filesystem access', async () => {
  const vault = tempVault();
  try {
    mkdirSync(vaultJoin(vault, 'Notes'), { recursive: true });
    writeFileSync(vaultJoin(vault, 'Notes/source.md'), '# Source\n', 'utf8');
    const registered = await op(vault, 'source.register').handler(ctx(vault), {
      inputType: 'vaultPath',
      input: 'Notes/source.md',
    }) as Record<string, unknown>;
    const registryPath = vaultJoin(vault, '_llmwiki/source-registry.json');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      sources: Record<string, { canonical: string }>;
    };
    registry.sources[registered.id as string]!.canonical = 'vault:../outside.md';
    writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');

    await assert.rejects(
      () => op(vault, 'source.ingest.plan').handler(ctx(vault), { id: registered.id }),
      /traversal blocked/,
    );
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

function tempVault(): string {
  return mkdtempSync(join(tmpdir(), 'llmwiki-source-'));
}

function registerProject(vault: string, slug: string, alias?: string): void {
  mkdirSync(vaultJoin(vault, 'Projects'), { recursive: true });
  writeFileSync(
    vaultJoin(vault, `Projects/${slug}.md`),
    `---\ntype: project\nentity: project/${slug}\nstatus: active\n${alias ? `aliases: [${alias}]\n` : ''}---\n`,
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

function allFiles(root: string): string[] {
  const walk = (dir: string): string[] => {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full.slice(root.length + 1).replace(/\\/g, '/')];
    });
  };
  return walk(root).sort();
}
