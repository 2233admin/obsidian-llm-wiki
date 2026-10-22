export interface IndexWatchRunnerDeps {
  readonly index: (signal: AbortSignal) => Promise<unknown>;
  readonly graceMs: number;
  readonly graceWaiter?: (ms: number) => Promise<void>;
  readonly onError?: (error: unknown) => void;
}

function defaultGraceWaiter(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export class IndexWatchRunner {
  private readonly deps: IndexWatchRunnerDeps;
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private stopped = false;

  constructor(deps: IndexWatchRunnerDeps) {
    if (!Number.isFinite(deps.graceMs) || deps.graceMs < 0) {
      throw new Error(`IndexWatchRunner graceMs must be a non-negative finite number, got ${deps.graceMs}`);
    }
    this.deps = deps;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  get isFlushing(): boolean {
    return this.running !== null;
  }

  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;

    const controller = new AbortController();
    this.controller = controller;
    const run = (async () => {
      try {
        await this.deps.index(controller.signal);
      } catch (error) {
        this.deps.onError?.(error);
        // Keep the watcher alive after one failed pass.
      }
    })().finally(() => {
      this.running = null;
      this.controller = null;
    });
    this.running = run;
    return run;
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const inflight = this.running;
    if (inflight === null) return;
    this.controller?.abort();
    if (this.deps.graceMs <= 0) return;
    const wait = this.deps.graceWaiter ?? defaultGraceWaiter;
    await Promise.race([inflight, wait(this.deps.graceMs)]);
  }
}
