import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type {
  ContributionAction,
  ContributionReceipt,
  ContributionReceiptStore,
  PendingContributionReceipt,
  ReceiptClaim,
  Sha256Digest,
} from './contracts.js';
import { CONTRIBUTION_RECEIPT_SCHEMA_VERSION } from './contracts.js';
import { ContributionError } from './errors.js';
import { assertSha256, canonicalJson, sha256 } from './fingerprint.js';
import { containsUnsafeRemoteMaterial } from './sanitize.js';

function receiptIdentity(receipt: Pick<ContributionReceipt, 'planFingerprint' | 'action'>): string {
  return `${receipt.planFingerprint}\u0000${receipt.action}`;
}

function assertReceipt(receipt: ContributionReceipt): void {
  if (receipt.schemaVersion !== CONTRIBUTION_RECEIPT_SCHEMA_VERSION) {
    throw new ContributionError('INVALID_INPUT', 'Unsupported contribution receipt schema');
  }
  assertSha256(receipt.planFingerprint, 'receipt.planFingerprint');
  assertSha256(receipt.transitionTokenDigest, 'receipt.transitionTokenDigest');
  assertSha256(receipt.confirmationTokenDigest, 'receipt.confirmationTokenDigest');
  assertSha256(receipt.remoteFactsFingerprint, 'receipt.remoteFactsFingerprint');
  if (containsUnsafeRemoteMaterial(receipt)) {
    throw new ContributionError('SECRET_OR_PATH_UNSAFE', 'Contribution receipt contains unsafe material');
  }
}

function sameClaim(left: ContributionReceipt, right: PendingContributionReceipt): boolean {
  return left.planFingerprint === right.planFingerprint
    && left.action === right.action
    && left.transitionTokenDigest === right.transitionTokenDigest
    && left.confirmationTokenDigest === right.confirmationTokenDigest
    && left.actor === right.actor
    && left.projectId === right.projectId
    && left.observationId === right.observationId
    && left.remoteFactsFingerprint === right.remoteFactsFingerprint;
}

export class MemoryContributionReceiptStore implements ContributionReceiptStore {
  private readonly byIdentity = new Map<string, ContributionReceipt>();
  private readonly byToken = new Map<Sha256Digest, string>();

  async claim(receipt: PendingContributionReceipt): Promise<ReceiptClaim> {
    assertReceipt(receipt);
    const identity = receiptIdentity(receipt);
    const tokenOwner = this.byToken.get(receipt.transitionTokenDigest);
    if (tokenOwner && tokenOwner !== identity) {
      throw new ContributionError('REPLAY_CONFLICT', 'transitionToken was already used for another contribution action');
    }
    const existing = this.byIdentity.get(identity);
    if (existing && existing.status !== 'cancelled') {
      return { claimed: false, receipt: existing };
    }
    this.byIdentity.set(identity, receipt);
    this.byToken.set(receipt.transitionTokenDigest, identity);
    return { claimed: true, receipt };
  }

  async replace(receipt: ContributionReceipt): Promise<void> {
    assertReceipt(receipt);
    const identity = receiptIdentity(receipt);
    const existing = this.byIdentity.get(identity);
    if (!existing || !sameClaim(existing, receipt as PendingContributionReceipt)) {
      throw new ContributionError('REPLAY_CONFLICT', 'Receipt replacement does not match the claimed contribution action');
    }
    this.byIdentity.set(identity, receipt);
  }

  async find(
    planFingerprint: Sha256Digest,
    action: ContributionAction,
  ): Promise<ContributionReceipt | undefined> {
    return this.byIdentity.get(`${planFingerprint}\u0000${action}`);
  }
}

function receiptFileName(receipt: Pick<ContributionReceipt, 'planFingerprint' | 'action'>): string {
  return `${sha256(receiptIdentity(receipt)).slice('sha256:'.length)}.json`;
}

function canonicalReceipt(receipt: ContributionReceipt): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(receipt)), null, 2)}\n`;
}

function atomicReplace(path: string, content: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export class JsonFileContributionReceiptStore implements ContributionReceiptStore {
  private readonly root: string;

  constructor(rootPath: string) {
    const root = resolve(rootPath);
    if (!isAbsolute(root)) {
      throw new ContributionError('INVALID_INPUT', 'Receipt root must be absolute');
    }
    this.root = root;
  }

  private withLock<T>(fn: () => T): T {
    mkdirSync(this.root, { recursive: true });
    const lock = join(this.root, '.receipt-store.lock');
    try {
      writeFileSync(lock, JSON.stringify({ pid: process.pid }), { encoding: 'utf8', flag: 'wx' });
    } catch {
      throw new ContributionError('REPLAY_CONFLICT', 'Contribution receipt store is locked');
    }
    try {
      return fn();
    } finally {
      rmSync(lock, { force: true });
    }
  }

  private pathFor(receipt: Pick<ContributionReceipt, 'planFingerprint' | 'action'>): string {
    const path = resolve(this.root, receiptFileName(receipt));
    const rel = relative(this.root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new ContributionError('INVALID_INPUT', 'Receipt path escapes its configured root');
    }
    return path;
  }

  private tokenPath(transitionTokenDigest: Sha256Digest): string {
    const tokenDir = resolve(this.root, '.tokens');
    const path = resolve(tokenDir, `${transitionTokenDigest.slice('sha256:'.length)}.json`);
    const rel = relative(this.root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new ContributionError('INVALID_INPUT', 'Token marker path escapes its configured root');
    }
    return path;
  }

  private read(path: string): ContributionReceipt {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ContributionReceipt;
    assertReceipt(parsed);
    return parsed;
  }

  async claim(receipt: PendingContributionReceipt): Promise<ReceiptClaim> {
    assertReceipt(receipt);
    return this.withLock(() => {
      const identity = receiptIdentity(receipt);
      const tokenPath = this.tokenPath(receipt.transitionTokenDigest);
      if (existsSync(tokenPath)) {
        const tokenOwner = JSON.parse(readFileSync(tokenPath, 'utf8')) as { identity?: string };
        if (tokenOwner.identity !== identity) {
          throw new ContributionError('REPLAY_CONFLICT', 'transitionToken was already used for another contribution action');
        }
      }
      const path = this.pathFor(receipt);
      if (existsSync(path)) {
        const existing = this.read(path);
        if (existing.status !== 'cancelled') return { claimed: false, receipt: existing };
      }
      mkdirSync(dirname(tokenPath), { recursive: true });
      if (!existsSync(tokenPath)) {
        atomicReplace(tokenPath, `${JSON.stringify({ identity })}\n`);
      }
      atomicReplace(path, canonicalReceipt(receipt));
      return { claimed: true, receipt };
    });
  }

  async replace(receipt: ContributionReceipt): Promise<void> {
    assertReceipt(receipt);
    this.withLock(() => {
      const path = this.pathFor(receipt);
      if (!existsSync(path)) {
        throw new ContributionError('REPLAY_CONFLICT', 'Contribution receipt has no pending claim');
      }
      const existing = this.read(path);
      if (!sameClaim(existing, receipt as PendingContributionReceipt)) {
        throw new ContributionError('REPLAY_CONFLICT', 'Receipt replacement does not match the pending claim');
      }
      atomicReplace(path, canonicalReceipt(receipt));
    });
  }

  async find(
    planFingerprint: Sha256Digest,
    action: ContributionAction,
  ): Promise<ContributionReceipt | undefined> {
    const path = this.pathFor({ planFingerprint, action });
    return existsSync(path) ? this.read(path) : undefined;
  }
}
