/**
 * VaultMindAdapter -- the plugin interface.
 *
 * Each adapter provides access to one knowledge source.
 * Implement only the capabilities you support.
 * Missing capabilities are silently skipped by the unified query layer.
 */

export type AdapterCapability =
  | "search"
  | "read"
  | "write"
  | "graph"
  | "events"
  | "embeddings";

export interface SearchResult {
  /** Source adapter name */
  source: string;
  /** Path or identifier within the adapter */
  path: string;
  /** Matched content snippet */
  content: string;
  /** Relevance score 0-1 (adapter-specific) */
  score: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface SearchOpts {
  /** Glob pattern to filter paths */
  glob?: string;
  /** Max results per adapter */
  maxResults?: number;
  /** Lines of context around match */
  context?: number;
  /** Case sensitive search */
  caseSensitive?: boolean;
}

export interface GraphNode {
  path: string;
  title?: string;
}

export type GraphEdgeConfidence =
  | "extracted"
  | "inferred"
  | "ambiguous"
  | "unknown";

/**
 * Adapter-supplied evidence for a normalized graph edge.
 *
 * The normalized `type` keeps graph consumers portable while evidence retains
 * the source adapter's richer relation vocabulary and confidence signal.
 */
export interface GraphEdgeEvidence {
  adapter: string;
  relation: string;
  confidence: GraphEdgeConfidence;
  sourcePath?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "link" | "backlink" | "tag";
  /** Optional because first-party adapters may not expose richer provenance. */
  evidence?: GraphEdgeEvidence[];
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface FileEvent {
  type: "create" | "modify" | "delete" | "rename";
  path: string;
  oldPath?: string;
  timestamp: number;
}

export interface Disposable {
  dispose(): void;
}

export interface VaultMindAdapter {
  /** Unique adapter name (e.g. "filesystem", "obsidian", "memu") */
  readonly name: string;

  /** Declared capabilities -- unified query checks these before calling methods */
  readonly capabilities: readonly AdapterCapability[];

  /** True if the adapter successfully connected and is ready to serve requests */
  readonly isAvailable?: boolean;

  // --- Core (implement what you can) ---

  search?(query: string, opts?: SearchOpts): Promise<SearchResult[]>;
  /**
   * Semantic search by pre-computed embedding vector. Adapters that store
   * vectors (e.g. pgvector, Qdrant) implement this; callers are responsible
   * for producing the embedding with a model that matches the adapter's
   * stored vector space. Returns results sorted by similarity (closest first).
   * Adapters that don't support vector search leave this undefined.
   */
  searchByVector?(
    vector: readonly number[],
    opts?: SearchOpts,
  ): Promise<SearchResult[]>;
  read?(path: string): Promise<string>;
  write?(path: string, content: string, dryRun?: boolean): Promise<void>;

  // --- Graph ---

  graph?(): Promise<GraphData>;

  // --- Events ---

  onFileChange?(callback: (event: FileEvent) => void): Disposable;

  // --- Lifecycle ---

  init(): Promise<void>;
  dispose(): Promise<void>;
}
