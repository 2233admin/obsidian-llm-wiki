// obsidian-llm-wiki shared operation types

export interface VaultMindConfig {
  vault_path: string;
  auth_token?: string;
  adapters?: string[];
  collaboration?: CollaborationConfig;
  /** Per-adapter score weight multipliers */
  adapter_weights?: Record<string, number>;
  config_path?: string;
}

export interface CollaborationConfig {
  actor?: string;
  role?: 'agent' | 'human' | string;
  allowed_write_paths?: string[];
  protected_paths?: string[];
  enforce?: boolean;
}

export type ParamType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'unknown';

export interface ParamDef {
  type: ParamType;
  required?: boolean;
  description?: string;
  default?: unknown;
  enum?: string[];
}

export type OperationNamespace =
  | 'vault'
  | 'compile'
  | 'query'
  | 'agent'
  | 'recipe'
  | 'multimodal'
  | 'lightrag'
  | 'holon'
  | 'causal'
  | 'provenance'
  | 'graph'
  | 'memory'
  | 'project'
  | 'ingest'
  | 'source'
  | 'conversation'
  | 'context'
  | 'skills'
  | 'workflow'
  | 'settings'
  | 'usage'
  | 'host'
  | 'dreamtime'
  | 'consult'
  | 'delegation';

export type OperationWriteTrigger = 'dryRunFalse' | 'always';

export type WriteEffect =
  | { type: 'touchMarkdown'; path: unknown; event: 'create' | 'modify' | 'delete' }
  | { type: 'touchMarkdown'; paths: unknown[]; event: 'create' | 'modify' | 'delete' };

export interface OperationWritePolicy {
  realWrite: OperationWriteTrigger;
  targets: (ctx: OperationContext, params: Record<string, unknown>) => string[];
  audit: 'required' | 'none';
  shouldWrite?: (ctx: OperationContext, params: Record<string, unknown>) => boolean;
  effects?: (ctx: OperationContext, params: Record<string, unknown>, result: unknown) => WriteEffect[];
}

interface OperationBase {
  name: string;
  namespace: OperationNamespace;
  description: string;
  params: Record<string, ParamDef>;
  handler: (ctx: OperationContext, params: Record<string, unknown>) => Promise<unknown>;
}

export interface MutatingOperation extends OperationBase {
  mutating: true;
  writePolicy: OperationWritePolicy;
}

export interface ReadonlyOperation extends OperationBase {
  mutating?: false;
  writePolicy?: never;
}

export type Operation = MutatingOperation | ReadonlyOperation;

export interface OperationContext {
  vault: VaultExecutor;
  adapters: unknown | null; // AdapterRegistry -- not imported here to avoid circular deps.
  config: VaultMindConfig;
  logger: Logger;
  dryRun: boolean;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface SearchMatch {
  line: number;
  text: string;
}

export interface SearchResult {
  path: string;
  matches: SearchMatch[];
}

export interface FileStat {
  type: 'file' | 'folder';
  path: string;
  name: string;
  ext?: string;
  size?: number;
  ctime?: number;
  mtime?: number;
  children?: number;
}

export interface GraphNode {
  path: string;
  exists: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  count: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  orphans: string[];
  unresolvedLinks: Record<string, string[]>;
}

/** Narrow interface OperationContext.vault -- only execute() is required by operation handlers. */
export interface VaultExecutor {
  execute(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export class OperationError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, options?: { data?: unknown; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'OperationError';
    this.code = code;
    this.data = options?.data;
  }
}

export function isOperationError(value: unknown): value is OperationError {
  return value instanceof OperationError
    || (typeof value === 'object'
      && value !== null
      && typeof (value as { code?: unknown }).code === 'number'
      && typeof (value as { message?: unknown }).message === 'string');
}

export function makeErr(code: number, message: string, data?: unknown): OperationError {
  return new OperationError(code, message, { data });
}

export function badRequest(message: string, data?: unknown): OperationError {
  return makeErr(-32602, message, data);
}

export function notFound(message: string, data?: unknown): OperationError {
  return makeErr(-32004, message, data);
}

export function conflict(message: string, data?: unknown): OperationError {
  return makeErr(-32010, message, data);
}

export function unsupported(message: string, data?: unknown): OperationError {
  return makeErr(-32040, message, data);
}

export function internal(message: string, data?: unknown): OperationError {
  return makeErr(-32603, message, data);
}
