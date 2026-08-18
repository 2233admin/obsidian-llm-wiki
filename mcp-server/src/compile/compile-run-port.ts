import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type {
  CompileArtifactReceipt,
  CompilePromotionReceipt,
  CompileResult,
  CompileVerificationReport,
} from "./types.js";

export type { CompileResult } from "./types.js";
export type { CompileArtifactReceipt, CompilePromotionReceipt, CompileVerificationReport } from "./types.js";

export const COMPILE_RUN_SCHEMA_VERSION = 1 as const;
export const COMPILE_RUN_PROTOCOL_VERSION = 1 as const;

export type CompileRunTrigger = "manual" | "auto" | "maintenance";
export type CompileRunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "canceled"
  | "timed_out"
  | "abandoned";

export interface CompileRunRequest {
  topic?: string;
  trigger: CompileRunTrigger;
  promotionMode?: "automatic" | "approval-required";
}

export interface CompileRunDiagnostic {
  code: string;
  message: string;
  transient?: boolean;
}

export interface CompileRunRecord {
  schemaVersion: typeof COMPILE_RUN_SCHEMA_VERSION;
  protocolVersion: typeof COMPILE_RUN_PROTOCOL_VERSION;
  runId: string;
  trigger: CompileRunTrigger;
  topic?: string;
  promotionMode?: "automatic" | "approval-required";
  status: CompileRunStatus;
  requestDigest: string;
  /** Vault-relative durable staging directory retained with this Run. */
  stagingDir?: string;
  /** Immutable input snapshot retained so approval can resume after restart. */
  baseSnapshot?: string;
  /** Vault-relative review candidate created for approval-required Runs. */
  reviewPath?: string;
  artifacts: CompileArtifactReceipt[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelRequestedAt?: string;
  result?: CompileResult;
  verification?: CompileVerificationReport;
  promotion?: CompilePromotionReceipt;
  diagnostics: CompileRunDiagnostic[];
}

export interface CompileRunReceipt {
  runId: string;
  status: CompileRunStatus;
  result?: CompileResult;
  artifacts: CompileArtifactReceipt[];
  verification?: CompileVerificationReport;
  promotion?: CompilePromotionReceipt;
  reviewPath?: string;
  diagnostics: CompileRunDiagnostic[];
  startedAt?: string;
  finishedAt?: string;
}

export interface CompileRunHandle {
  readonly runId: string;
  wait(): Promise<CompileRunReceipt>;
}

export interface CompileCancelAttempt {
  ok: boolean;
  message: string;
  /** Legacy CompileTrigger cannot confirm process-tree termination yet. */
  confirmed?: boolean;
}

export interface CompileExecutionPort {
  run(topic?: string, context?: CompileExecutionContext): Promise<CompileResult>;
  verify?(topic: string | undefined, context: CompileExecutionContext, result: CompileResult): Promise<CompileVerificationResult>;
  promote?(topic: string | undefined, context: CompileExecutionContext, result: CompileResult): Promise<CompilePromotionResult>;
  abort(): CompileCancelAttempt;
}

export interface CompileVerificationResult {
  result: CompileResult;
  verification: CompileVerificationReport;
}

export interface CompilePromotionResult {
  result: CompileResult;
  verification: CompileVerificationReport;
  promotion: CompilePromotionReceipt;
}

export interface CompileExecutionContext {
  runId: string;
  /** Absolute staging root. The executor owns the topic subdirectory below it. */
  stagingPath: string;
  /** Executor-populated immutable input snapshot used by the promotion gate. */
  baseSnapshot?: string;
}

export interface CompileRunPort {
  submit(request: CompileRunRequest): Promise<CompileRunHandle>;
  inspect(runId: string): Promise<CompileRunRecord | undefined>;
  approve(runId: string): Promise<CompileRunReceipt>;
  cancel(runId: string): Promise<CompileRunReceipt>;
  recover(): Promise<CompileRunRecord[]>;
}

const RUN_ROOT = "_llmwiki/compile-runs/v1";
const ACTIVE_STATUSES = new Set<CompileRunStatus>(["queued", "running", "cancel_requested"]);
const APPROVAL_STATUSES = new Set<CompileRunStatus>(["awaiting_approval"]);
const DEFAULT_STALE_AFTER_MS = 60_000;
const LOCK_STALE_MS = 60_000;

export class CompileRunStore {
  constructor(private readonly vaultPath: string) {}

