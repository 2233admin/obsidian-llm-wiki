export type AskMateIntent = "understand" | "make_map" | "report_problem";

export type AskMateContextKind =
  | "managed_map"
  | "markdown_note"
  | "selection"
  | "canvas"
  | "project";

export interface AskMateSelection {
  /** Ephemeral text sent to the selected domain Operation. Never restored in view state. */
  text: string;
  from?: number;
  to?: number;
}

export interface AskMateContext {
  projectId: `project/${string}`;
  kind?: AskMateContextKind;
  path?: string;
  selection?: AskMateSelection;
  canvasNodeIds?: string[];
}

export interface AskMateClarificationOption {
  id: string;
  label: string;
  evidenceRefs: string[];
}

export interface AskMateClarification {
  id: string;
  prompt: string;
  kind: "root" | "parent" | "label" | "scope" | "output";
  required: boolean;
  options: AskMateClarificationOption[];
}

export interface AskMateCapabilityState {
  model: "available" | "degraded" | "unavailable";
  graphify: "available" | "degraded" | "unavailable";
  problemIntake: "available" | "degraded" | "unavailable";
  messages: string[];
}

export const DEFAULT_ASK_MATE_CAPABILITIES: AskMateCapabilityState = {
  model: "degraded",
  graphify: "unavailable",
  problemIntake: "unavailable",
  messages: [
    "Deterministic parsing and manual outline editing remain available without a model.",
  ],
};

export function normalizedContextKind(context: AskMateContext): AskMateContextKind {
  return context.kind ?? "managed_map";
}

export function describeAskMateContext(context: AskMateContext): string {
  const kind = normalizedContextKind(context);
  const source = context.path ?? context.projectId;
  switch (kind) {
    case "managed_map": return `managed Mind Map Document ${source}`;
    case "markdown_note": return `Markdown note ${source}`;
    case "selection": return `selected text from ${source}`;
    case "canvas": return `Obsidian core Canvas ${source}`;
    case "project": return `Project Context ${context.projectId}`;
  }
}

/**
 * View restoration deliberately excludes selected text and Canvas node IDs.
 * They are editor-session context, not plugin-owned durable state.
 */
export function restorableAskMateContext(
  context: AskMateContext | null,
): Record<string, unknown> {
  if (!context) return {};
  return {
    projectId: context.projectId,
    kind: normalizedContextKind(context),
    ...(context.path ? { path: context.path } : {}),
  };
}

export function parseRestoredAskMateContext(state: unknown): AskMateContext | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const candidate = state as Record<string, unknown>;
  if (
    typeof candidate.projectId !== "string"
    || !/^project\/[a-z0-9][a-z0-9-]*$/.test(candidate.projectId)
  ) return null;
  const kind = candidate.kind ?? "managed_map";
  if (
    kind !== "managed_map"
    && kind !== "markdown_note"
    && kind !== "selection"
    && kind !== "canvas"
    && kind !== "project"
  ) return null;
  if (kind !== "project" && typeof candidate.path !== "string") return null;
  if (candidate.path !== undefined && typeof candidate.path !== "string") return null;
  return {
    projectId: candidate.projectId as `project/${string}`,
    kind,
    ...(typeof candidate.path === "string" ? { path: candidate.path } : {}),
  };
}

export class AskMateInteractionModel {
  #intent: AskMateIntent = "understand";
  #clarifications: AskMateClarification[] = [];
  #answers = new Map<string, string>();
  #capabilities: AskMateCapabilityState = structuredClone(DEFAULT_ASK_MATE_CAPABILITIES);

  get intent(): AskMateIntent {
    return this.#intent;
  }

  get clarifications(): readonly AskMateClarification[] {
    return structuredClone(this.#clarifications);
  }

  get answers(): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries([...this.#answers].sort(([left], [right]) =>
      left.localeCompare(right))));
  }

  get unresolvedRequiredClarifications(): readonly AskMateClarification[] {
    return this.clarifications.filter(clarification =>
      clarification.required && !this.#answers.has(clarification.id));
  }

  get canPlan(): boolean {
    return this.unresolvedRequiredClarifications.length === 0;
  }

  get capabilities(): AskMateCapabilityState {
    return structuredClone(this.#capabilities);
  }

  selectIntent(intent: AskMateIntent): void {
    this.#intent = intent;
  }

  setClarifications(clarifications: readonly AskMateClarification[]): void {
    const ids = new Set<string>();
    for (const clarification of clarifications) {
      if (!clarification.id.trim() || ids.has(clarification.id)) {
        throw new Error("Clarifications require unique non-empty IDs");
      }
      if (!clarification.prompt.trim() || clarification.options.length < 2) {
        throw new Error(`Clarification ${clarification.id} requires a prompt and at least two options`);
      }
      const optionIds = new Set<string>();
      for (const option of clarification.options) {
        if (!option.id.trim() || !option.label.trim() || optionIds.has(option.id)) {
          throw new Error(`Clarification ${clarification.id} has invalid options`);
        }
        optionIds.add(option.id);
      }
      ids.add(clarification.id);
    }
    this.#clarifications = structuredClone([...clarifications]);
    for (const answeredId of [...this.#answers.keys()]) {
      if (!ids.has(answeredId)) this.#answers.delete(answeredId);
    }
  }

  answerClarification(clarificationId: string, optionId: string): void {
    const clarification = this.#clarifications.find(candidate => candidate.id === clarificationId);
    if (!clarification) throw new Error(`Unknown clarification: ${clarificationId}`);
    if (!clarification.options.some(option => option.id === optionId)) {
      throw new Error(`Unknown option for clarification ${clarificationId}: ${optionId}`);
    }
    this.#answers.set(clarificationId, optionId);
  }

  setCapabilities(capabilities: AskMateCapabilityState): void {
    this.#capabilities = structuredClone(capabilities);
  }

  reset(): void {
    this.#intent = "understand";
    this.#clarifications = [];
    this.#answers.clear();
    this.#capabilities = structuredClone(DEFAULT_ASK_MATE_CAPABILITIES);
  }
}
