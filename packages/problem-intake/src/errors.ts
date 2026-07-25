export type ProblemIntakeErrorCode =
  | "INVALID_CONTRACT"
  | "INVALID_PROJECT_ID"
  | "INVALID_FINGERPRINT"
  | "SENSITIVE_DATA"
  | "BOUNDS_EXCEEDED"
  | "OBSERVATION_NOT_FOUND"
  | "REVISION_CONFLICT"
  | "INVALID_TRANSITION"
  | "TRANSITION_TOKEN_REUSED"
  | "PLAN_TAMPERED"
  | "CONSENT_REQUIRED"
  | "UNVERIFIED_PATCH"
  | "OUTCOME_UNKNOWN";

export class ProblemIntakeError extends Error {
  readonly code: ProblemIntakeErrorCode;
  readonly data?: Readonly<Record<string, unknown>>;

  constructor(
    code: ProblemIntakeErrorCode,
    message: string,
    data?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "ProblemIntakeError";
    this.code = code;
    this.data = data;
  }
}
