/**
 * Protocol response formatting shared by transport seams.
 * Domain modules never import this; only mcp-runtime composition does.
 */

import { isOperationError } from "../core/types.js";
import type { McpContentResponse } from "./types.js";

export function formatOperationResult(result: unknown): McpContentResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result ?? null, null, 2),
      },
    ],
  };
}

export function formatOperationError(error: unknown): McpContentResponse {
  const payload = isOperationError(error)
    ? {
        code: (error as { code: number }).code,
        message: (error as { message: string }).message,
        data: (error as { data?: unknown }).data,
      }
    : {
        code: -32603,
        message: error instanceof Error ? error.message : "Internal operation error",
      };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError: true,
  };
}

export function formatInternalError(operationName: string, error: unknown): string {
  if (isOperationError(error)) {
    return `operation ${operationName} failed: ${(error as { message: string }).message}`;
  }
  if (error instanceof Error) {
    return `operation ${operationName} failed: ${error.message}`;
  }
  return `operation ${operationName} failed: ${String(error)}`;
}
