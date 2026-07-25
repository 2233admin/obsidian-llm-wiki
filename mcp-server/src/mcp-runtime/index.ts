/**
 * MCP runtime entry — production always uses SDK v1 composition.
 * Domain modules import Operation types from core/, never from SDK packages.
 */

export type { McpRuntimeOptions, DomainToolDescriptor, McpContentResponse, McpSdkLine } from "./types.js";
export { toDomainToolDescriptors } from "./types.js";
export { formatOperationResult, formatOperationError, formatInternalError } from "./format.js";
export {
  createMcpServerV1,
  startStdioServerV1,
  paramsToZodShape,
  MCP_SDK_PRODUCTION_LINE,
  MCP_SDK_PRODUCTION_PACKAGE,
} from "./v1-composition.js";
export {
  MCP_SDK_V2_SEAM_LINE,
  MCP_SDK_V2_PACKAGE_SPLIT,
  createMcpV2SeamServerDescriptor,
  invokeDomainToolThroughV2Seam,
  assertV2SeamIsNonProduction,
  describeV2PackageSplit,
} from "./v2-seam.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServerV1, startStdioServerV1 } from "./v1-composition.js";
import type { McpRuntimeOptions } from "./types.js";

/** Production factory — always v1. */
export function createMcpServer(options: McpRuntimeOptions): McpServer {
  return createMcpServerV1(options);
}

/** Production stdio start — always v1. */
export async function startStdioServer(server: McpServer): Promise<void> {
  await startStdioServerV1(server);
}
