import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { PythonWorker, PYTHON_WORKER_DIAGNOSTICS } from "../capabilities/python-worker.js";
import { dirname, join } from "node:path";

export const AGENT_RUN_SCHEMA_VERSION = 1 as const;
export const AGENT_RUN_PROTOCOL_VERSION = 1 as const;

export const AGENT_ACTIONS = ["compile", "emerge", "reconcile", "prune", "challenge"] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];
export type AgentRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "canceled"
  | "abandoned";

export interface AgentRunRequest {
  action: AgentAction;
  mode?: "day" | "night" | "auto" | "manual";
}

export interface AgentRunResult {
  action: string;
  status: string;
  [key: string]: unknown;
}

export interface AgentRunDiagnostic {
  code: string;
  message: string;
  transient?: boolean;
}

export interface AgentRunRecord {
  schemaVersion: typeof AGENT_RUN_SCHEMA_VERSION;
  protocolVersion: typeof AGENT_RUN_PROTOCOL_VERSION;
  runId: string;
  action: AgentAction;
  mode?: AgentRunRequest["mode"];
  status: AgentRunStatus;
  requestDigest: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelRequestedAt?: string;
  result?: AgentRunResult;
  diagnostics: AgentRunDiagnostic[];
}

export interface AgentRunReceipt {
  runId: string;
  status: AgentRunStatus;
  result?: AgentRunResult;
  diagnostics: AgentRunDiagnostic[];
  startedAt?: string;
  finishedAt?: string;
}

export interface AgentRunHandle {
  readonly runId: string;
  wait(): Promise<AgentRunReceipt>;
}

export interface AgentCancelAttempt {
  ok: boolean;
  message: string;
  confirmed?: boolean;
}

export interface AgentExecutionPort {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  abort(): AgentCancelAttempt;
}

export interface AgentRunnerPort {
  submit(request: AgentRunRequest): Promise<AgentRunHandle>;
  inspect(runId: string): Promise<AgentRunRecord | undefined>;
  cancel(runId: string): Promise<AgentRunReceipt>;
  recover(): Promise<AgentRunRecord[]>;
}

const RUN_ROOT = "_llmwiki/agent-runs/v1";
const ACTIVE_STATUSES = new Set<AgentRunStatus>(["queued", "running", "cancel_requested"]);
const DEFAULT_STALE_AFTER_MS = 60_000;

export class AgentRunStore {
  constructor(private readonly vaultPath: string) {}

  get(runId: string): AgentRunRecord {
    const record = this.maybeGet(runId);
    if (!record) throw new Error(`Agent Run not found: ${runId}`);
    return record;
  }

  maybeGet(runId: string): AgentRunRecord | undefined {
    const path = this.runPath(runId);
    if (!existsSync(path)) return undefined;
    return readAgentRun(JSON.parse(readFileSync(path, "utf8")) as unknown);
  }

  list(): AgentRunRecord[] {
    const root = join(this.vaultPath, ...RUN_ROOT.split("/"));
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.maybeGet(`agent-run/${name.slice(0, -5)}`))
      .filter((record): record is AgentRunRecord => record !== undefined)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  create(record: AgentRunRecord): AgentRunRecord {
    const path = this.runPath(record.runId);
    withLock(path, () => {
      if (existsSync(path)) throw new Error(`Agent Run already exists: ${record.runId}`);
      atomicJson(path, record);
    });
    return record;
  }

  update(runId: string, update: (current: AgentRunRecord) => AgentRunRecord): AgentRunRecord {
    const path = this.runPath(runId);
    return withLock(path, () => {
      const next = readAgentRun(update(this.get(runId)));
      atomicJson(path, next);
      return next;
    });
  }

  private runPath(runId: string): string {
    assertRunId(runId);
    return join(this.vaultPath, ...`${RUN_ROOT}/${runId.slice("agent-run/".length)}.json`.split("/"));
  }
}

/** Durable lifecycle adapter around the legacy evaluate.py action runner. */
export class LegacyAgentRunnerAdapter implements AgentRunnerPort {
  private readonly store: AgentRunStore;
  private readonly now: () => Date;
  private readonly staleAfterMs: number;
  private readonly runId: () => string;

