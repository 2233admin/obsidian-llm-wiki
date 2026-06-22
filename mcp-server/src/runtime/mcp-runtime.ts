import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Logger, Operation, OperationContext, ParamDef } from '../core/types.js';
import { isOperationError } from '../core/types.js';

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

export function createMcpServer(options: McpRuntimeOptions): McpServer {
  const server = new McpServer({ name: options.name, version: options.version });

  for (const operation of options.operations) {
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

  return server;
}

export async function startStdioServer(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
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
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'object':
      return z.object({}).passthrough();
    case 'array':
      return z.array(z.unknown());
    default:
      return z.unknown();
  }
}

function formatOperationResult(result: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result ?? null, null, 2),
      },
    ],
  };
}

function formatOperationError(error: unknown) {
  const payload = isOperationError(error)
    ? {
        code: (error as { code: number }).code,
        message: (error as { message: string }).message,
        data: (error as { data?: unknown }).data,
      }
    : {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal operation error',
      };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError: true,
  };
}

function formatInternalError(operationName: string, error: unknown): string {
  if (isOperationError(error)) {
    return `operation ${operationName} failed: ${(error as { message: string }).message}`;
  }
  if (error instanceof Error) {
    return `operation ${operationName} failed: ${error.message}`;
  }
  return `operation ${operationName} failed: ${String(error)}`;
}
