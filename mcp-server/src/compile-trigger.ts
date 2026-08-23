/**
 * Compile trigger -- dirty queue + auto-batch compilation.
 *
 * Tracks vault file changes (create/modify in raw/ paths).
 * When dirty count >= threshold, routes a compile Run through the worker port.
 * Also supports manual trigger via compile.run MCP method.
 */

import { execFile } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { DurableMaintenanceQueue, type MaintenancePlan } from "./maintenance/queue.js";
import type { CompileExecutionContext, CompilePromotionResult, CompileRunPort, CompileRunTrigger, CompileVerificationResult } from "./compile/compile-run-port.js";
import type { CompileResult, CompileStatus } from "./compile/types.js";
import { PythonCompileWorker } from "./compile/compile-worker.js";
import type { VaultStore } from "./vault/store.js";

export type { CompileResult, CompileStatus } from "./compile/types.js";

const exec = promisify(execFile);

export interface CompileTriggerConfig {
  /** Path to vault root */
  vaultPath: string;
  /** Path to compiler directory (where compile.py lives) */
  compilerPath: string;
  /** Python executable (default: "python") */
  python?: string;
  /** Dirty count threshold for auto-compile (default: 3) */
  threshold?: number;
  /** Model tier for LLM extraction (default: "haiku") */
  tier?: string;
  /** Authoritative VaultStore used for verified staging promotion. */
  vaultStore?: VaultStore;
  /** Auto-compile enabled (default: true) */
  autoCompile?: boolean;
  /** Called after successful compile with list of modified wiki paths for re-indexing */
  onCompileSuccess?: (wikiPaths: string[]) => void;
  /** Resolve child-process environment immediately before model invocation. */
  environmentResolver?: () => Promise<NodeJS.ProcessEnv>;
  /** Durable debounce/deadline scheduler, or the reversible legacy threshold trigger. */
  schedulingMode?: "durable" | "legacy-threshold";
  debounceMs?: number;
  maximumLagMs?: number;
  drainMaxTopics?: number;
  drainTimeBudgetMs?: number;
}

export class CompileTrigger {
  private dirty = new Set<string>();
  private running = false;
  private lastRun: string | null = null;
  private lastResult: CompileResult | null = null;

  private readonly vaultPath: string;
  private readonly compilerPath: string;
  private readonly python: string;
  private readonly threshold: number;
  private readonly autoCompile: boolean;
  private readonly onCompileSuccess?: (wikiPaths: string[]) => void;
  private readonly worker: PythonCompileWorker;
  private readonly schedulingMode: "durable" | "legacy-threshold";
  private readonly debounceMs: number;
  private readonly maximumLagMs: number;
  private readonly drainMaxTopics: number;
  private readonly drainTimeBudgetMs: number;
  private readonly maintenanceQueue?: DurableMaintenanceQueue;
  private maintenanceTimer?: NodeJS.Timeout;
  private scheduledRunner?: (trigger: CompileRunTrigger, topic: string) => Promise<CompileResult>;

  constructor(config: CompileTriggerConfig) {
    this.vaultPath = config.vaultPath;
    this.compilerPath = config.compilerPath;
    this.python = config.python ?? "python";
    this.threshold = config.threshold ?? 3;
    this.autoCompile = config.autoCompile ?? true;
    this.onCompileSuccess = config.onCompileSuccess;
    this.worker = new PythonCompileWorker({
      vaultPath: config.vaultPath,
      compilerPath: config.compilerPath,
      python: this.python,
      tier: config.tier ?? "haiku",
      vaultStore: config.vaultStore,
      environmentResolver: config.environmentResolver,
    });
    this.schedulingMode = config.schedulingMode ?? "legacy-threshold";
    this.debounceMs = config.debounceMs ?? 30_000;
    this.maximumLagMs = config.maximumLagMs ?? 5 * 60_000;
    this.drainMaxTopics = config.drainMaxTopics ?? 16;
    this.drainTimeBudgetMs = config.drainTimeBudgetMs ?? 120_000;
    this.maintenanceQueue = this.schedulingMode === "durable"
      ? new DurableMaintenanceQueue(this.vaultPath)
      : undefined;
  }

