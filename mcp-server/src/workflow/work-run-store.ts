import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { conflict } from '../core/types.js';
import type { RecoveryFingerprint } from '../project-hub/contract-support.js';

const WORK_RUN_LOCK_PATH = '.vault-mind/_work-run.lock';
const MAX_OUTPUT_CLAIM_ENTRIES = 256;
const MAX_OUTPUT_CLAIM_FILE_BYTES = 128 * 1024;
const MAX_OUTPUT_CLAIM_AGGREGATE_BYTES = 4 * 1024 * 1024;

export interface WorkRunStore {
  withLock<T>(action: () => T): T;
  readRun(projectSlug: string, workRunId: string): Record<string, unknown> | null;
  writeRunAtomic(projectSlug: string, workRunId: string, value: Record<string, unknown>): void;
  readLocalLease(workRunId: string): Record<string, unknown> | null;
  writeLocalLeaseAtomic(agentId: string, value: Record<string, unknown>): void;
  readRecoveryClaim(projectSlug: string, planFingerprint: RecoveryFingerprint): Record<string, unknown> | null;
  writeRecoveryClaimAtomic(projectSlug: string, planFingerprint: RecoveryFingerprint, value: Record<string, unknown>): void;
  readRecoveryToken(projectSlug: string, tokenDigest: RecoveryFingerprint): Record<string, unknown> | null;
  writeRecoveryTokenAtomic(projectSlug: string, tokenDigest: RecoveryFingerprint, value: Record<string, unknown>): void;
  readOutputClaim(projectSlug: string, outputFingerprint: RecoveryFingerprint): Record<string, unknown> | null;
  writeOutputClaimAtomic(projectSlug: string, outputFingerprint: RecoveryFingerprint, value: Record<string, unknown>): void;
  readOutputToken(projectSlug: string, tokenDigest: RecoveryFingerprint): Record<string, unknown> | null;
  writeOutputTokenAtomic(projectSlug: string, tokenDigest: RecoveryFingerprint, value: Record<string, unknown>): void;
  /** The digest-keyed Work Run claim is the canonical first-token-wins boundary. */
  readOutputRun(projectSlug: string, workRunDigest: RecoveryFingerprint): Record<string, unknown> | null;
  writeOutputRunAtomic(projectSlug: string, workRunDigest: RecoveryFingerprint, value: Record<string, unknown>): void;
  /** Strictly scan bounded output claims; callers perform full claim validation. */
  listOutputClaims(projectSlug: string): Record<string, unknown>[];
}

export function vaultJoin(vaultPath: string, relPath: string): string {
  return join(vaultPath, ...relPath.split('/'));
}

export function durableRunPath(project: string, workRunId: string): string {
  return `01-Projects/${project}/runs/${workRunId.slice('work-run/'.length)}.json`;
}

export function withFileRollback<T>(vaultPath: string, relPaths: string[], action: () => T): T {
  const preimages = [...new Set(relPaths)].map((relPath) => {
    const fullPath = vaultJoin(vaultPath, relPath);
    return { fullPath, content: existsSync(fullPath) ? readFileSync(fullPath) : null };
  });
  try {
    return action();
  } catch (error) {
    for (const preimage of preimages.reverse()) {
      if (preimage.content === null) rmSync(preimage.fullPath, { force: true });
      else {
        mkdirSync(dirname(preimage.fullPath), { recursive: true });
        writeFileSync(preimage.fullPath, preimage.content);
      }
    }
    throw error;
  }
}

function readObject(path: string, label: string, maxBytes?: number): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const bytes = readFileSync(path);
    if (maxBytes !== undefined && bytes.byteLength > maxBytes) throw new Error('file exceeds the byte limit');
    const value = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected an object');
    return value as Record<string, unknown>;
  } catch (error) {
    throw conflict(`${label} identity conflict: ${(error as Error).message}`);
  }
}

function writeJsonAtomic(path: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(temporary, path);
}

function digestPart(value: string): string {
  return value.replace(/^sha256:/, '');
}

function claimPath(vaultPath: string, project: string, kind: string, digest: string): string {
  return vaultJoin(vaultPath, `01-Projects/${project}/runs/${kind}/${digestPart(digest)}.json`);
}

