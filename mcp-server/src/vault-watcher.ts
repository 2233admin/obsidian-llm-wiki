import { readdirSync, statSync, watch, type FSWatcher, type Stats, type WatchEventType } from "node:fs";

import { join, relative, sep } from "node:path";

import type { FileEvent } from "./adapters/interface.js";
import { PROTECTED_DIRS } from "./adapters/vaultbrain/lazy-index.js";

export interface VaultFileWatcherOptions {
  root: string;
  onEvent: (event: FileEvent) => void;
}

/**
 * Watches indexable vault files with one non-recursive watcher per directory.
 * The watcher is a change source only; indexing and compilation remain owned by
 * their existing queues and adapters.
 */
export class VaultFileWatcher {
  private readonly root: string;
  private readonly onEvent: (event: FileEvent) => void;
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly knownFiles = new Set<string>();
  private started = false;
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly knownStamps = new Map<string, number>();
  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(options: VaultFileWatcherOptions) {
    this.root = options.root;
    this.onEvent = options.onEvent;
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    if (process.platform === "win32") {
      this.scanDirectory(this.root, false);
      this.pollTimer = setInterval(() => this.scanDirectory(this.root, true), 250);
      this.pollTimer.unref?.();
    } else {
      this.watchDirectory(this.root, false);
    }
  }
  stop(): void {
    for (const watcher of this.watchers.values()) watcher.close();
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.watchers.clear();
    this.retryTimers.clear();
    this.knownFiles.clear();
    this.knownStamps.clear();
    this.started = false;
  }

  private watchDirectory(dirPath: string, emitDiscovered: boolean): void {
    if (!this.started || this.watchers.has(dirPath) || this.isIgnoredPath(dirPath)) return;
    try {
      if (!statSync(dirPath).isDirectory()) return;
    } catch {
      this.scheduleRetry(dirPath, emitDiscovered);
      return;
    }

    let watcher: FSWatcher;
    try {
      watcher = watch(dirPath, (eventType, rawFilename) => {
        if (!this.started) return;
        const name = rawFilename?.toString();
        if (name) this.handleEvent(eventType, dirPath, name);
      });
    } catch {
      this.scheduleRetry(dirPath, emitDiscovered);
      return;
    }
    watcher.on("error", () => {
      this.closeWatcherSubtree(dirPath);
      this.scheduleRetry(dirPath, emitDiscovered);
    });
    this.watchers.set(dirPath, watcher);
    this.scanDirectory(dirPath, emitDiscovered);
  }