  setEnvironmentResolver(resolver: () => Promise<NodeJS.ProcessEnv>): void {
    this.worker.setEnvironmentResolver(resolver);
  }

  /** Route scheduled work through the durable CompileRunPort once the host wires it. */
  setRunScheduler(port: CompileRunPort): void {
    this.scheduledRunner = async (trigger, topic) => {
      const handle = await port.submit({ trigger, topic });
      const receipt = await handle.wait();
      return receipt.result ?? {
        ok: receipt.status === "succeeded",
        topic,
        sourcesCompiled: 0,
        conceptsCreated: 0,
        contradictions: 0,
        ...(receipt.status === "succeeded" ? {} : { error: receipt.diagnostics.at(-1)?.message ?? receipt.status }),
        timestamp: receipt.finishedAt ?? new Date().toISOString(),
      };
    };
  }

  /**
   * Called when a vault file is created or modified.
   * Enqueues to dirty set; triggers auto-compile if threshold reached.
   */
  onFileChange(path: string, type: "create" | "modify" | "delete"): void {
    // Only track raw/ or top-level md files (not wiki/ output)
    if (path.includes("/wiki/") || path.includes("\\wiki\\")) return;
    if (!path.endsWith(".md")) return;

    this.dirty.add(path);
    process.stderr.write(`llmwiki: [compile] dirty +1: ${path} (${this.dirty.size}/${this.threshold})\n`);

    if (this.maintenanceQueue) {
      const topic = topicFromPath(path);
      if (topic) {
        this.maintenanceQueue.enqueue({
          sourceIds: [path.replace(/\\/g, "/")],
          topicKeys: [topic],
          dirtyReasons: [`file-${type}`],
          debounceMs: this.debounceMs,
          maximumLagMs: this.maximumLagMs,
        });
        if (this.autoCompile) this.scheduleMaintenance();
      }
    } else if (this.autoCompile && this.dirty.size >= this.threshold && !this.running) {
      this.autoTrigger();
    }
  }

  /** Manual trigger for a specific topic. */
  async run(topic?: string, context?: CompileExecutionContext): Promise<CompileResult> {
    if (this.running) {
      return {
        ok: false,
        topic: topic ?? "unknown",
        sourcesCompiled: 0,
        conceptsCreated: 0,
        contradictions: 0,
        error: "Compilation already running",
        timestamp: new Date().toISOString(),
      };
    }

    const targetTopic = topic ?? this.detectTopic();
    if (!targetTopic) {
      return {
        ok: false,
        topic: "",
        sourcesCompiled: 0,
        conceptsCreated: 0,
        contradictions: 0,
        error: "No topic specified and no dirty files to detect topic from",
        timestamp: new Date().toISOString(),
      };
    }

    return this.compile(targetTopic, context);
  }

  async promote(
    topic: string | undefined,
    context: CompileExecutionContext,
    result: CompileResult,
  ): Promise<CompilePromotionResult> {
    const promoted = await this.worker.promote(topic, context, result);
    if (promoted.promotion.status === "promoted") {
      this.finalizeCompile(topic ?? result.topic);
    } else {
      this.lastResult = promoted.result;
    }
    return promoted;
  }

  async verify(
    topic: string | undefined,
    context: CompileExecutionContext,
    result: CompileResult,
  ): Promise<CompileVerificationResult> {
    return this.worker.verify(topic, context, result);
  }

  /** Get current status. */
  status(): CompileStatus {
    const plan = this.maintenanceQueue?.plan({
      reportOnly: true,
      maxTopics: this.drainMaxTopics,
      accept: (entry) => this.isCompileEntry(entry.topicKeys),
    });
    return {
      dirty: [...this.dirty],
      dirtyCount: this.dirty.size,
      threshold: this.threshold,
      running: this.running,
      lastRun: this.lastRun,
      lastResult: this.lastResult,
      autoCompile: this.autoCompile,
      schedulingMode: this.schedulingMode,
      ...(plan ? {
        maintenance: {
          eligible: plan.eligible.length,
          deferred: plan.deferred.length,
          quarantined: plan.quarantined.length,
          ...(plan.nextWakeAt ? { nextWakeAt: plan.nextWakeAt } : {}),
        },
      } : {}),
    };
  }

