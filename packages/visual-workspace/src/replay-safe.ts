import { VisualWorkspaceError } from "./errors.js";

export class ReplaySafeTransitionLedger<TResult> {
  readonly #records = new Map<string, { planFingerprint: string; actor: string; result: TResult }>();

  replay(token: string, planFingerprint: string, actor: string): TResult | undefined {
    const recorded = this.#records.get(token);
    if (!recorded) return undefined;
    if (recorded.planFingerprint !== planFingerprint || recorded.actor !== actor) {
      throw new VisualWorkspaceError(
        "TRANSITION_TOKEN_REUSED",
        "The transition token was already used by another apply request",
      );
    }
    return recorded.result;
  }

  record(token: string, planFingerprint: string, actor: string, result: TResult): void {
    this.#records.set(token, { planFingerprint, actor, result });
  }
}
