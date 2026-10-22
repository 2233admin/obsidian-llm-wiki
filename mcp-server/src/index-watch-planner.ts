export interface IndexWatchPlannerOptions {
  readonly debounceMs: number;
}

export class IndexWatchPlanner {
  private readonly debounceMs: number;
  private readonly lastSeen = new Map<string, number>();

  constructor(options: IndexWatchPlannerOptions) {
    if (!Number.isFinite(options.debounceMs) || options.debounceMs < 0) {
      throw new Error(
        `IndexWatchPlanner debounceMs must be a non-negative finite number, got ${options.debounceMs}`,
      );
    }
    this.debounceMs = options.debounceMs;
  }

  get pendingCount(): number {
    return this.lastSeen.size;
  }

  record(path: string, atMs: number): void {
    if (!Number.isFinite(atMs)) throw new Error(`IndexWatchPlanner event time must be finite, got ${atMs}`);
    this.lastSeen.set(path, atMs);
  }

  due(nowMs: number): string[] {
    const due: string[] = [];
    for (const [path, lastSeen] of this.lastSeen) {
      if (nowMs - lastSeen >= this.debounceMs) due.push(path);
    }
    return due.sort();
  }

  take(nowMs: number): string[] {
    const paths = this.due(nowMs);
    for (const path of paths) this.lastSeen.delete(path);
    return paths;
  }

  nextDueAt(): number | null {
    let next: number | null = null;
    for (const lastSeen of this.lastSeen.values()) {
      const dueAt = lastSeen + this.debounceMs;
      if (next === null || dueAt < next) next = dueAt;
    }
    return next;
  }
}