  maintenancePlan(options: { now?: Date; reportOnly?: boolean; maxTopics?: number } = {}): MaintenancePlan | undefined {
    return this.maintenanceQueue?.plan({
      now: options.now,
      reportOnly: options.reportOnly ?? true,
      maxTopics: options.maxTopics ?? this.drainMaxTopics,
      accept: (entry) => this.isCompileEntry(entry.topicKeys),
    });
  }

  async drainMaintenance(options: {
    owner?: string;
    maxTopics?: number;
    timeBudgetMs?: number;
    /** Injectable clock for deterministic CI/report-to-execute verification. */
    now?: () => Date;
  } = {}): Promise<Record<string, unknown>> {
    if (!this.maintenanceQueue) {
      return { ok: false, schedulingMode: this.schedulingMode, error: "Durable maintenance queue disabled" };
    }
    const result = await this.maintenanceQueue.drain(async (entry) => {
      const topic = entry.topicKeys[0];
      if (!topic) throw Object.assign(new Error("topic missing"), { code: "MAINTENANCE_TOPIC_MISSING", transient: false });
      const compiled = this.scheduledRunner
        ? await this.scheduledRunner("maintenance", topic)
        : await this.compile(topic);
      if (!compiled.ok) throw Object.assign(new Error("compile failed"), { code: "MAINTENANCE_COMPILE_FAILED", transient: true });
    }, {
      owner: options.owner ?? `compile-trigger/${process.pid}`,
      maxTopics: options.maxTopics ?? this.drainMaxTopics,
      timeBudgetMs: options.timeBudgetMs ?? this.drainTimeBudgetMs,
      now: options.now,
      accept: (entry) => this.isCompileEntry(entry.topicKeys),
    });
    if (this.autoCompile) this.scheduleMaintenance();
    return { ok: true, schedulingMode: this.schedulingMode, ...result };
  }

  /**
   * Scan vault topics on startup using kb_meta.py diff.
   * Populates dirty set with files that changed while the server was offline.
   */
  async loadInitialDirty(): Promise<void> {
    if (!this.vaultPath) return;
    const kbMeta = resolve(this.compilerPath, "kb_meta.py");
    if (!existsSync(kbMeta)) return;

    let topics: string[];
    try {
      topics = readdirSync(this.vaultPath, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(resolve(this.vaultPath, d.name, "_meta.json")))
        .map((d) => d.name);
    } catch {
      return;
    }

    for (const topic of topics) {
      try {
        const { stdout } = await exec(this.python, [kbMeta, "diff", this.vaultPath, topic], {
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
          env: { ...process.env },
        });
        const result = JSON.parse(stdout) as { new?: string[]; changed?: string[] };
        const dirty = [...(result.new ?? []), ...(result.changed ?? [])];
        for (const f of dirty) {
          if (f.endsWith(".md") && !f.includes("/wiki/")) {
            const path = `${topic}/${f}`;
            this.dirty.add(path);
            this.maintenanceQueue?.enqueue({
              sourceIds: [path],
              topicKeys: [topic],
              dirtyReasons: ["startup-diff"],
              debounceMs: this.debounceMs,
              maximumLagMs: this.maximumLagMs,
            });
          }
        }
        if (dirty.length > 0) {
          process.stderr.write(
            `llmwiki: [compile] startup: ${dirty.length} dirty in "${topic}"\n`,
          );
        }
      } catch {
        // No meta or diff failed -- topic is clean, skip
      }
    }
    if (this.autoCompile && this.maintenanceQueue) this.scheduleMaintenance();
  }

