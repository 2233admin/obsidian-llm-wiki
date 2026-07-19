export type ContributionErrorCode =
  | 'INVALID_INPUT'
  | 'AMBIGUOUS_REPOSITORY'
  | 'PROVIDER_UNAVAILABLE'
  | 'PREFLIGHT_FAILED'
  | 'SECRET_OR_PATH_UNSAFE'
  | 'CONFIRMATION_REQUIRED'
  | 'STALE_PLAN'
  | 'REPLAY_CONFLICT'
  | 'OUTCOME_UNKNOWN'
  | 'PR_UNAVAILABLE'
  | 'REMOTE_REJECTED';

export class ContributionError extends Error {
  readonly code: ContributionErrorCode;
  readonly data?: Record<string, unknown>;

  constructor(
    code: ContributionErrorCode,
    message: string,
    data?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ContributionError';
    this.code = code;
    this.data = data;
  }
}
export class ContributionTransportError extends Error {
  readonly outcome: 'not_sent' | 'unknown';

  constructor(message: string, outcome: 'not_sent' | 'unknown', options?: ErrorOptions) {
    super(message, options);
    this.name = 'ContributionTransportError';
    this.outcome = outcome;
  }
}
