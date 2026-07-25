/**
 * Non-production MCP SDK v2 compatibility seam.
 *
 * v2 is intentionally not wired into production. These helpers and fixtures
 * document the future package split (server vs client) while keeping domain
 * Operation handlers SDK-neutral. Evaluating a v2 fixture must never replace
 * the production v1 runtime dependency.
 */

import { formatOperationError, formatOperationResult } from "./format.js";
import type { DomainToolDescriptor, McpContentResponse } from "./types.js";
import { toDomainToolDescriptors } from "./types.js";
import type { Operation, OperationContext } from "../core/types.js";

export const MCP_SDK_V2_SEAM_LINE = "v2-seam-non-production" as const;

/** Hypothetical future package names — fixtures only, not installed. */
export const MCP_SDK_V2_PACKAGE_SPLIT = Object.freeze({
  server: "@modelcontextprotocol/server",
  client: "@modelcontextprotocol/client",
  shared: "@modelcontextprotocol/sdk-shared",
});

export interface McpV2SeamServerConfig {
  name: string;
  version: string;
  /** Explicit marker so hosts cannot confuse this with production. */
  line: typeof MCP_SDK_V2_SEAM_LINE;
  tools: DomainToolDescriptor[];
}

export interface McpV2SeamInvokeRequest {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface McpV2SeamInvokeResult {
  line: typeof MCP_SDK_V2_SEAM_LINE;
  toolName: string;
  response: McpContentResponse;
}

/**
 * Build a non-production v2 seam server description from domain operations.
 * Does not load or require any v2 SDK package.
 */
export function createMcpV2SeamServerDescriptor(
  name: string,
  version: string,
  operations: readonly Operation[],
): McpV2SeamServerConfig {
  return {
    name,
    version,
    line: MCP_SDK_V2_SEAM_LINE,
    tools: toDomainToolDescriptors(operations),
  };
}

/**
 * Dispatch a tool call through domain handlers without v1 or v2 SDK transports.
 * Used by fixtures to prove domain isolation from transport composition.
 */
export async function invokeDomainToolThroughV2Seam(
  operations: readonly Operation[],
  ctx: OperationContext,
  request: McpV2SeamInvokeRequest,
): Promise<McpV2SeamInvokeResult> {
  const operation = operations.find((item) => item.name === request.toolName);
  if (!operation) {
    return {
      line: MCP_SDK_V2_SEAM_LINE,
      toolName: request.toolName,
      response: formatOperationError({
        code: -32601,
        message: `Unknown tool: ${request.toolName}`,
      }),
    };
  }
  try {
    const result = await operation.handler(ctx, request.arguments);
    return {
      line: MCP_SDK_V2_SEAM_LINE,
      toolName: request.toolName,
      response: formatOperationResult(result),
    };
  } catch (error) {
    return {
      line: MCP_SDK_V2_SEAM_LINE,
      toolName: request.toolName,
      response: formatOperationError(error),
    };
  }
}

export function assertV2SeamIsNonProduction(config: McpV2SeamServerConfig): void {
  if (config.line !== MCP_SDK_V2_SEAM_LINE) {
    throw new Error("v2 seam config must be marked non-production");
  }
  if (config.line === ("v1-production" as string)) {
    throw new Error("v2 seam must not claim production v1 line");
  }
}

/** Fixture helper: describe how a future v2 adoption would split packages. */
export function describeV2PackageSplit(): {
  productionRemains: string;
  seamPackages: typeof MCP_SDK_V2_PACKAGE_SPLIT;
  adoptionGate: string;
} {
  return {
    productionRemains: "@modelcontextprotocol/sdk (v1)",
    seamPackages: MCP_SDK_V2_PACKAGE_SPLIT,
    adoptionGate:
      "Require a separate approved change after upstream v2 is stable; do not flip production dependency here.",
  };
}