function listOutputClaims(vaultPath: string, project: string): Record<string, unknown>[] {
  const directory = vaultJoin(vaultPath, `01-Projects/${project}/runs/output-claims`);
  if (!existsSync(directory)) return [];
  const names = readdirSync(directory).sort();
  if (names.length > MAX_OUTPUT_CLAIM_ENTRIES) throw conflict('Work Run output claim index exceeds the entry limit');
  let aggregateBytes = 0;
  const claims: Record<string, unknown>[] = [];
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.json$/u.test(name)) throw conflict('Work Run output claim index contains an unsafe entry');
    const bytes = readFileSync(join(directory, name));
    if (bytes.byteLength > MAX_OUTPUT_CLAIM_FILE_BYTES) throw conflict('Work Run output claim exceeds the file limit');
    aggregateBytes += bytes.byteLength;
    if (aggregateBytes > MAX_OUTPUT_CLAIM_AGGREGATE_BYTES) throw conflict('Work Run output claim index exceeds the byte limit');
    try {
      const value = JSON.parse(bytes.toString('utf8')) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected an object');
      claims.push(value as Record<string, unknown>);
    } catch (error) {
      throw conflict(`Work Run output claim identity conflict: ${(error as Error).message}`);
    }
  }
  return claims;
}

function outputRunPath(vaultPath: string, project: string, workRunDigest: RecoveryFingerprint): string {
  return claimPath(vaultPath, project, 'output-runs', workRunDigest);
}

export function createFileWorkRunStore(vaultPath: string): WorkRunStore {
  const readClaim = (project: string, kind: string, digest: string) => readObject(claimPath(vaultPath, project, kind, digest), `${kind} claim`, kind.startsWith('output-') ? MAX_OUTPUT_CLAIM_FILE_BYTES : undefined);
  const writeClaim = (project: string, kind: string, digest: string, value: Record<string, unknown>) => writeJsonAtomic(claimPath(vaultPath, project, kind, digest), value);
  return {
    withLock<T>(action: () => T): T {
      const lockPath = vaultJoin(vaultPath, WORK_RUN_LOCK_PATH);
      const token = `${process.pid}:${randomUUID()}`;
      mkdirSync(dirname(lockPath), { recursive: true });
      try {
        writeFileSync(lockPath, token, { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        throw conflict('Work Run is busy with another runtime; verify the owner and remove .vault-mind/_work-run.lock manually only after confirming no writer is active');
      }
      try {
        return action();
      } finally {
        try {
          if (readFileSync(lockPath, 'utf8') === token) rmSync(lockPath, { force: true });
        } catch {
          // A missing lock is already released; never remove a successor's token.
        }
      }
    },
    readRun(projectSlug, workRunId) {
      return readObject(vaultJoin(vaultPath, durableRunPath(projectSlug, workRunId)), 'Durable Work Run');
    },
    writeRunAtomic(projectSlug, workRunId, value) {
      writeJsonAtomic(vaultJoin(vaultPath, durableRunPath(projectSlug, workRunId)), value);
    },
    readLocalLease(workRunId) {
      const registry = readObject(vaultJoin(vaultPath, '.vault-mind/_leases.json'), 'Lease registry');
      if (!registry) return null;
      const matches = Object.values(registry).filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).work_run_id === workRunId);
      return matches.length === 1 ? matches[0]! : null;
    },
    writeLocalLeaseAtomic(agentId, value) {
      const path = vaultJoin(vaultPath, '.vault-mind/_leases.json');
      const registry = readObject(path, 'Lease registry') ?? {};
      registry[agentId] = structuredClone(value);
      writeJsonAtomic(path, registry);
    },
    readRecoveryClaim: (project, digest) => readClaim(project, 'recovery-plans', digest),
    writeRecoveryClaimAtomic: (project, digest, value) => writeClaim(project, 'recovery-plans', digest, value),
    readRecoveryToken: (project, digest) => readClaim(project, 'recovery-tokens', digest),
    writeRecoveryTokenAtomic: (project, digest, value) => writeClaim(project, 'recovery-tokens', digest, value),
    readOutputClaim: (project, digest) => readClaim(project, 'output-claims', digest),
    writeOutputClaimAtomic: (project, digest, value) => writeClaim(project, 'output-claims', digest, value),
    readOutputToken: (project, digest) => readClaim(project, 'output-tokens', digest),
    writeOutputTokenAtomic: (project, digest, value) => writeClaim(project, 'output-tokens', digest, value),
    readOutputRun: (project, workRunDigest) => readObject(outputRunPath(vaultPath, project, workRunDigest), 'Work Run output claim', MAX_OUTPUT_CLAIM_FILE_BYTES),
    writeOutputRunAtomic: (project, workRunDigest, value) => writeJsonAtomic(outputRunPath(vaultPath, project, workRunDigest), value),
    listOutputClaims: (project) => listOutputClaims(vaultPath, project),
  };
}