  get(runId: string): CompileRunRecord {
    const record = this.maybeGet(runId);
    if (!record) throw new Error(`Compile Run not found: ${runId}`);
    return record;
  }

  maybeGet(runId: string): CompileRunRecord | undefined {
    const path = this.runPath(runId);
    if (!existsSync(path)) return undefined;
    return readCompileRun(JSON.parse(readFileSync(path, "utf8")) as unknown);
  }

  list(): CompileRunRecord[] {
    const root = join(this.vaultPath, ...RUN_ROOT.split("/"));
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.maybeGet(`compile-run/${name.slice(0, -5)}`))
      .filter((record): record is CompileRunRecord => record !== undefined)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  create(record: CompileRunRecord): CompileRunRecord {
    const path = this.runPath(record.runId);
    return withLock(path, () => {
      if (existsSync(path)) throw new Error(`Compile Run already exists: ${record.runId}`);
      atomicJson(path, record);
      return record;
    });
  }

  update(runId: string, update: (current: CompileRunRecord) => CompileRunRecord): CompileRunRecord {
    const path = this.runPath(runId);
    return withLock(path, () => {
      const current = this.get(runId);
      const next = readCompileRun(update(current));
      atomicJson(path, next);
      return next;
    });
  }

  stagingPath(runId: string): string {
    assertRunId(runId);
    return join(this.vaultPath, ...`${RUN_ROOT}/${runId.slice("compile-run/".length)}/staging`.split("/"));
  }

  stagingDir(runId: string): string {
    assertRunId(runId);
    return `${RUN_ROOT}/${runId.slice("compile-run/".length)}/staging`;
  }

  reviewPath(runId: string): string {
    assertRunId(runId);
    return `00-Inbox/AI-Output/vault-compiler/compile-${runId.slice("compile-run/".length)}.md`;
  }

  writeApprovalReview(record: CompileRunRecord, state: "pending" | "approved" | "rejected"): string {
    const reviewPath = this.reviewPath(record.runId);
    const fullPath = join(this.vaultPath, ...reviewPath.split("/"));
    const topic = record.topic ?? record.result?.topic ?? "unknown";
    const artifacts = record.artifacts.length > 0
      ? record.artifacts.map((artifact) => `- ${safeReviewText(artifact.proposedTarget)} — ${safeReviewText(artifact.contentDigest)}`).join("\n")
      : "- none";
    const content = [
      "---",
      "type: compile-review",
      "agent: vault-compiler",
      `run-id: ${safeReviewText(record.runId)}`,
      `topic: ${safeReviewText(topic)}`,
      `review-status: ${state}`,
      `verification: ${record.verification?.passed === true ? "passed" : "failed"}`,
      "---",
      "",
      `# Compile Review: ${safeReviewText(topic)}`,
      "",
      `Run: ${safeReviewText(record.runId)}`,
      `Verification coverage: ${record.verification?.acceptanceCoverage ?? 0}`,
      "",
      "## Proposed artifacts",
      "",
      artifacts,
      "",
      state === "pending"
        ? "Approval is required before these staged artifacts can reach the Vault topic."
        : `Promotion review state: ${state}.`,
      "",
    ].join("\n");
    atomicText(fullPath, content);
    return reviewPath;
  }

