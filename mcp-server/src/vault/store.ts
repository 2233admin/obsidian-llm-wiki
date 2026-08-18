import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  realpathSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { badRequest, conflict, notFound } from '../core/types.js';

const DEFAULT_LOCK_TTL_MS = 60_000;
const PROTECTED_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

export interface VaultPathOptions {
  allowRoot?: boolean;
}

export interface VaultWriteOptions {
  /** Skip locking when the caller already holds the lock for this path. */
  lock?: boolean;
}

/**
 * Synchronous domain-facing seam for Markdown/vault persistence.
 *
 * The interface intentionally speaks vault-relative paths. This keeps path
 * safety, locking, and byte-preserving writes in one adapter while allowing
 * operation handlers to remain synchronous where they currently are.
 */
export interface VaultStore {
  readonly rootPath: string;
  normalizePath(path: string, options?: VaultPathOptions): string;
  resolvePath(path: string, options?: VaultPathOptions): string;
  exists(path: string, options?: VaultPathOptions): boolean;
  isFile(path: string): boolean;
  readBytes(path: string): Buffer | null;
  readText(path: string): string | null;
  readTextRequired(path: string): string;
  ensureDirectory(path: string): void;
  writeText(path: string, content: string, options?: VaultWriteOptions): void;
  appendText(path: string, content: string, options?: VaultWriteOptions): void;
  remove(path: string, options?: VaultWriteOptions): void;
  withLock<T>(path: string, fn: () => T): T;
}

/** Filesystem adapter used by the MCP and Obsidian production composition roots. */
export class FileVaultStore implements VaultStore {
  readonly rootPath: string;
  private readonly realRootPath: string;
  private readonly lockTtlMs: number;

  constructor(rootPath: string, options: { lockTtlMs?: number } = {}) {
    this.rootPath = resolve(rootPath);
    if (!existsSync(this.rootPath)) throw notFound(`Vault not found: ${rootPath}`);
    this.realRootPath = realpathSync(this.rootPath);
    this.lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  }

  normalizePath(path: string, options: VaultPathOptions = {}): string {
    if (typeof path !== 'string') throw badRequest('path required');
    const raw = path.trim();
    if (options.allowRoot && (raw === '' || raw === '.' || raw === '/' || raw === './' || raw === '.\\')) {
      return '';
    }
    if (!raw) throw badRequest('path required');
    if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('//') || isAbsolute(raw)) {
      throw badRequest('path traversal blocked');
    }
    const normalized = raw.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (normalized.split('/').some((segment) => segment === '..' || segment === '.')) {
      throw badRequest('path traversal blocked');
    }
    const topSegment = normalized.split('/')[0];
    if (PROTECTED_DIRS.has(topSegment)) throw badRequest(`protected path: ${topSegment}`);
    return normalized;
  }

  resolvePath(path: string, options: VaultPathOptions = {}): string {
    const normalized = this.normalizePath(path, options);
    const fullPath = resolve(this.rootPath, normalized);
    const lexicalRelative = relative(this.rootPath, fullPath);
    if (lexicalRelative.startsWith('..') || isAbsolute(lexicalRelative)) {
      throw badRequest('path escapes vault');
    }
    this.assertRealPathInsideVault(fullPath);
    return fullPath;
  }

  exists(path: string, options: VaultPathOptions = {}): boolean {
    return existsSync(this.resolvePath(path, options));
  }

  isFile(path: string): boolean {
    const fullPath = this.resolvePath(path);
    return existsSync(fullPath) && statSync(fullPath).isFile();
  }

  readBytes(path: string): Buffer | null {
    const fullPath = this.resolvePath(path);
    return existsSync(fullPath) ? readFileSync(fullPath) : null;
  }

  readText(path: string): string | null {
    const content = this.readBytes(path);
    return content === null ? null : content.toString('utf-8');
  }

  readTextRequired(path: string): string {
    const content = this.readText(path);
    if (content === null) throw notFound(`Not found: ${path}`);
    return content;
  }

  ensureDirectory(path: string): void {
    mkdirSync(this.resolvePath(path, { allowRoot: true }), { recursive: true });
  }

  writeText(path: string, content: string, options: VaultWriteOptions = {}): void {
    const write = () => {
      const fullPath = this.resolvePath(path);
      mkdirSync(dirname(fullPath), { recursive: true });
      // Buffer writes keep Markdown bytes stable on Windows (no CRLF mode
      // translation) and match the Python renderer's persistence contract.
      writeFileSync(fullPath, Buffer.from(content, 'utf-8'));
    };
    if (options.lock === false) write();
    else this.withLock(path, write);
  }

  appendText(path: string, content: string, options: VaultWriteOptions = {}): void {
    const append = () => {
      const fullPath = this.resolvePath(path);
      mkdirSync(dirname(fullPath), { recursive: true });
      appendFileSync(fullPath, Buffer.from(content, 'utf-8'));
    };
    if (options.lock === false) append();
    else this.withLock(path, append);
  }

  remove(path: string, options: VaultWriteOptions = {}): void {
    const fullPath = this.resolvePath(path);
    if (!existsSync(fullPath)) return;
    const remove = () => rmSync(fullPath, { recursive: true, force: true });
    if (options.lock === false) remove();
    else this.withLock(path, remove);
  }

  withLock<T>(path: string, fn: () => T): T {
    const fullPath = this.resolvePath(path);
    mkdirSync(dirname(fullPath), { recursive: true });
    const lockPath = `${fullPath}.lock`;
    const acquire = () =>
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }), {
        encoding: 'utf-8',
        flag: 'wx',
      });

    try {
      acquire();
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const ageMs = existsSync(lockPath)
        ? Date.now() - statSync(lockPath).mtimeMs
        : this.lockTtlMs + 1;
      if (ageMs < this.lockTtlMs) throw conflict(`Lock conflict on ${path.split('/').at(-1)}`);
      rmSync(lockPath, { force: true });
      acquire();
    }

    try {
      return fn();
    } finally {
      rmSync(lockPath, { force: true });
    }
  }

  private assertRealPathInsideVault(fullPath: string): void {
    const realTarget = existsSync(fullPath)
      ? realpathSync(fullPath)
      : this.realpathExistingAncestor(dirname(fullPath));
    const realRelative = relative(this.realRootPath, realTarget);
    if (realRelative.startsWith('..') || isAbsolute(realRelative)) {
      throw badRequest('path traversal blocked');
    }
  }

  private realpathExistingAncestor(startPath: string): string {
    let current = startPath;
    while (!existsSync(current)) {
      const parent = dirname(current);
      if (parent === current) throw badRequest('path traversal blocked');
      current = parent;
    }
    return realpathSync(current);
  }
}
