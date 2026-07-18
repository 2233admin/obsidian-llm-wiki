import type {
  GraphData,
  GraphEdge,
  GraphEdgeEvidence,
  GraphNode,
  VaultMindAdapter,
} from "./interface.js";
import type { AdapterRegistry } from "./registry.js";
import { badRequest, type Operation } from "../core/types.js";

export interface AdapterGraphQueryOptions {
  /**
   * Optional adapter-name allowlist. An empty allowlist intentionally selects
   * no adapters.
   */
  adapters?: readonly string[];
}

export type AdapterGraphDiagnosticCode =
  | "adapter_graph_method_missing"
  | "adapter_graph_query_failed";

export interface AdapterGraphDiagnostic {
  adapter: string;
  code: AdapterGraphDiagnosticCode;
  severity: "warning";
  message: string;
}

export interface AdapterGraphSnapshot {
  /** Identity of the Knowledge Adapter that produced this isolated graph. */
  adapter: string;
  status: "ok" | "error";
  graph: GraphData;
  diagnostics: AdapterGraphDiagnostic[];
}

export interface AdapterGraphQueryResult {
  /**
   * Per-adapter snapshots. These are deliberately not merged with the
   * filesystem vault.graph contract or with each other.
   */
  snapshots: AdapterGraphSnapshot[];
  diagnostics: AdapterGraphDiagnostic[];
}

function compareText(left: string | undefined, right: string | undefined): number {
  const normalizedLeft = left ?? "";
  const normalizedRight = right ?? "";
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

function compareEvidence(
  left: GraphEdgeEvidence,
  right: GraphEdgeEvidence,
): number {
  return (
    compareText(left.adapter, right.adapter) ||
    compareText(left.relation, right.relation) ||
    compareText(left.confidence, right.confidence) ||
    compareText(left.sourcePath, right.sourcePath)
  );
}

function compareNodes(left: GraphNode, right: GraphNode): number {
  return compareText(left.path, right.path) || compareText(left.title, right.title);
}

function compareEdges(left: GraphEdge, right: GraphEdge): number {
  const leftEvidence = left.evidence ?? [];
  const rightEvidence = right.evidence ?? [];

  const edgeComparison =
    compareText(left.from, right.from) ||
    compareText(left.to, right.to) ||
    compareText(left.type, right.type);
  if (edgeComparison !== 0) return edgeComparison;

  for (let index = 0; index < Math.min(leftEvidence.length, rightEvidence.length); index += 1) {
    const evidenceComparison = compareEvidence(
      leftEvidence[index],
      rightEvidence[index],
    );
    if (evidenceComparison !== 0) return evidenceComparison;
  }
  return leftEvidence.length - rightEvidence.length;
}

function deterministicGraph(graph: GraphData): GraphData {
  const nodes = graph.nodes
    .map((node) => ({ ...node }))
    .sort(compareNodes);
  const edges = graph.edges
    .map((edge) => ({
      ...edge,
      evidence: edge.evidence
        ? edge.evidence.map((item) => ({ ...item })).sort(compareEvidence)
        : undefined,
    }))
    .sort(compareEdges);

  return { nodes, edges };
}

function failureSnapshot(
  adapter: VaultMindAdapter,
  code: AdapterGraphDiagnosticCode,
  message: string,
): AdapterGraphSnapshot {
  const diagnostic: AdapterGraphDiagnostic = {
    adapter: adapter.name,
    code,
    severity: "warning",
    message,
  };
  return {
    adapter: adapter.name,
    status: "error",
    graph: { nodes: [], edges: [] },
    diagnostics: [diagnostic],
  };
}

async function queryAdapter(adapter: VaultMindAdapter): Promise<AdapterGraphSnapshot> {
  if (!adapter.graph) {
    return failureSnapshot(
      adapter,
      "adapter_graph_method_missing",
      `Adapter "${adapter.name}" declares graph capability but has no graph method.`,
    );
  }

  try {
    return {
      adapter: adapter.name,
      status: "ok",
      graph: deterministicGraph(await adapter.graph()),
      diagnostics: [],
    };
  } catch {
    return failureSnapshot(
      adapter,
      "adapter_graph_query_failed",
      "Adapter graph query failed.",
    );
  }
}

/**
 * Read isolated graph snapshots from graph-capable Knowledge Adapters.
 *
 * This facade is read-only. It does not call adapter write methods and does
 * not merge adapter graph data into the core filesystem vault.graph shape.
 */
export async function queryAdapterGraphs(
  registry: AdapterRegistry,
  options: AdapterGraphQueryOptions = {},
): Promise<AdapterGraphQueryResult> {
  const allowlist = options.adapters
    ? new Set(options.adapters)
    : undefined;
  const adapters = registry
    .getByCapability("graph")
    .filter((adapter) => allowlist?.has(adapter.name) ?? true)
    .sort((left, right) => compareText(left.name, right.name));

  const snapshots = (await Promise.all(adapters.map(queryAdapter)))
    .sort((left, right) => compareText(left.adapter, right.adapter));
  const diagnostics = snapshots
    .flatMap((snapshot) => snapshot.diagnostics)
    .sort(
      (left, right) =>
        compareText(left.adapter, right.adapter) ||
        compareText(left.code, right.code) ||
        compareText(left.message, right.message),
    );

  return { snapshots, diagnostics };
}

export function makeAdapterGraphOps(registry: AdapterRegistry): Operation[] {
  return [
    {
      name: "graph.adapters.query",
      namespace: "graph",
      description:
        "Read isolated provenance-bearing graph snapshots from graph-capable Knowledge Adapters without merging them into vault.graph.",
      mutating: false,
      params: {
        adapters: {
          type: "array",
          required: false,
          description:
            "Optional Knowledge Adapter name allowlist. Empty selects none.",
        },
      },
      handler: async (_ctx, params) => {
        const rawAdapters = params.adapters;
        if (
          rawAdapters !== undefined &&
          (!Array.isArray(rawAdapters) ||
            rawAdapters.some(
              (adapter) => typeof adapter !== "string" || !adapter.trim(),
            ))
        ) {
          throw badRequest(
            "adapters must contain non-empty Knowledge Adapter names",
          );
        }
        return queryAdapterGraphs(registry, {
          adapters:
            rawAdapters === undefined
              ? undefined
              : [
                  ...new Set(
                    (rawAdapters as string[]).map((adapter) => adapter.trim()),
                  ),
                ],
        });
      },
    },
  ];
}
