import type { Operation, OperationContext } from '../core/types.js';
import { badRequest, internal, makeErr } from '../core/types.js';
import { ValidationError, validateParams } from '../core/validate.js';
import {
  adjudicateOperationWrite,
  auditOperationWrite,
  type OperationRegistry,
} from '../core/write-policy.js';

export interface OperationDispatcher {
  invoke(name: string, args?: Record<string, unknown>): Promise<unknown>;
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