  private scanDirectory(
    dirPath: string,
    emitDiscovered: boolean,
    seen = new Set<string>(),
  ): boolean {
    try {
      let complete = true;
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          if (this.isIgnoredPath(fullPath)) continue;
          if (process.platform === "win32") {
            complete = this.scanDirectory(fullPath, emitDiscovered, seen) && complete;
          } else {
            this.watchDirectory(fullPath, emitDiscovered);
          }
        } else if (entry.isFile() && this.isIndexableFile(fullPath)) {
          const vaultRelativePath = this.relativePath(fullPath);
          const fileStamp = statSync(fullPath).mtimeMs;
          seen.add(vaultRelativePath);
          const previousStamp = this.knownStamps.get(vaultRelativePath);
          const isNew = !this.knownFiles.has(vaultRelativePath);
          this.knownFiles.add(vaultRelativePath);
          this.knownStamps.set(vaultRelativePath, fileStamp);
          if (emitDiscovered && isNew) {
            this.onEvent({ type: "create", path: vaultRelativePath, timestamp: Date.now() });
          } else if (emitDiscovered && previousStamp !== undefined && previousStamp !== fileStamp) {
            this.onEvent({ type: "modify", path: vaultRelativePath, timestamp: Date.now() });
          }
        }
      }
      if (dirPath === this.root && emitDiscovered && complete) {
        for (const knownPath of this.knownFiles) {
          if (seen.has(knownPath)) continue;
          this.knownFiles.delete(knownPath);
          this.knownStamps.delete(knownPath);
          this.onEvent({ type: "delete", path: knownPath, timestamp: Date.now() });
        }
      }
      return complete;
    } catch {
      this.closeWatcherSubtree(dirPath);
      this.scheduleRetry(dirPath, emitDiscovered);
      // A directory can disappear while it is being scanned; retrying lets
      // the watcher reconcile it when the filesystem settles.
      return false;
    }
  }
  private handleEvent(eventType: WatchEventType, dirPath: string, name: string): void {
    const fullPath = join(dirPath, name);
    let stats: Stats | null = null;
    let statError: NodeJS.ErrnoException | null = null;
    try {
      stats = statSync(fullPath);
    } catch (error) {
      statError = error as NodeJS.ErrnoException;
    }

    if (statError && statError.code !== "ENOENT") return;

    if (stats?.isDirectory()) {
      if (this.isIgnoredPath(fullPath)) {
        this.emitDeletedSubtree(this.relativePath(fullPath));
        this.closeWatcherSubtree(fullPath);
      } else if (process.platform === "win32") {
        this.scanDirectory(fullPath, true);
      } else {
        this.watchDirectory(fullPath, true);
      }
      return;
    }

    if (!stats || !stats.isFile()) {
      const relPath = this.relativePath(fullPath);
      const hadDirectory =
        process.platform === "win32"
          ? this.hasKnownFileSubtree(relPath)
          : this.hasWatcherSubtree(fullPath);
      this.closeWatcherSubtree(fullPath);
      if (hadDirectory) {
        this.emitDeletedSubtree(relPath);
      } else if (this.knownFiles.delete(relPath)) {
        this.onEvent({ type: "delete", path: relPath, timestamp: Date.now() });
      }
      return;
    }

    if (!this.isIndexableFile(fullPath)) return;
    const vaultRelativePath = this.relativePath(fullPath);
    const type = this.knownFiles.has(vaultRelativePath) || eventType === "change" ? "modify" : "create";
    this.knownFiles.add(vaultRelativePath);
    this.onEvent({ type, path: vaultRelativePath, timestamp: Date.now() });
  }

  private hasWatcherSubtree(dirPath: string): boolean {
    for (const watchedPath of this.watchers.keys()) {
      if (this.isWatcherSubtree(watchedPath, dirPath)) return true;
    }
    return false;
  }

  private hasKnownFileSubtree(relativeDirPath: string): boolean {
    const prefix = `${relativeDirPath}/`;
    for (const knownPath of this.knownFiles) {
      if (knownPath.startsWith(prefix)) return true;
    }
    return false;
  }

  private emitDeletedSubtree(relativeDirPath: string): void {
    const prefix = `${relativeDirPath}/`;
    for (const knownPath of this.knownFiles) {
      if (knownPath.startsWith(prefix)) {
        this.knownFiles.delete(knownPath);
        this.onEvent({ type: "delete", path: knownPath, timestamp: Date.now() });
      }
    }
  }

  private closeWatcherSubtree(dirPath: string): void {
    for (const [watchedPath, watcher] of this.watchers) {
      if (this.isWatcherSubtree(watchedPath, dirPath)) {
        watcher.close();
        this.watchers.delete(watchedPath);
      }
    }
  }

  private isWatcherSubtree(watchedPath: string, dirPath: string): boolean {
    const prefix = `${dirPath}${sep}`;
    return watchedPath === dirPath || watchedPath.startsWith(prefix);
  }

  private scheduleRetry(dirPath: string, emitDiscovered: boolean): void {
    if (!this.started || this.retryTimers.has(dirPath)) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(dirPath);
      if (process.platform === "win32") {
        this.scanDirectory(dirPath, emitDiscovered);
      } else {
        this.watchDirectory(dirPath, emitDiscovered);
      }
    }, 1000);
    timer.unref?.();
    this.retryTimers.set(dirPath, timer);
  }
  private isIndexableFile(filePath: string): boolean {
    return filePath.endsWith(".md") && !this.isIgnoredPath(filePath);
  }

  private isIgnoredPath(filePath: string): boolean {
    const vaultRelativePath = relative(this.root, filePath);
    if (!vaultRelativePath || vaultRelativePath === ".") return false;
    return vaultRelativePath.split(/[\\/]/).some((part) => part.startsWith(".") || PROTECTED_DIRS[part] === true);
  }

  private relativePath(filePath: string): string {
    return relative(this.root, filePath).replace(/\\/g, "/");
  }
}
