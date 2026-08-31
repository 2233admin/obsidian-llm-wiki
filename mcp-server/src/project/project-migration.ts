import { join } from 'node:path';
import type { Operation } from '../core/types.js';
import { makeErr } from '../core/types.js';
import { staticTargets } from '../core/write-policy.js';
import { runPythonWorker, PYTHON_WORKER_DIAGNOSTICS } from '../capabilities/python-worker.js';
const PYTHON_BRIDGE = 'import json,sys; import project_migration as m; '
  + 'action,vault,payload=sys.argv[1],sys.argv[2],json.loads(sys.argv[3]); '
  + 'result=(m.inventory_project_layout(vault) if action=="inventory" else '
  + 'm.plan_project_migration(vault) if action=="plan" else '
  + 'm.apply_migration_plan(m.plan_project_migration(vault), apply=bool(payload.get("apply")), batch_id=payload.get("batch_id")) if action=="apply" else '
  + 'm.restore_migration(vault, payload["manifest"], apply=bool(payload.get("apply")))); '
  + 'print(json.dumps(result, ensure_ascii=False))';

async function invokeMigration(
  python: string,
  compilerPath: string,
  vaultPath: string,
  action: 'inventory' | 'plan' | 'apply' | 'restore',
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  try {
    const result = await runPythonWorker({
      capabilityId: `project-migration-${action}`,
      executable: python,
      args: ['-c', PYTHON_BRIDGE, action, vaultPath, JSON.stringify(payload)],
      cwd: compilerPath,
      timeoutMs: 120_000,
      maxBuffer: 20 * 1024 * 1024,
      environment: { ...process.env },
    });
    if (!result.ok) {
      const diagnostic = result.diagnosticCode ?? PYTHON_WORKER_DIAGNOSTICS.spawnFailed;
      throw new Error(`${diagnostic}: ${result.stderr.trim() || 'project migration worker failed'}`);
    }
    return JSON.parse(result.stdout);
  } catch (error) {
    throw makeErr(-32000, `Project migration ${action} failed: ${(error as Error).message}`);
  }
}

export function makeProjectMigrationOps(options: {
  python: string;
  compilerPath: string;
  vaultPath: string;
}): Operation[] {
  const { python, compilerPath, vaultPath } = options;
  const migrationTargets = staticTargets(
    'Projects/**',
    '01-Projects/**',
    '.vault-mind/local-bindings.json',
    '.vault-mind/project-migrations/**',
  );
  return [
    {
      name: 'project.migration.inventory',
      namespace: 'project',
      description: 'Inventory registry, Work-OS, knowledge, legacy work, bindings, leases, and workflow representations without writing.',
      mutating: false,
      params: {},
      handler: async () => invokeMigration(python, compilerPath, vaultPath, 'inventory'),
    },
    {
      name: 'project.migration.plan',
      namespace: 'project',
      description: 'Build a deterministic, hash-guarded Project layout migration plan. This operation is always side-effect free.',
      mutating: false,
      params: {},
      handler: async () => invokeMigration(python, compilerPath, vaultPath, 'plan'),
    },
    {
      name: 'project.migration.apply',
      namespace: 'project',
      description: 'Plan by default; apply canonical Project writes atomically only when apply=true, with resumable audit manifests.',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        shouldWrite: (_ctx, params) => params.apply === true,
        targets: migrationTargets,
        audit: 'required',
      },
      params: {
        apply: { type: 'boolean', required: false, default: false, description: 'Explicitly apply the current deterministic plan (default: false)' },
        batch_id: { type: 'string', required: false, description: 'Safe resumable batch identifier; defaults to the plan hash prefix' },
      },
      handler: async (_ctx, params) => invokeMigration(python, compilerPath, vaultPath, 'apply', {
        apply: params.apply === true,
        batch_id: params.batch_id,
      }),
    },
    {
      name: 'project.migration.restore',
      namespace: 'project',
      description: 'Preview by default; restore one applied migration manifest only when apply=true and hash preconditions still hold.',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        shouldWrite: (_ctx, params) => params.apply === true,
        targets: migrationTargets,
        audit: 'required',
      },
      params: {
        manifest: { type: 'string', required: true, description: 'Vault-relative manifest under .vault-mind/project-migrations/<batch>/manifest.json' },
        apply: { type: 'boolean', required: false, default: false, description: 'Explicitly restore the batch (default: false)' },
      },
      handler: async (_ctx, params) => {
        if (typeof params.manifest !== 'string' || !params.manifest.trim()) throw makeErr(-32602, 'manifest required');
        const manifest = join(vaultPath, params.manifest);
        return invokeMigration(python, compilerPath, vaultPath, 'restore', { manifest, apply: params.apply === true });
      },
    },
  ];
}
