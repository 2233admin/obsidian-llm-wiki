import { deepFreeze, sha256Text } from "./canonical.js";
import { VisualWorkspaceError } from "./errors.js";
import { parseManagedMindMapSection } from "./markdown.js";
import { assertVisualApplyRequest } from "./plans.js";
import type { ApplyVisualEditPlanResult, VisualApplyRequest } from "./types.js";
import { mindMapFingerprint } from "./validation.js";

interface RecordedTransition {
  planFingerprint: string;
  actor: string;
  result: ApplyVisualEditPlanResult;
}

export class InMemoryVisualWorkspace {
  readonly #sources = new Map<string, string>();
  readonly #transitions = new Map<string, RecordedTransition>();

  constructor(initialSources: Readonly<Record<string, string>> = {}) {
    for (const [path, source] of Object.entries(initialSources)) {
      this.#sources.set(path, source);
    }
  }

  read(path: string): string | undefined {
    return this.#sources.get(path);
  }

  apply(value: unknown): Readonly<ApplyVisualEditPlanResult> {
    assertVisualApplyRequest(value);
    const request: VisualApplyRequest = value;
    const { plan } = request;
    const recorded = this.#transitions.get(request.transitionToken);
    if (recorded) {
      if (recorded.planFingerprint !== plan.fingerprint || recorded.actor !== request.actor) {
        throw new VisualWorkspaceError(
          "TRANSITION_TOKEN_REUSED",
          "The transition token was already used by another visual apply request",
        );
      }
      return deepFreeze({ ...recorded.result, replayed: true });
    }

    const currentSource = this.#sources.get(plan.source.path);
    if (currentSource === undefined) {
      throw new VisualWorkspaceError("SOURCE_NOT_FOUND", "The edit plan source is not registered");
    }
    if (sha256Text(currentSource) !== plan.source.sha256) {
      throw new VisualWorkspaceError("SOURCE_CHANGED", "The source changed after the edit plan was created");
    }
    const currentSection = parseManagedMindMapSection(currentSource);
    if (
      currentSection.raw !== plan.preview.before.managedMarkdown
      || mindMapFingerprint(currentSection.document) !== plan.preview.before.documentFingerprint
    ) {
      throw new VisualWorkspaceError("SOURCE_CHANGED", "The managed mind-map section changed after preview");
    }

    const source = currentSource.slice(0, currentSection.start)
      + plan.preview.after.managedMarkdown
      + currentSource.slice(currentSection.end);
    this.#sources.set(plan.source.path, source);
    const result: ApplyVisualEditPlanResult = {
      path: plan.source.path,
      source,
      sourceSha256: sha256Text(source),
      planFingerprint: plan.fingerprint,
      actor: request.actor,
      transitionToken: request.transitionToken,
      replayed: false,
    };
    this.#transitions.set(request.transitionToken, {
      planFingerprint: plan.fingerprint,
      actor: request.actor,
      result: deepFreeze({ ...result }) as ApplyVisualEditPlanResult,
    });
    return deepFreeze(result);
  }
}
