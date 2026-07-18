export type VisualWorkspaceErrorCode =
  | "INVALID_CONTRACT"
  | "INVALID_GRAPH"
  | "INVALID_MARKDOWN"
  | "MAP_ID_MISMATCH"
  | "PLAN_TAMPERED"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_CHANGED"
  | "TRANSITION_TOKEN_REUSED";

export class VisualWorkspaceError extends Error {
  readonly code: VisualWorkspaceErrorCode;

  constructor(code: VisualWorkspaceErrorCode, message: string) {
    super(message);
    this.name = "VisualWorkspaceError";
    this.code = code;
  }
}