  /** Delegate cancellation to the worker that owns the child process. */
  abort(): { ok: boolean; message: string; confirmed: boolean } {
    if (this.maintenanceTimer) {
      clearTimeout(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
    if (!this.running) return { ok: false, message: "No compilation running", confirmed: false };
    const attempt = this.worker.abort();
    return { ...attempt, confirmed: attempt.confirmed ?? false };
  }

  // --- Internal ---

  private autoTrigger(): void {
    if (this.running) return;
    const topic = this.detectTopic();
    if (!topic) return;
    process.stderr.write(`llmwiki: [compile] auto-trigger for topic "${topic}" (${this.dirty.size} dirty)\n`);
    const run = this.scheduledRunner
      ? this.scheduledRunner("auto", topic)
      : (() => {
        this.running = true; // claim lock synchronously for the legacy direct path
        return this.compile(topic);
      })();
    run.catch((e) => {
      this.running = false;
      process.stderr.write(`llmwiki: [compile] auto-trigger error: ${(e as Error).message}\n`);
    });
  }

  private scheduleMaintenance(): void {
    if (!this.maintenanceQueue || this.maintenanceTimer || this.running) return;
    const plan = this.maintenanceQueue.plan({
      reportOnly: true,
      maxTopics: this.drainMaxTopics,
      accept: (entry) => this.isCompileEntry(entry.topicKeys),
    });
    const wakeAt = plan.eligible.length > 0
      ? Date.now()
      : plan.nextWakeAt ? Date.parse(plan.nextWakeAt) : undefined;
    if (wakeAt === undefined) return;
    const delay = Math.max(0, Math.min(2_147_000_000, wakeAt - Date.now()));
    this.maintenanceTimer = setTimeout(() => {
      this.maintenanceTimer = undefined;
      this.drainMaintenance().catch((error) => {
        process.stderr.write(`llmwiki: [maintenance] drain failed: ${(error as Error).message}\n`);
        this.scheduleMaintenance();
      });
    }, delay);
    this.maintenanceTimer.unref?.();
  }

  private detectTopic(): string | null {
    // Infer topic from the first dirty file's top-level directory
    for (const path of this.dirty) {
      const normalized = path.replace(/\\/g, "/");
      const parts = normalized.split("/");
      if (parts.length >= 2) return parts[0];
    }
    return null;
  }

  private async compile(topic: string, context?: CompileExecutionContext): Promise<CompileResult> {
    this.running = true;
    const timestamp = new Date().toISOString();

    try {
      const result = await this.worker.run(topic, context);

      // Direct legacy calls have no Run promotion callback; they already wrote the
      // live compatibility path and can finalize here. Durable Runs finalize only
      // from promote(), after verification and the staging gate pass.
      if (result.ok && !context) this.finalizeCompile(topic);

      this.lastRun = timestamp;
      this.lastResult = result;
      this.running = false;
      return result;
    } catch (e) {
      const result: CompileResult = {
        ok: false,
        topic,
        sourcesCompiled: 0,
        conceptsCreated: 0,
        contradictions: 0,
        error: (e as Error).message,
        timestamp,
      };
      this.lastRun = timestamp;
      this.lastResult = result;
      this.running = false;
      return result;
    }
  }

  private finalizeCompile(topic: string): void {
    for (const path of [...this.dirty]) {
      if (path.startsWith(topic + "/") || path.startsWith(topic + "\\")) this.dirty.delete(path);
    }
    if (this.onCompileSuccess) this.onCompileSuccess(this.findWikiFiles(topic));
  }

  /** Find all wiki/ output files for a topic after compilation */
  private findWikiFiles(topic: string): string[] {
    const wikiDir = resolve(this.vaultPath, topic, "wiki");
    if (!existsSync(wikiDir)) return [];
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const full = resolve(d, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.name.endsWith(".md")) files.push(full);
      }
    };
    walk(wikiDir);
    return files;
  }

  private isCompileEntry(topicKeys: readonly string[]): boolean {
    return topicKeys.some((topic) => existsSync(resolve(this.vaultPath, topic, "_meta.json")));
  }
}

function topicFromPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const [topic, child] = normalized.split("/");
  return topic && child ? topic : undefined;
}