  private runPath(runId: string): string {
    assertRunId(runId);
    return join(this.vaultPath, ...`${RUN_ROOT}/${runId.slice("compile-run/".length)}.json`.split("/"));
  }
}

/** Transitional adapter: durable Run evidence around the existing compiler trigger. */
export class LegacyCompileRunAdapter implements CompileRunPort {
  private readonly store: CompileRunStore;
  private readonly now: () => Date;
  private readonly staleAfterMs: number;
  private readonly runId: () => string;
  private readonly approvalInFlight = new Map<string, Promise<CompileRunReceipt>>();

  constructor(
    private readonly execution: CompileExecutionPort,
    options: {
      vaultPath: string;
      now?: () => Date;
      staleAfterMs?: number;
      runId?: () => string;
    },
  ) {
    this.store = new CompileRunStore(options.vaultPath);
    this.now = options.now ?? (() => new Date());
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.runId = options.runId ?? (() => `compile-run/${randomUUID()}`);
  }

  async submit(request: CompileRunRequest): Promise<CompileRunHandle> {
    const now = this.now().toISOString();
    const runId = this.runId();
    const record: CompileRunRecord = {
      schemaVersion: COMPILE_RUN_SCHEMA_VERSION,
      protocolVersion: COMPILE_RUN_PROTOCOL_VERSION,
      runId,
      trigger: request.trigger,
      ...(request.topic ? { topic: request.topic } : {}),
      promotionMode: request.promotionMode ?? "automatic",
      status: "queued",
      requestDigest: digestRequest(request),
      stagingDir: this.store.stagingDir(runId),
      artifacts: [],
      createdAt: now,
      updatedAt: now,
      diagnostics: [],
    };
    this.store.create(record);
    const completion = this.execute(record.runId, request);
    return {
      runId: record.runId,
      wait: () => completion,
    };
  }

  async inspect(runId: string): Promise<CompileRunRecord | undefined> {
    return this.store.maybeGet(runId);
  }

  async approve(runId: string): Promise<CompileRunReceipt> {
    const inFlight = this.approvalInFlight.get(runId);
    if (inFlight) return inFlight;
    const pending = this.approveInternal(runId);
    this.approvalInFlight.set(runId, pending);
    try {
      return await pending;
    } finally {
      if (this.approvalInFlight.get(runId) === pending) this.approvalInFlight.delete(runId);
    }
  }

  private async approveInternal(runId: string): Promise<CompileRunReceipt> {
    const current = this.store.get(runId);
    if (!APPROVAL_STATUSES.has(current.status)) return toReceipt(current);
    if (!current.result || !current.verification?.passed) {
      const now = this.now().toISOString();
      return toReceipt(this.store.update(runId, (record) => ({
        ...record,
        status: "failed",
        updatedAt: now,
        finishedAt: now,
        diagnostics: appendDiagnostic(record.diagnostics, {
          code: "PROMOTION_APPROVAL_INVALID",
          message: "Promotion approval requires a verified Compile Run result.",
        }),
      })));
    }
    if (!this.execution.promote) {
      const now = this.now().toISOString();
      return toReceipt(this.store.update(runId, (record) => ({
        ...record,
        status: "failed",
        updatedAt: now,
        finishedAt: now,
        diagnostics: appendDiagnostic(record.diagnostics, {
          code: "PROMOTION_EXECUTOR_UNAVAILABLE",
          message: "This Compile Run has no promotion executor.",
        }),
      })));
    }

    const context: CompileExecutionContext = {
      runId,
      stagingPath: this.store.stagingPath(runId),
      ...(current.baseSnapshot ? { baseSnapshot: current.baseSnapshot } : {}),
    };
    let promoted: CompilePromotionResult;
    try {
      promoted = await this.execution.promote(current.topic, context, current.result);
    } catch (error) {
      const now = this.now().toISOString();
      return toReceipt(this.store.update(runId, (record) => ({
        ...record,
        status: "failed",
        updatedAt: now,
        finishedAt: now,
        diagnostics: appendDiagnostic(record.diagnostics, {
          code: "PROMOTION_FAILED",
          message: error instanceof Error ? error.message : String(error),
        }),
      })));
    }
    const finishedAt = this.now().toISOString();
    const final = this.store.update(runId, (record) => ({
      ...record,
      status: promoted.promotion.status === "promoted" && promoted.result.ok ? "succeeded" : "failed",
      result: promoted.result,
      artifacts: promoted.result.artifacts ?? record.artifacts,
      verification: promoted.verification,
      promotion: promoted.promotion,
      updatedAt: finishedAt,
      finishedAt,
      diagnostics: promoted.promotion.status === "promoted"
        ? record.diagnostics
        : appendDiagnostic(record.diagnostics, {
          code: "PROMOTION_NOT_APPLIED",
          message: promoted.result.error ?? "Promotion did not reach the Vault authority.",
        }),
    }));
    try {
      this.store.writeApprovalReview(final, final.status === "succeeded" ? "approved" : "rejected");
      return toReceipt(final);
    } catch (error) {
      return toReceipt(this.store.update(runId, (record) => ({
        ...record,
        diagnostics: appendDiagnostic(record.diagnostics, {
          code: "PROMOTION_INBOX_UPDATE_FAILED",
          message: error instanceof Error ? error.message : String(error),
        }),
      })));
    }
  }

