import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, utimes } from "node:fs/promises";
import { dirname, join } from "node:path";

import { canonicalJson } from "./canonical.js";
import { DomainLockTimeoutError, DomainValidationError } from "./errors.js";

export const DEFAULT_STALE_LOCK_MS = 5 * 60_000;

export interface FileLockOptions {
  lockPath: string;
  now: () => string;
  timeoutMs: number;
  retryMs: number;
  staleLockMs?: number;
}

interface LockOwnerRecord {
  schemaVersion: 1;
  ownerId: string;
  pid: number;
  acquiredAt: string;
}

/**
 * Acquire a local filesystem lock with owner-aware release and conservative
 * stale-owner recovery. The lock heartbeat uses filesystem mtime so injected
 * domain clocks cannot accidentally expire a live process lock.
 */
export async function withRecoverableFileLock<R>(options: FileLockOptions, action: () => Promise<R>): Promise<R> {
  const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  if (!Number.isFinite(staleLockMs) || staleLockMs < 1) throw new DomainValidationError("staleLockMs must be a positive number");
  const owner: LockOwnerRecord = {
    schemaVersion: 1,
    ownerId: randomUUID(),
    pid: process.pid,
    acquiredAt: options.now(),
  };
  const serializedOwner = `${canonicalJson(owner)}\n`;
  await mkdir(dirname(options.lockPath), { recursive: true });
  const deadline = Date.now() + options.timeoutMs;
  while (true) {
    try {
      const handle = await open(options.lockPath, "wx", 0o600);
      try {
        await handle.writeFile(serializedOwner, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await quarantineStaleLock(options.lockPath, staleLockMs)) continue;
      if (Date.now() >= deadline) throw new DomainLockTimeoutError(options.lockPath, options.timeoutMs);
      await delay(Math.min(options.retryMs, Math.max(1, deadline - Date.now())));
    }
  }

  const heartbeatMs = Math.max(5, Math.floor(staleLockMs / 3));
  const heartbeat = setInterval(() => {
    void heartbeatOwnedLock(options.lockPath, owner.ownerId);
  }, heartbeatMs);
  heartbeat.unref?.();
  try {
    return await action();
  } finally {
    clearInterval(heartbeat);
    await releaseOwnedLock(options.lockPath, owner.ownerId);
  }
}

async function quarantineStaleLock(lockPath: string, staleLockMs: number): Promise<boolean> {
  let lockStat;
  let observed: string;
  try {
    lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs < staleLockMs) return false;
    observed = await readFile(lockPath, "utf8");
    if (ownerProcessIsAlive(observed)) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }

  const quarantinePath = join(dirname(lockPath), `.stale-lock-${randomUUID()}`);
  try {
    await rename(lockPath, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
  const claimed = await readFile(quarantinePath, "utf8");
  const claimedStat = await stat(quarantinePath);
  if (claimed !== observed || Date.now() - claimedStat.mtimeMs < staleLockMs || ownerProcessIsAlive(claimed)) {
    // A newer owner replaced the observed lock during takeover. Restore it only
    // when the canonical lock path is still empty; never delete unknown ownership.
    try {
      await stat(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await rename(quarantinePath, lockPath);
      } catch {
        // A concurrent owner won the path. Preserve the quarantined record.
      }
    }
    return false;
  }
  await rm(quarantinePath, { force: true });
  return true;
}

function ownerProcessIsAlive(serializedOwner: string): boolean {
  let owner: Partial<LockOwnerRecord>;
  try {
    owner = JSON.parse(serializedOwner) as Partial<LockOwnerRecord>;
  } catch {
    // Malformed lock metadata is not authority to evict a possibly live writer.
    return true;
  }
  if (!Number.isInteger(owner.pid) || (owner.pid as number) <= 0) return true;
  try {
    process.kill(owner.pid as number, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

async function heartbeatOwnedLock(lockPath: string, ownerId: string): Promise<void> {
  try {
    if ((await readOwnerId(lockPath)) !== ownerId) return;
    const now = new Date();
    await utimes(lockPath, now, now);
  } catch {
    // Acquisition timeout/recovery remains the source of truth. A transient
    // heartbeat failure must not turn application work into an unhandled error.
  }
}

async function releaseOwnedLock(lockPath: string, ownerId: string): Promise<void> {
  try {
    if ((await readOwnerId(lockPath)) === ownerId) await rm(lockPath, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function readOwnerId(lockPath: string): Promise<string | null> {
  const raw = JSON.parse(await readFile(lockPath, "utf8")) as Partial<LockOwnerRecord>;
  return typeof raw.ownerId === "string" ? raw.ownerId : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
