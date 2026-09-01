import { deepFreeze, sha256Text } from "./canonical.js";
import { VisualWorkspaceError } from "./errors.js";
import { assertDataViewEditPlan } from "./data-view-plans.js";
import { ReplaySafeTransitionLedger } from "./replay-safe.js";
import type {
  ApplyDataViewEditPlanResult,
  DataViewApplyRequest,
  DataViewEditPlan,
} from "./data-view-types.js";

export class InMemoryDataViewWorkspace {
  readonly #sources = new Map<string, string>();
  readonly #transitions = new ReplaySafeTransitionLedger<ApplyDataViewEditPlanResult>();

  constructor(initialSources: Readonly<Record<string, string>> = {}) {
    for (const [path, source] of Object.entries(initialSources)) {
      this.#sources.set(path, source);
    }
  }

  read(path: string): string | undefined {
    return this.#sources.get(path);
  }

  apply(value: unknown): Readonly<ApplyDataViewEditPlanResult> {
    assertDataViewApplyRequest(value);
    const request: DataViewApplyRequest = value;
    const plan = request.plan;
    if (request.actor !== plan.provenance.actor) throw new VisualWorkspaceError("INVALID_CONTRACT", "The confirming actor must match the plan actor");
    const replayed = this.#transitions.replay(request.transitionToken, plan.fingerprint, request.actor);
    if (replayed) return deepFreeze({ ...replayed, replayed: true });

    const currentSource = this.#sources.get(plan.source.path);
    if (currentSource === undefined) throw new VisualWorkspaceError("SOURCE_NOT_FOUND", "The data-view plan source is not registered");
    if (sha256Text(currentSource) !== plan.source.sha256 || currentSource !== plan.preview.before.sourceMarkdown) {
      throw new VisualWorkspaceError("SOURCE_CHANGED", "The data-view plan source changed after preview");
    }
    this.#sources.set(plan.source.path, plan.preview.after.sourceMarkdown);
    const result: ApplyDataViewEditPlanResult = {
      path: plan.source.path,
      source: plan.preview.after.sourceMarkdown,
      sourceSha256: plan.preview.after.sourceSha256,
      planFingerprint: plan.fingerprint,
      actor: request.actor,
      transitionToken: request.transitionToken,
      replayed: false,
    };
    this.#transitions.record(request.transitionToken, plan.fingerprint, request.actor, deepFreeze({ ...result }));
    return deepFreeze(result);
  }
}

export function assertDataViewApplyRequest(value: unknown): asserts value is DataViewApplyRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VisualWorkspaceError("INVALID_CONTRACT", "DataViewApplyRequest must be an object");
  const request = value as Record<string, unknown>;
  const allowed = ["plan", "presentedFingerprint", "actor", "transitionToken"];
  const unknown = Object.keys(request).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new VisualWorkspaceError("INVALID_CONTRACT", `DataViewApplyRequest has unknown fields: ${unknown.join(", ")}`);
  for (const key of allowed) if (!(key in request)) throw new VisualWorkspaceError("INVALID_CONTRACT", `DataViewApplyRequest is missing ${key}`);
  assertDataViewEditPlan(request.plan);
  if (request.presentedFingerprint !== request.plan.fingerprint) throw new VisualWorkspaceError("PLAN_TAMPERED", "The presented data-view plan fingerprint does not match");
  assertSingleLine(request.actor, "DataViewApplyRequest.actor");
  assertSingleLine(request.transitionToken, "DataViewApplyRequest.transitionToken");
}

function assertSingleLine(value: unknown, context: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || /[\r\n]/u.test(value)) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", `${context} must be a non-empty single-line string of at most 512 characters`);
  }
}
