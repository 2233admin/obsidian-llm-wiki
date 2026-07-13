import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Operation, OperationContext } from '../core/types.js';
import {
  makeProjectContextOps,
  normalizedProjectContext,
  parseProjectId,
  resolveProjectContext,
  scanProjectRegistry,
} from './project-context.js';

function makeFixture() {
  const root = join(tmpdir(), `llmwiki-project-context-${randomUUID()}`);
  const workspace = join(root, 'workspace', 'alpha-checkout');
  mkdirSync(join(root, 'Projects'), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(root, '.vault-mind'), { recursive: true });
  writeFileSync(
    join(root, 'Projects', 'alpha.md'),
    [
      '---',
      'entity: project/alpha',
      'type: project',
      'status: active',
      'aliases: [Alpha App, legacy-alpha]',
      'projections:',
      '  github: github:Radiant303/alpha',
      '  token: must-not-be-exposed',
      'path: this-field-must-not-be-exposed',
      '---',
      '',
      '# Alpha',
      '',
    ].join('\n'),
    'utf-8',
  );
  writeFileSync(
    join(root, '.vault-mind', 'local-bindings.json'),
    JSON.stringify({ 'project/alpha': { path: workspace.replaceAll('\\', '/') } }, null, 2),
    'utf-8',
  );
  return { root, workspace };
}

