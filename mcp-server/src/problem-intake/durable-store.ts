import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  canonicalDigest,
  parseProblemObservation,
  type ProblemObservation,
  type ProblemObservationId,
  type ProblemObservationRepository,
  type ProjectId,
} from '../../../packages/problem-intake/dist/src/index.js';
import type {
  LocalIssueApplyReceipt,
  LocalIssueReceiptPort,
  Sha256Digest,
} from './contracts.js';
import { assertNoSensitiveMaterial } from './safety.js';

const PROJECT_RE = /^project\/([a-z0-9][a-z0-9-]*)$/;
const SHA_RE = /^sha256:[0-9a-f]{64}$/;

function projectSlug(projectId: ProjectId): string {
  const match = PROJECT_RE.exec(projectId);
  if (!match) throw new Error('Invalid canonical Project ID');
  return match[1]!;
}

function assertInside(root: string, path: string): void {
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Problem Intake persistence path escapes the vault');
  }
}

function atomicReplace(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function problemRoot(vaultRoot: string, projectId: ProjectId): string {
  const root = join(
    vaultRoot,
    '01-Projects',
    projectSlug(projectId),
    'problem-intake',
  );
  assertInside(vaultRoot, root);
  return root;
}

function withProjectLock<T>(
  vaultRoot: string,
  projectId: ProjectId,
  action: () => T,
): T {
  const root = problemRoot(vaultRoot, projectId);
  mkdirSync(root, { recursive: true });
  const lock = join(root, '.store.lock');
  try {
    writeFileSync(lock, JSON.stringify({ pid: process.pid }), {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch {
    throw new Error('Problem Intake store is locked');
  }
  try {
    return action();
  } finally {
    rmSync(lock, { force: true });
  }
}

function observationFileName(id: ProblemObservationId): string {
  return `${canonicalDigest(id).slice('sha256:'.length)}.json`;
}

/**
 * Durable canonical observation repository. Each Project remains independently
 * portable under its Work-OS root.
 */
export class JsonFileProblemObservationRepository
implements ProblemObservationRepository {
  readonly #vaultRoot: string;

  constructor(vaultPath: string) {
    this.#vaultRoot = resolve(vaultPath);
    if (!isAbsolute(this.#vaultRoot)) throw new Error('Vault path must be absolute');
  }

  get(id: ProblemObservationId): Readonly<ProblemObservation> | undefined {
    for (const observation of this.list()) {
      if (observation.id === id) return structuredClone(observation);
    }
    return undefined;
  }

  findByFingerprint(
    projectId: ProjectId,
    observationFingerprint: string,
  ): Readonly<ProblemObservation> | undefined {
    return this.list(projectId).find(
      (observation) => observation.observationFingerprint === observationFingerprint,
    );
  }

  list(projectId?: ProjectId): readonly Readonly<ProblemObservation>[] {
    const roots = projectId
      ? [this.#observationsRoot(projectId)]
      : this.#projectSlugs().map(
          (slug) => join(this.#vaultRoot, '01-Projects', slug, 'problem-intake', 'observations'),
        );
    return roots
      .flatMap((root) => {
        if (!existsSync(root)) return [];
        return readdirSync(root)
          .filter((name) => /^[0-9a-f]{64}\.json$/.test(name))
          .map((name) => parseProblemObservation(
            JSON.parse(readFileSync(join(root, name), 'utf8')),
          ));
      })
      .sort((left, right) =>
        left.projectId.localeCompare(right.projectId) || left.id.localeCompare(right.id))
      .map((observation) => structuredClone(observation));
  }

  save(value: ProblemObservation): Readonly<ProblemObservation> {
    const observation = parseProblemObservation(value);
    const path = join(this.#observationsRoot(observation.projectId), observationFileName(observation.id));
    assertInside(this.#vaultRoot, path);
    withProjectLock(this.#vaultRoot, observation.projectId, () => {
      const existing = existsSync(path)
        ? parseProblemObservation(JSON.parse(readFileSync(path, 'utf8')))
        : undefined;
      if (existing && observation.revision < existing.revision) {
        throw new Error('Problem Observation persistence cannot move to an older revision');
      }
      if (
        existing
        && observation.revision === existing.revision
        && canonicalDigest(observation) !== canonicalDigest(existing)
      ) {
        throw new Error('Problem Observation revision bytes conflict');
      }
      atomicReplace(path, canonicalJson(observation));
    });
    return structuredClone(observation);
  }

  #observationsRoot(projectId: ProjectId): string {
    const root = join(
      problemRoot(this.#vaultRoot, projectId),
      'observations',
    );
    assertInside(this.#vaultRoot, root);
    return root;
  }

  #projectSlugs(): string[] {
    const root = join(this.#vaultRoot, '01-Projects');
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }
}

export class JsonFileLocalIssueReceiptStore implements LocalIssueReceiptPort {
  readonly #vaultRoot: string;

  constructor(vaultPath: string) {
    this.#vaultRoot = resolve(vaultPath);
  }

  get(
    projectId: ProjectId,
    transitionTokenDigest: Sha256Digest,
  ): LocalIssueApplyReceipt | undefined {
    const path = this.#path(projectId, transitionTokenDigest);
    if (!existsSync(path)) return undefined;
    return this.#parse(JSON.parse(readFileSync(path, 'utf8')), projectId, transitionTokenDigest);
  }

  put(receipt: LocalIssueApplyReceipt): void {
    const parsed = this.#parse(receipt, receipt.projectId, receipt.transitionTokenDigest);
    withProjectLock(this.#vaultRoot, parsed.projectId, () => {
      atomicReplace(
        this.#path(parsed.projectId, parsed.transitionTokenDigest),
        canonicalJson(parsed),
      );
    });
  }

  #path(projectId: ProjectId, digest: Sha256Digest): string {
    if (!SHA_RE.test(digest)) throw new Error('Invalid issue receipt digest');
    const path = join(
      problemRoot(this.#vaultRoot, projectId),
      'receipts',
      'issues',
      `${digest.slice('sha256:'.length)}.json`,
    );
    assertInside(this.#vaultRoot, path);
    return path;
  }

  #parse(
    value: unknown,
    projectId: ProjectId,
    digest: Sha256Digest,
  ): LocalIssueApplyReceipt {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid issue receipt');
    }
    const receipt = value as LocalIssueApplyReceipt;
    if (
      receipt.schemaVersion !== 1
      || receipt.projectId !== projectId
      || receipt.transitionTokenDigest !== digest
      || !SHA_RE.test(receipt.planFingerprint)
      || !['pending', 'applied', 'outcome_unknown'].includes(receipt.status)
      || typeof receipt.actor !== 'string'
      || typeof receipt.updatedAt !== 'string'
    ) {
      throw new Error('Invalid issue receipt');
    }
    assertNoSensitiveMaterial(receipt, 'issueReceipt');
    return structuredClone(receipt);
  }
}
