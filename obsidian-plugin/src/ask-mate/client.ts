import type {
  ApplyVisualEditPlanResult,
  MindMapDocument,
  Sha256Digest,
  VisualEditPlan,
} from "../../../packages/visual-workspace/dist/src/index.js";
import type { SettingsOperationTransport } from "../settings-client";

export const ASK_MATE_OPERATIONS = {
  readMap: "visual.map.read",
  planMap: "visual.map.plan",
  applyMap: "visual.map.apply",
} as const;

export interface AskMateMapReadResult {
  projectId: `project/${string}`;
  path: string;
  source: string;
  sourceSha256: Sha256Digest;
  document: MindMapDocument;
  documentFingerprint: Sha256Digest;
  managedMarkdown: string;
}

export interface AskMateMapPlanResult {
  projectId: `project/${string}`;
  path: string;
  plan: VisualEditPlan;
}

export interface AskMateMapApplyResult extends ApplyVisualEditPlanResult {
  projectId: `project/${string}`;
  receiptPath: string;
}

export interface AskMatePlanInput {
  project: `project/${string}`;
  path: string;
  nextDocument: MindMapDocument;
  actor: string;
  origin?: "user" | "assistant" | "import";
  warnings?: string[];
}

export function isManagedProjectMapPath(
  projectId: `project/${string}`,
  path: string,
): boolean {
  const match = /^project\/([a-z0-9][a-z0-9-]*)$/.exec(projectId);
  if (!match || path.includes("\\")) return false;
  const prefix = `01-Projects/${match[1]}/maps/`;
  if (!path.startsWith(prefix)) return false;
  const relativePath = path.slice(prefix.length);
  return relativePath.length > ".md".length
    && relativePath.endsWith(".md")
    && !relativePath.startsWith(".llmwiki/")
    && relativePath.split("/").every(segment =>
      segment.length > 0 && segment !== "." && segment !== "..");
}

interface AdapterGraphQueryResult {
  snapshots: Array<{
    adapter: string;
    status: "ok" | "error";
    graph: {
      edges: Array<{
        from: string;
        to: string;
        type: "link" | "backlink" | "tag";
        evidence?: Array<{
          adapter: string;
          relation: string;
          confidence: "extracted" | "inferred" | "ambiguous" | "unknown";
          sourcePath?: string;
        }>;
      }>;
    };
  }>;
}

export interface AskMateGraphEvidence {
  id: string;
  adapter: string;
  relation: string;
  from: string;
  to: string;
  confidence: "extracted" | "inferred" | "ambiguous" | "unknown";
  evidenceRefs: string[];
}

/**
 * Thin Operation client. It owns no map state and deliberately has no Vault API
 * dependency; all reads, plans, and writes cross the shared Operation boundary.
 */
export class AskMateOperationClient {
  constructor(private readonly transport: SettingsOperationTransport) {}

  readMap(project: `project/${string}`, path: string): Promise<AskMateMapReadResult> {
    return this.transport.invoke(ASK_MATE_OPERATIONS.readMap, { project, path });
  }

  async queryGraphEvidence(path: string): Promise<AskMateGraphEvidence[]> {
    const result = await this.transport.invoke<AdapterGraphQueryResult>(
      "graph.adapters.query",
      { adapters: ["graphify"] },
    );
    return result.snapshots
      .filter(snapshot => snapshot.status === "ok")
      .flatMap(snapshot => snapshot.graph.edges.flatMap((edge, edgeIndex) => {
        const relevantEvidence = (edge.evidence ?? [])
          .filter(evidence => evidence.adapter === "graphify")
          .filter(evidence => edge.from === path || edge.to === path || evidence.sourcePath === path);
        return relevantEvidence.map((evidence, evidenceIndex) => ({
          id: `${snapshot.adapter}:${edgeIndex}:${evidenceIndex}:${edge.from}:${edge.to}`,
          adapter: evidence.adapter,
          relation: evidence.relation,
          from: edge.from,
          to: edge.to,
          confidence: evidence.confidence,
          evidenceRefs: evidence.sourcePath ? [evidence.sourcePath] : [],
        }));
      }));
  }

  planMap(input: AskMatePlanInput): Promise<AskMateMapPlanResult> {
    return this.transport.invoke(ASK_MATE_OPERATIONS.planMap, {
      project: input.project,
      path: input.path,
      nextDocument: input.nextDocument,
      actor: input.actor,
      origin: input.origin ?? "user",
      ...(input.warnings?.length ? { warnings: input.warnings } : {}),
    });
  }

  applyMap(input: {
    project: `project/${string}`;
    plan: VisualEditPlan;
    presentedFingerprint: Sha256Digest;
    actor: string;
    transitionToken: string;
  }): Promise<AskMateMapApplyResult> {
    return this.transport.invoke(ASK_MATE_OPERATIONS.applyMap, input);
  }
}