  async cancel(runId: string): Promise<CompileRunReceipt> {
    const current = this.store.get(runId);
    if (APPROVAL_STATUSES.has(current.status)) {
      const now = this.now().toISOString();
      const canceled = this.store.update(runId, (record) => ({
        ...record,
        status: "canceled",
        ...(record.promotion ? { promotion: { ...record.promotion, status: "not-promoted" as const } } : {}),
        updatedAt: now,
        finishedAt: now,
        diagnostics: appendDiagnostic(record.diagnostics, {
          code: "PROMOTION_REJECTED",
          message: "Pending promotion was canceled before Vault promotion.",
        }),
      }));
      try {
        this.store.writeApprovalReview(canceled, "rejected");
        return toReceipt(canceled);
      } catch (error) {
        return toReceipt(this.store.update(runId, (record) => ({
          ...record,
          diagnostics: appendDiagnostic(record.diagnostics, {
            code: "PROMOTION_INBOX_UPDATE_FAILED",
            message: error instanceof Error ? error.message : String(error),
          }),
        })));
      }
    }
    if (!ACTIVE_STATUSES.has(current.status)) return toReceipt(current);

    const attempt = this.execution.abort();
    if (!attempt.ok) {
      return toReceipt(this.store.update(runId, (record) => ({
        ...record,
        updatedAt: this.now().toISOString(),
        diagnostics: appendDiagnostic(record.diagnostics, {
          code: "CANCEL_REJECTED",
          message: attempt.message,
          transient: true,
        }),
      })));
    }

    const now = this.now().toISOString();
    const updated = this.store.update(runId, (record) => ({
      ...record,
      status: attempt.confirmed ? "canceled" : "cancel_requested",
      cancelRequestedAt: record.cancelRequestedAt ?? now,
      updatedAt: now,
      ...(attempt.confirmed ? { finishedAt: now } : {}),
      diagnostics: appendDiagnostic(record.diagnostics, {
        code: attempt.confirmed ? "CANCELED" : "CANCEL_NOT_CONFIRMED",
        message: attempt.message,
        transient: !attempt.confirmed,
      }),
    }));
    return toReceipt(updated);
  }

  async recover(): Promise<CompileRunRecord[]> {
    const now = this.now();
    const recovered: CompileRunRecord[] = [];
    for (const record of this.store.list()) {
      if (!ACTIVE_STATUSES.has(record.status)) continue;
      if (now.getTime() - Date.parse(record.updatedAt) < this.staleAfterMs) continue;
      recovered.push(this.store.update(record.runId, (current) => ({
        ...current,
        status: "abandoned",
        updatedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        diagnostics: appendDiagnostic(current.diagnostics, {
          code: "STALE_RUN_ABANDONED",
          message: "The compiler process was not confirmed alive after runtime recovery.",
        }),
      })));
    }
    return recovered;
  }

