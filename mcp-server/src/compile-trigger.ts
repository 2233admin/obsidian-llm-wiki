/**
 * Compile trigger -- dirty queue + auto-batch compilation.
 *
 * Tracks vault file changes (create/modify in raw/ paths).
 * When dirty count >= threshold, spawns compile.py as subprocess.
 * Also supports manual trigger via compile.run MCP method.
 */

import { execFile } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { DurableMaintenanceQueue, type MaintenancePlan } from "./maintenance/queue.js";

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

export interface CompileStatus {
  dirty: string[];
  dirtyCount: number;
  threshold: number;
  running: boolean;
  lastRun: string | null;
  lastResult: CompileResult | null;
  autoCompile: boolean;
  schedulingMode: "durable" | "legacy-threshold";
  maintenance?: {
    eligible: number;
    deferred: number;
    quarantined: number;
    nextWakeAt?: string;
  };
}

export interface CompileResult {
  ok: boolean;
  topic: string;
  sourcesCompiled: number;
  conceptsCreated: number;
  contradictions: number;
  error?: string;
  timestamp: string;
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
  private readonly tier: string;
  private readonly autoCompile: boolean;
  private readonly onCompileSuccess?: (wikiPaths: string[]) => void;
  private environmentResolver?: () => Promise<NodeJS.ProcessEnv>;
  private readonly schedulingMode: "durable" | "legacy-threshold";
  private readonly debounceMs: number;
  private readonly maximumLagMs: number;
  private readonly drainMaxTopics: number;
  private readonly drainTimeBudgetMs: number;
  private readonly maintenanceQueue?: DurableMaintenanceQueue;
  private maintenanceTimer?: NodeJS.Timeout;

  constructor(config: CompileTriggerConfig) {
    this.vaultPath = config.vaultPath;
    this.compilerPath = config.compilerPath;
    this.python = config.python ?? "python";
    this.threshold = config.threshold ?? 3;
    this.tier = config.tier ?? "haiku";
    this.autoCompile = config.autoCompile ?? true;
    this.onCompileSuccess = config.onCompileSuccess;
    this.environmentResolver = config.environmentResolver;
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
    this.environmentResolver = resolver;
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
  async run(topic?: string): Promise<CompileResult> {
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

    return this.compile(targetTopic);
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
      const compiled = await this.compile(topic);
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

  /** Abort: just resets running flag (compile.py subprocess isn't killable cleanly). */
  abort(): { ok: boolean; message: string } {
    if (this.maintenanceTimer) {
      clearTimeout(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
    if (!this.running) return { ok: false, message: "No compilation running" };
    this.running = false;
    return { ok: true, message: "Compilation abort requested" };
  }

  // --- Internal ---

  private autoTrigger(): void {
    if (this.running) return;
    const topic = this.detectTopic();
    if (!topic) return;
    this.running = true; // claim lock synchronously before async work
    process.stderr.write(`llmwiki: [compile] auto-trigger for topic "${topic}" (${this.dirty.size} dirty)\n`);
    this.compile(topic).catch((e) => {
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

  private async compile(topic: string): Promise<CompileResult> {
    this.running = true;
    const topicPath = resolve(this.vaultPath, topic);
    const compilePy = resolve(this.compilerPath, "compile.py");
    const args = [compilePy, topicPath, "--tier", this.tier];
    const timestamp = new Date().toISOString();

    try {
      const { stdout, stderr } = await exec(this.python, args, {
        timeout: 120_000, // 2 min max
        maxBuffer: 10 * 1024 * 1024,
        env: this.environmentResolver ? await this.environmentResolver() : { ...process.env },
      });

      // Parse compile report from stdout
      const result = this.parseCompileOutput(topic, stdout, timestamp);

      if (stderr) {
        process.stderr.write(`llmwiki: [compile] stderr: ${stderr.slice(0, 500)}\n`);
      }

      // Clear dirty files for this topic
      for (const path of [...this.dirty]) {
        if (path.startsWith(topic + "/") || path.startsWith(topic + "\\")) {
          this.dirty.delete(path);
        }
      }

      // Notify index to re-index vaultbrain after compile writes wiki/ files
      if (this.onCompileSuccess) {
        this.onCompileSuccess(this.findWikiFiles(topic));
      }

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

  private parseCompileOutput(topic: string, stdout: string, timestamp: string): CompileResult {
    // Parse the "=== Compilation Report ===" section from compile.py output
    const sources = this.extractNumber(stdout, "Sources compiled");
    const concepts = this.extractNumber(stdout, "Concepts created");
    const contradictions = this.extractNumber(stdout, "Contradictions");

    return {
      ok: true,
      topic,
      sourcesCompiled: sources,
      conceptsCreated: concepts,
      contradictions,
      timestamp,
    };
  }

  private extractNumber(text: string, label: string): number {
    const re = new RegExp(label + "\\s*:\\s*(\\d+)");
    const m = text.match(re);
    return m ? parseInt(m[1], 10) : 0;
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
