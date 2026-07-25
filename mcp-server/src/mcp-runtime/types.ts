/**
 * SDK-neutral MCP runtime contracts.
 *
 * Domain handlers produce Operation[] / OperationResult values. Transport
 * composition (SDK v1 today, optional v2 seam fixtures later) lives only in
 * mcp-runtime/* and must not leak into domain modules.
 */

import type { Logger, Operation, OperationContext, ParamDef } from "../core/types.js";

export interface McpRuntimeOptions {
  name: string;
  version: string;
  operations: Operation[];
  ctx: OperationContext;
  logger: Logger;
  prepareParams?: (
    operation: Operation,
    params: Record<string, unknown>,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  afterOperation?: (
    operation: Operation,
    params: Record<string, unknown>,
    result: unknown,
  ) => void | Promise<void>;
}

/** Transport-agnostic tool descriptor derived from a domain Operation. */
export interface DomainToolDescriptor {
  name: string;
  description: string;
  namespace: string;
  mutating: boolean;
  params: Record<string, ParamDef>;
}

export function toDomainToolDescriptors(operations: readonly Operation[]): DomainToolDescriptor[] {
  return operations.map((operation) => ({
    name: operation.name,
    description: operation.description,
    namespace: operation.namespace,
    mutating: Boolean(operation.mutating),
    params: operation.params,
  }));
}

/** JSON-serializable MCP content payload used by both v1 production and v2 seam. */
export interface McpContentResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string; [key: string]: unknown }>;
  isError?: boolean;
}

export type McpSdkLine = "v1-production" | "v2-seam-non-production";
