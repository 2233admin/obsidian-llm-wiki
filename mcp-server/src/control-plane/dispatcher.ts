import type { Operation, OperationContext, WriteEffect } from '../core/types.js';
import { badRequest, internal, makeErr } from '../core/types.js';
import { ValidationError, validateParams } from '../core/validate.js';
import {
  adjudicateOperationWrite,
  auditOperationWrite,
  writeEffectsForVerdict,
  type OperationRegistry,
} from '../core/write-policy.js';

export interface OperationDispatcher {
  invoke(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface OperationDispatcherOptions {
  /**
   * Receives write effects after the handler and audit record have completed.
   * Hosts use this for derived-index or compile-trigger notifications; the
   * Operation handler itself remains transport-neutral.
   */
  onWriteEffect?: (effect: WriteEffect) => void | Promise<void>;
}

/**
 * Creates a transport-neutral entry point for invoking shared Operations.
 *
 * Hosts using this dispatcher cannot call a mutating handler before its
 * Operation Write Policy has been adjudicated.
 */
export function createOperationDispatcher(
  operations: readonly Operation[],
  context: OperationContext,
  options: OperationDispatcherOptions = {},
): OperationDispatcher {
  const registry: OperationRegistry = new Map(
    operations.map((operation) => [operation.name, operation]),
  );

  return {
    async invoke(name, args = {}) {
      const operation = registry.get(name);
      if (!operation) {
        throw makeErr(-32601, `Unknown operation: ${name}`);
      }

      assertMutatingOperationIsGoverned(operation);

      const params = asOperationError(() => validateParams(operation.params, args));
      const verdict = asOperationError(() =>
        adjudicateOperationWrite(context, operation, params, registry),
      );
      const result = await operation.handler(context, params);
      auditOperationWrite(context, verdict, result);
      for (const effect of writeEffectsForVerdict(context, verdict, result)) {
        await options.onWriteEffect?.(effect);
      }
      return result;
    },
  };
}

function assertMutatingOperationIsGoverned(operation: Operation): void {
  const writePolicy = (operation as Operation & { writePolicy?: unknown }).writePolicy;
  if (operation.mutating && !writePolicy) {
    throw internal(`Mutating operation ${operation.name} is missing an Operation Write Policy`);
  }
}

function asOperationError<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof ValidationError) {
      throw badRequest(error.message);
    }
    throw error;
  }
}
