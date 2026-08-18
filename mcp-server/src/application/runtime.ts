/**
 * Application composition root shared by protocol and host adapters.
 *
 * The MCP SDK and Obsidian control-plane code should choose what they expose,
 * but they must not rebuild domain operation graphs independently. This
 * module is the seam for the application runtime: one operation catalog,
 * one Operation Context, and one governed invocation path.
 */

import type { DomainToolDescriptor } from '../mcp-runtime/types.js';
import { toDomainToolDescriptors } from '../mcp-runtime/types.js';
import {
  createOperationDispatcher,
  type OperationDispatcher,
  type OperationDispatcherOptions,
} from '../control-plane/dispatcher.js';
import {
  makeAllOperations,
  type AllOperationsDeps,
} from '../core/operations.js';
import type { Operation, OperationContext } from '../core/types.js';

export interface OperationCatalog {
  readonly operations: readonly Operation[];
  describe(): readonly DomainToolDescriptor[];
  get(name: string): Operation | undefined;
  invoke(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface ApplicationRuntimeOptions extends AllOperationsDeps {
  context: OperationContext;
  /** Host adapters may restrict exposure without rebuilding domain operations. */
  operationFilter?: (operation: Operation) => boolean;
  onWriteEffect?: OperationDispatcherOptions['onWriteEffect'];
  ready?: Promise<void>;
  onDispose?: () => void | Promise<void>;
}

export interface ApplicationRuntime {
  readonly context: OperationContext;
  readonly operations: readonly Operation[];
  readonly catalog: OperationCatalog;
  readonly ready: Promise<void>;
  invoke(name: string, args?: Record<string, unknown>): Promise<unknown>;
  dispose(): Promise<void>;
}

/**
 * Operation names are the application boundary. A duplicate must fail during
 * composition instead of being silently shadowed by the dispatch map.
 */
export function assertUniqueOperationNames(operations: readonly Operation[]): void {
  const seen = new Set<string>();
  for (const operation of operations) {
    if (seen.has(operation.name)) {
      throw new Error(`Duplicate Operation registration: ${operation.name}`);
    }
    seen.add(operation.name);
  }
}

export function createApplicationRuntime(
  options: ApplicationRuntimeOptions,
): ApplicationRuntime {
  const operations = makeAllOperations(options)
    .filter(options.operationFilter ?? (() => true));
  assertUniqueOperationNames(operations);
  const dispatcher: OperationDispatcher = createOperationDispatcher(
    operations,
    options.context,
    { onWriteEffect: options.onWriteEffect },
  );
  const operationMap = new Map(operations.map((operation) => [operation.name, operation]));
  const ready = options.ready ?? Promise.resolve();
  const catalog: OperationCatalog = {
    operations,
    describe: () => toDomainToolDescriptors(operations),
    get: (name) => operationMap.get(name),
    invoke: (name, args = {}) => dispatcher.invoke(name, args),
  };

  return {
    context: options.context,
    operations,
    catalog,
    ready,
    async invoke(name, args = {}) {
      await ready;
      return catalog.invoke(name, args);
    },
    async dispose() {
      await options.onDispose?.();
    },
  };
}