describe('Project identity and context resolution', () => {
  test('ProjectId accepts only canonical project/<slug> identities', () => {
    assert.equal(parseProjectId('project/alpha'), 'project/alpha');
    assert.equal(parseProjectId(' project/alpha-2 '), 'project/alpha-2');
    for (const invalid of ['alpha', 'project/Alpha', 'project/a/b', 'project/../alpha', 'project/trailing-', 'project/']) {
      assert.throws(() => parseProjectId(invalid), { code: -32602 });
    }
  });

  test('ProjectId matches the shared cross-runtime conformance fixture', () => {
    const fixturePath = new URL('../../../compiler/tests/fixtures/project-context/identity-cases.json', import.meta.url);
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
      accepted: Array<{ input: string; project_id: string }>;
      rejected: string[];
    };
    for (const item of fixture.accepted) assert.equal(parseProjectId(item.input), item.project_id);
    for (const item of fixture.rejected) assert.throws(() => parseProjectId(item), { code: -32602 });
  });

  test('registry reads logical identity, aliases, lifecycle, binding, and safe projections', () => {
    const { root, workspace } = makeFixture();
    try {
      const registry = scanProjectRegistry(root);
      assert.equal(registry.projects.length, 1);
      assert.deepEqual(registry.projects[0], {
        projectId: 'project/alpha',
        slug: 'alpha',
        lifecycle: 'active',
        aliases: ['Alpha App', 'legacy-alpha'],
        registryPath: 'Projects/alpha.md',
        workspace: { path: workspace.replaceAll('\\', '/'), available: true },
        projections: [{ kind: 'github', target: 'github:Radiant303/alpha' }],
      });
      assert.ok(registry.diagnostics.some((item) => item.code === 'forbidden_registry_field'));
      assert.equal(JSON.stringify(registry.projects).includes('this-field-must-not-be-exposed'), false);
      assert.equal(JSON.stringify(registry.projects).includes('must-not-be-exposed'), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('registry parses the shared cross-runtime Project record fixture', () => {
    const root = join(tmpdir(), `llmwiki-project-record-${randomUUID()}`);
    const fixturePath = new URL('../../../compiler/tests/fixtures/project-context/shared-project.md', import.meta.url);
    try {
      mkdirSync(join(root, 'Projects'), { recursive: true });
      writeFileSync(join(root, 'Projects', 'alpha.md'), readFileSync(fixturePath, 'utf-8'), 'utf-8');
      const registry = scanProjectRegistry(root);
      assert.equal(registry.projects[0].projectId, 'project/alpha');
      assert.deepEqual(registry.projects[0].aliases, ['Alpha Product', 'legacy-alpha']);
      assert.deepEqual(registry.projects[0].projections, [
        { kind: 'github', target: 'acme/alpha' },
        { kind: 'linear', target: 'ALPHA' },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('normalized Project Context matches the shared cross-runtime fixture', () => {
    const { root } = makeFixture();
    try {
      const shared = new URL('../../../compiler/tests/fixtures/project-context/shared-project.md', import.meta.url);
      writeFileSync(join(root, 'Projects', 'alpha.md'), readFileSync(shared, 'utf-8'), 'utf-8');
      const expected = JSON.parse(readFileSync(
        new URL('../../../compiler/tests/fixtures/project-context/expected-context.json', import.meta.url), 'utf-8',
      ));
      assert.deepEqual(normalizedProjectContext(resolveProjectContext(root, 'project/alpha')), expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('resolver honors exact ID, alias/slug, and local-binding order', () => {
    const { root, workspace } = makeFixture();
    try {
      const exact = resolveProjectContext(root, 'project/alpha');
      assert.equal(exact.projectId, 'project/alpha');
      assert.equal(exact.resolvedBy, 'project_id');
      assert.deepEqual(exact.roots, {
        registry: 'Projects',
        registryRecord: 'Projects/alpha.md',
        workOs: '01-Projects/alpha',
        knowledge: '10-Projects/alpha',
        runtime: '.vault-mind',
      });
      assert.equal(exact.diagnostics.some((item) => item.code === 'compatibility_reference'), false);

      const byAlias = resolveProjectContext(root, 'Alpha App');
      assert.equal(byAlias.projectId, 'project/alpha');
      assert.equal(byAlias.resolvedBy, 'alias');
      assert.ok(byAlias.diagnostics.some((item) => item.code === 'compatibility_reference'));

      const bySlug = resolveProjectContext(root, 'alpha');
      assert.equal(bySlug.projectId, 'project/alpha');
      assert.equal(bySlug.resolvedBy, 'slug');

      const byPath = resolveProjectContext(root, workspace);
      assert.equal(byPath.projectId, 'project/alpha');
      assert.equal(byPath.resolvedBy, 'workspace_binding');
      assert.ok(byPath.diagnostics.some((item) => item.code === 'workspace_reference'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('ambiguous aliases fail closed and unknown references create nothing', () => {
    const { root } = makeFixture();
    try {
      writeFileSync(
        join(root, 'Projects', 'beta.md'),
        ['---', 'entity: project/beta', 'type: project', 'status: active', 'aliases: [Alpha App]', '---', ''].join('\n'),
        'utf-8',
      );
      assert.throws(() => resolveProjectContext(root, 'Alpha App'), { code: -32010 });

      const before = existsSync(join(root, '01-Projects', 'unknown'));
      assert.equal(before, false);
      assert.throws(() => resolveProjectContext(root, 'unknown'), { code: -32004 });
      assert.equal(existsSync(join(root, '01-Projects', 'unknown')), false);
      assert.equal(existsSync(join(root, '10-Projects', 'unknown')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an unavailable local workspace does not make Project Context unavailable', () => {
    const { root } = makeFixture();
    try {
      const missing = join(root, 'workspace', 'moved-away').replaceAll('\\', '/');
      writeFileSync(
        join(root, '.vault-mind', 'local-bindings.json'),
        JSON.stringify({ 'project/alpha': { path: missing } }),
        'utf-8',
      );
      const context = resolveProjectContext(root, 'project/alpha');
      assert.deepEqual(context.workspace, { path: missing, available: false });
      assert.ok(context.diagnostics.some((item) => item.code === 'workspace_unavailable'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('read-only registry and context operations expose the resolver', async () => {
    const { root } = makeFixture();
    try {
      const operations = makeProjectContextOps(root);
      const byName = new Map(operations.map((operation) => [operation.name, operation]));
      assert.deepEqual([...byName.keys()], [
        'project.registry.list',
        'project.registry.get',
        'project.context.resolve',
        'project.context.doctor',
      ]);
      assert.ok(operations.every((operation) => operation.mutating !== true));

      const ctx: OperationContext = {
        vault: null as never,
        adapters: null,
        config: { vault_path: root },
        logger: { info() {}, warn() {}, error() {} },
        dryRun: false,
      };
      const call = async (name: string, params: Record<string, unknown>) => {
        const operation = byName.get(name) as Operation | undefined;
        assert.ok(operation);
        return operation.handler(ctx, params);
      };

      const listed = (await call('project.registry.list', {})) as { count: number };
      assert.equal(listed.count, 1);
      const got = (await call('project.registry.get', { ref: 'legacy-alpha' })) as {
        project: { projectId: string };
      };
      assert.equal(got.project.projectId, 'project/alpha');
      const resolved = (await call('project.context.resolve', { project: 'project/alpha' })) as {
        projectId: string;
      };
      assert.equal(resolved.projectId, 'project/alpha');
      const doctor = (await call('project.context.doctor', {})) as {
        findings: Array<{ code: string }>;
        compatibility: { total: number; readyToDisable: boolean };
      };
      assert.ok(doctor.findings.some((item) => item.code === 'missing_work_os_anchor'));
      assert.ok(doctor.compatibility.total >= 1);
      assert.equal(doctor.compatibility.readyToDisable, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('compatibility references can be disabled by a release gate', () => {
    const { root } = makeFixture();
    const previous = process.env.LLMWIKI_PROJECT_COMPATIBILITY;
    try {
      process.env.LLMWIKI_PROJECT_COMPATIBILITY = 'disabled';
      assert.throws(() => resolveProjectContext(root, 'alpha'), { code: -32602 });
      assert.equal(resolveProjectContext(root, 'project/alpha').projectId, 'project/alpha');
    } finally {
      if (previous === undefined) delete process.env.LLMWIKI_PROJECT_COMPATIBILITY;
      else process.env.LLMWIKI_PROJECT_COMPATIBILITY = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