  constructor(
    private readonly execution: AgentExecutionPort,
    options: {
      vaultPath: string;
      now?: () => Date;
      staleAfterMs?: number;
      runId?: () => string;
    },
  ) {
    this.store = new AgentRunStore(options.vaultPath);
    this.now = options.now ?? (() => new Date());
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.runId = options.runId ?? (() => `agent-run/${randomUUID()}`);
  }

  async submit(request: AgentRunRequest): Promise<AgentRunHandle> {
    assertRequest(request);
    const now = this.now().toISOString();
    const runId = this.runId();
    const record: AgentRunRecord = {
      schemaVersion: AGENT_RUN_SCHEMA_VERSION,
      protocolVersion: AGENT_RUN_PROTOCOL_VERSION,
      runId,
      action: request.action,
      ...(request.mode ? { mode: request.mode } : {}),
      status: "queued",
      requestDigest: digestRequest(request),
      createdAt: now,
      updatedAt: now,
      diagnostics: [],
    };
    this.store.create(record);
    const completion = this.execute(record.runId, request);
    return { runId, wait: () => completion };
  }

  async inspect(runId: string): Promise<AgentRunRecord | undefined> {
    return this.store.maybeGet(runId);
  }

  async cancel(runId: string): Promise<AgentRunReceipt> {
    const current = this.store.get(runId);
    if (!ACTIVE_STATUSES.has(current.status)) return toReceipt(current);

    const attempt = this.execution.abort();
    const now = this.now().toISOString();
    this.store.update(runId, (record) => ({
      ...record,
      status: attempt.confirmed === true ? "canceled" : "cancel_requested",
      cancelRequestedAt: record.cancelRequestedAt ?? now,
      updatedAt: now,
      diagnostics: attempt.ok
        ? record.diagnostics
        : [...record.diagnostics, { code: "CANCEL_REQUEST_REJECTED", message: attempt.message }],
    }));
    return toReceipt(this.store.get(runId));
  }

  async recover(): Promise<AgentRunRecord[]> {
    const now = this.now();
    const recovered: AgentRunRecord[] = [];
    for (const record of this.store.list()) {
      if (!ACTIVE_STATUSES.has(record.status)) continue;
      const reference = Date.parse(record.updatedAt);
      if (Number.isFinite(reference) && now.getTime() - reference < this.staleAfterMs) continue;
      recovered.push(this.store.update(record.runId, (current) => ({
        ...current,
        status: "abandoned",
        updatedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        diagnostics: [...current.diagnostics, {
          code: "RUN_RECOVERED_ABANDONED",
          message: "The previous runtime stopped before this Agent Run reached a terminal receipt.",
        }],
      })));
    }
    return recovered;
  }

  private async execute(runId: string, request: AgentRunRequest): Promise<AgentRunReceipt> {
    const startedAt = this.now().toISOString();
    this.store.update(runId, (record) => ({ ...record, status: "running", startedAt, updatedAt: startedAt }));
    try {
      const result = await this.execution.run(request);
      const finishedAt = this.now().toISOString();
      const current = this.store.get(runId);
      const canceled = current.status === "cancel_requested";
      const status: AgentRunStatus = canceled ? "abandoned" : isSuccessful(result) ? "succeeded" : "failed";
      const diagnostics = canceled
        ? [...current.diagnostics, {
          code: "CANCEL_OUTCOME_UNKNOWN",
          message: "Cancellation was requested, but the legacy executor did not confirm process termination.",
        }]
        : current.diagnostics;
      this.store.update(runId, (record) => ({
        ...record,
        status,
        result,
        updatedAt: finishedAt,
        finishedAt,
        diagnostics,
      }));
    } catch (error) {
      const finishedAt = this.now().toISOString();
      this.store.update(runId, (record) => ({
        ...record,
        status: record.status === "cancel_requested" ? "abandoned" : "failed",
        updatedAt: finishedAt,
        finishedAt,
        diagnostics: [...record.diagnostics, {
          code: "AGENT_EXECUTION_FAILED",
          message: error instanceof Error ? error.message : String(error),
        }],
      }));
    }
    return toReceipt(this.store.get(runId));
  }
}

export interface PythonEvaluateRunnerConfig {
  vaultPath: string;
  compilerPath: string;
  python: string;
  configPath?: string;
  environmentResolver?: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
}