  private async execute(runId: string, request: CompileRunRequest): Promise<CompileRunReceipt> {
    const startedAt = this.now().toISOString();
    this.store.update(runId, (record) => ({
      ...record,
      status: "running",
      startedAt,
      updatedAt: startedAt,
    }));

    let result: CompileResult;
    let verification: CompileVerificationReport | undefined;
    let promotion: CompilePromotionReceipt | undefined;
    const context: CompileExecutionContext = {
      runId,
      stagingPath: this.store.stagingPath(runId),
    };
    try {
      result = await this.execution.run(request.topic, context);
      if (result.ok && request.promotionMode === "approval-required" && this.execution.verify) {
        const checked = await this.execution.verify(request.topic, context, result);
        result = checked.result;
        verification = checked.verification;
      } else if (result.ok && request.promotionMode === "approval-required" && !this.execution.verify) {
        result = {
          ...result,
          ok: false,
          error: "COMPILE_VERIFICATION_UNAVAILABLE: approval-required Runs need a verification executor",
        };
      }
      if (result.ok && request.promotionMode !== "approval-required" && this.execution.promote) {
        const promoted = await this.execution.promote(request.topic, context, result);
        result = promoted.result;
        verification = promoted.verification;
        promotion = promoted.promotion;
      }
    } catch (error) {
      result = {
        ok: false,
        topic: request.topic ?? "",
        sourcesCompiled: 0,
        conceptsCreated: 0,
        contradictions: 0,
        error: error instanceof Error ? error.message : String(error),
        timestamp: this.now().toISOString(),
      };
    }

    const finishedAt = this.now().toISOString();
    const final = this.store.update(runId, (record) => {
      const cancellationRequested = record.status === "cancel_requested";
      const cancellationConfirmed = record.status === "canceled";
      const awaitingApproval = request.promotionMode === "approval-required"
        && result.ok
        && verification?.passed === true;
      const status: CompileRunStatus = cancellationConfirmed
        ? "canceled"
        : cancellationRequested
        ? "abandoned"
        : awaitingApproval
        ? "awaiting_approval"
        : result.ok ? "succeeded" : isTimeout(result.error) ? "timed_out" : "failed";
      return {
        ...record,
        topic: record.topic ?? (result.topic || undefined),
        status,
        result,
        artifacts: result.artifacts ?? record.artifacts,
        ...(context.baseSnapshot ? { baseSnapshot: context.baseSnapshot } : {}),
        ...(verification ? { verification } : {}),
        ...(promotion ? { promotion } : awaitingApproval ? {
          promotion: {
            status: "awaiting-approval" as const,
            targets: result.artifacts?.map((artifact) => artifact.proposedTarget) ?? [],
          },
        } : {}),
        finishedAt,
        updatedAt: finishedAt,
        diagnostics: cancellationRequested
          ? appendDiagnostic(record.diagnostics, {
            code: "CANCEL_OUTCOME_UNKNOWN",
            message: "The legacy compiler completed after cancellation could not be confirmed.",
          })
          : record.diagnostics,
      };
    });
    if (final.status === "awaiting_approval") {
      try {
        const reviewPath = this.store.writeApprovalReview(final, "pending");
        const reviewRecord = this.store.update(runId, (record) => ({ ...record, reviewPath }));
        return toReceipt(reviewRecord);
      } catch (error) {
        const now = this.now().toISOString();
        const failed = this.store.update(runId, (record) => ({
          ...record,
          status: "failed",
          updatedAt: now,
          finishedAt: now,
          diagnostics: appendDiagnostic(record.diagnostics, {
            code: "PROMOTION_INBOX_FAILED",
            message: error instanceof Error ? error.message : String(error),
          }),
        }));
        return toReceipt(failed);
      }
    }
    return toReceipt(final);
  }
}

export function readCompileRun(raw: unknown): CompileRunRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Unsupported or corrupt Compile Run state");
  }
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== COMPILE_RUN_SCHEMA_VERSION) {
    throw new Error("Unsupported Compile Run schema version");
  }
  if (value.protocolVersion !== COMPILE_RUN_PROTOCOL_VERSION) {
    throw new Error("Unsupported Compile Run protocol version");
  }
  assertRunId(requiredString(value.runId, "runId"));
  if (!isCompileRunStatus(value.status)) throw new Error("Invalid Compile Run status");
  if (!isCompileRunTrigger(value.trigger)) throw new Error("Invalid Compile Run trigger");
  if (!Array.isArray(value.diagnostics)) throw new Error("Invalid Compile Run diagnostics");
  if (value.artifacts !== undefined && !Array.isArray(value.artifacts)) throw new Error("Invalid Compile Run artifacts");
  if (value.verification !== undefined && (!value.verification || typeof value.verification !== "object")) throw new Error("Invalid Compile Run verification");
  if (value.promotion !== undefined && (!value.promotion || typeof value.promotion !== "object")) throw new Error("Invalid Compile Run promotion");
  return {
    ...value,
    promotionMode: value.promotionMode === "approval-required" ? "approval-required" : "automatic",
    artifacts: value.artifacts ?? [],
  } as unknown as CompileRunRecord;
}

