/**
 * Production MCP SDK v1 transport composition.
 *
 * This is the only production module that imports @modelcontextprotocol/sdk.
 * Domain handlers remain SDK-neutral Operation implementations.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { Operation, ParamDef } from "../core/types.js";
import { formatInternalError, formatOperationError, formatOperationResult } from "./format.js";
import type { McpRuntimeOptions } from "./types.js";

export const MCP_SDK_PRODUCTION_LINE = "v1-production" as const;
export const MCP_SDK_PRODUCTION_PACKAGE = "@modelcontextprotocol/sdk" as const;

export function createMcpServerV1(options: McpRuntimeOptions): McpServer {
  const server = new McpServer({ name: options.name, version: options.version });

  for (const operation of options.operations) {
    registerDomainOperationV1(server, operation, options);
  }

  return server;
}

export async function startStdioServerV1(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}

function registerDomainOperationV1(
  server: McpServer,
  operation: Operation,
  options: McpRuntimeOptions,
): void {
  server.registerTool(
    operation.name,
    {
      description: operation.description,
      inputSchema: paramsToZodShape(operation.params),
      annotations: {
        readOnlyHint: !operation.mutating,
        destructiveHint: false,
      },
      _meta: {
        namespace: operation.namespace,
        mutating: Boolean(operation.mutating),
        mcpSdkLine: MCP_SDK_PRODUCTION_LINE,
      },
    },
    async (params) => {
      try {
        const rawParams = params as Record<string, unknown>;
        const preparedParams = options.prepareParams
          ? await options.prepareParams(operation, rawParams)
          : rawParams;
        const result = await operation.handler(options.ctx, preparedParams);
        if (options.afterOperation) {
          await options.afterOperation(operation, preparedParams, result);
        }
        return formatOperationResult(result);
      } catch (error) {
        options.logger.error(formatInternalError(operation.name, error));
        return formatOperationError(error);
      }
    },
  );
}

export function paramsToZodShape(params: Record<string, ParamDef>): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, def] of Object.entries(params)) {
    let schema = paramToZod(def);
    if (def.default !== undefined) {
      schema = schema.default(def.default);
    } else if (!def.required) {
      schema = schema.optional();
    }
    shape[name] = schema;
  }
  return shape;
}

function paramToZod(def: ParamDef): z.ZodTypeAny {
  if (def.enum && def.enum.length > 0) {
    const [first, ...rest] = def.enum;
    return z.enum([first, ...rest] as [string, ...string[]]);
  }

  switch (def.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "object":
      return z.object({}).passthrough();
    case "array":
      return z.array(z.unknown());
    default:
      return z.unknown();
  }
}