/** Process ownership for evaluate.py. It is intentionally only a legacy adapter. */
export class PythonEvaluateRunner implements AgentExecutionPort {
  private readonly worker = new PythonWorker();

  constructor(private readonly config: PythonEvaluateRunnerConfig) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    assertRequest(request);
    const evaluatePy = join(this.config.compilerPath, "evaluate.py");
    const args = [evaluatePy];
    if (this.config.configPath) args.push("--config", this.config.configPath);
    args.push("--vault", this.config.vaultPath, "--trigger", request.action);
    if (request.mode && request.mode !== "manual") args.push("--mode", request.mode);
    const result = await this.worker.run({
      capabilityId: "legacy-evaluate",
      executable: this.config.python,
      args,
      timeoutMs: 300_000,
      environment: await this.config.environmentResolver?.() ?? { ...process.env },
    });
    const parsed = parseJsonObject(result.stdout);
    if (parsed) return parsed;

    const details = result.ok
      ? `${PYTHON_WORKER_DIAGNOSTICS.invalidOutput}: evaluate.py returned no JSON result`
      : `${result.diagnosticCode ?? PYTHON_WORKER_DIAGNOSTICS.spawnFailed}: ${result.stderr.trim() || "evaluate.py failed"}`;
    return {
      action: request.action,
      status: "error",
      details,
      stderr: result.stderr.trim(),
    };
  }

  abort(): AgentCancelAttempt {
    const attempt = this.worker.abort();
    if (!attempt.ok && attempt.message === "No Python worker is running") {
      return { ok: false, message: "No agent action running", confirmed: false };
    }
    return {
      ok: attempt.ok,
      message: attempt.ok ? "Agent process termination requested" : "Agent process termination was not accepted",
      confirmed: false,
    };
  }
}

function isSuccessful(result: AgentRunResult): boolean {
  return result.status === "ok" || result.status === "skipped";
}

function parseJsonObject(stdout: string): AgentRunResult | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const result = parsed as Partial<AgentRunResult>;
    if (typeof result.action !== "string" || typeof result.status !== "string") return undefined;
    return parsed as AgentRunResult;
  } catch {
    return undefined;
  }
}

function assertRequest(request: AgentRunRequest): void {
  if (!AGENT_ACTIONS.includes(request.action)) throw new Error(`Unsupported agent action: ${request.action}`);
  if (request.mode !== undefined && !["day", "night", "auto", "manual"].includes(request.mode)) {
    throw new Error(`Unsupported agent mode: ${request.mode}`);
  }
}

function assertRunId(runId: string): void {
  if (!/^agent-run\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
    throw new Error(`Invalid Agent Run id: ${runId}`);
  }
}

function digestRequest(request: AgentRunRequest): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(request)).digest("hex")}`;
}

function toReceipt(record: AgentRunRecord): AgentRunReceipt {
  return {
    runId: record.runId,
    status: record.status,
    ...(record.result ? { result: record.result } : {}),
    diagnostics: record.diagnostics,
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
  };
}

function readAgentRun(value: unknown): AgentRunRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Agent Run record");
  const record = value as Partial<AgentRunRecord>;
  if (record.schemaVersion !== AGENT_RUN_SCHEMA_VERSION || record.protocolVersion !== AGENT_RUN_PROTOCOL_VERSION) {
    throw new Error("Unsupported Agent Run record version");
  }
  assertRunId(String(record.runId));
  assertRequest({ action: record.action as AgentAction, mode: record.mode });
  const statuses = new Set<AgentRunStatus>([
    ...ACTIVE_STATUSES,
    "succeeded", "failed", "canceled", "abandoned",
  ]);
  if (typeof record.status !== "string" || !statuses.has(record.status as AgentRunStatus)) {
    throw new Error("Invalid Agent Run status");
  }
  if (!Array.isArray(record.diagnostics)) throw new Error("Invalid Agent Run diagnostics");
  return record as AgentRunRecord;
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  try {
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function withLock<T>(path: string, action: () => T): T {
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(lock, `${process.pid}:${randomUUID()}`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Agent Run is busy: ${path}`);
    throw error;
  }
  try {
    return action();
  } finally {
    rmSync(lock, { force: true });
  }
}
