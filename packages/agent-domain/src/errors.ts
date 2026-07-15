export class DomainValidationError extends Error {
  readonly code = "agent-domain-validation";

  constructor(message: string, readonly path?: string) {
    super(path ? `${message} at ${path}` : message);
    this.name = "DomainValidationError";
  }
}

export class DomainConflictError extends Error {
  readonly code = "agent-domain-conflict";

  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DomainConflictError";
  }
}

export class DomainNotFoundError extends Error {
  readonly code = "agent-domain-not-found";

  constructor(message: string) {
    super(message);
    this.name = "DomainNotFoundError";
  }
}

export class DomainLockTimeoutError extends Error {
  readonly code = "agent-domain-lock-timeout";

  constructor(lockPath: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for an Agent Domain lock`);
    void lockPath;
    this.name = "DomainLockTimeoutError";
  }
}

export class ContextBudgetError extends Error {
  readonly code = "context-mandatory-budget-exceeded";

  constructor(readonly mandatoryTokens: number, readonly tokenBudget: number) {
    super(`Mandatory context requires ${mandatoryTokens} tokens but the budget is ${tokenBudget}`);
    this.name = "ContextBudgetError";
  }
}

export class SimulatedInterruptionError extends Error {
  readonly code = "dreamtime-simulated-interruption";

  constructor(readonly point: string) {
    super(`Dream Time approval interrupted at ${point}`);
    this.name = "SimulatedInterruptionError";
  }
}