function toReceipt(record: CompileRunRecord): CompileRunReceipt {
  return {
    runId: record.runId,
    status: record.status,
    ...(record.result ? { result: record.result } : {}),
    artifacts: record.artifacts,
    ...(record.verification ? { verification: record.verification } : {}),
    ...(record.promotion ? { promotion: record.promotion } : {}),
    ...(record.reviewPath ? { reviewPath: record.reviewPath } : {}),
    diagnostics: record.diagnostics,
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
  };
}

function appendDiagnostic(
  diagnostics: CompileRunDiagnostic[],
  diagnostic: CompileRunDiagnostic,
): CompileRunDiagnostic[] {
  return [...diagnostics, diagnostic];
}

function digestRequest(request: CompileRunRequest): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(request)).digest("hex")}`;
}

function isTimeout(error: string | undefined): boolean {
  return Boolean(error && /timed? ?out|timeout|ETIMEDOUT/i.test(error));
}

function isCompileRunStatus(value: unknown): value is CompileRunStatus {
  return typeof value === "string" && [
    "queued", "running", "awaiting_approval", "succeeded", "failed", "cancel_requested", "canceled", "timed_out", "abandoned",
  ].includes(value);
}

function isCompileRunTrigger(value: unknown): value is CompileRunTrigger {
  return value === "manual" || value === "auto" || value === "maintenance";
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} required`);
  return value;
}

function assertRunId(runId: string): void {
  if (!/^compile-run\/[A-Za-z0-9-]+$/.test(runId)) throw new Error("Invalid Compile Run id");
}

function safeReviewText(value: string): string {
  return value.replace(/[\r\n]/g, " ").replace(/[`<>]/g, "").slice(0, 512);
}

function atomicText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, value, "utf8");
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function withLock<T>(path: string, work: () => T): T {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  try {
    try {
      writeFileSync(lock, String(process.pid), { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const age = existsSync(lock) ? Date.now() - statSync(lock).mtimeMs : LOCK_STALE_MS + 1;
      if (age <= LOCK_STALE_MS) throw new Error(`Compile Run store is locked: ${path}`);
      rmSync(lock, { force: true });
      writeFileSync(lock, String(process.pid), { flag: "wx" });
    }
    return work();
  } finally {
    rmSync(lock, { force: true });
  }
}
