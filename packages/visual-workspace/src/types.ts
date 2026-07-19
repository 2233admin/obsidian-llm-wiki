export type Sha256Digest = `sha256:${string}`;

export interface MindMapNode {
  id: string;
  label: string;
}

export interface MindMapEdge {
  from: string;
  to: string;
}

export type GraphRelationConfidence = "extracted" | "inferred" | "ambiguous" | "unknown";

export interface GraphEvidenceReference {
  kind: "vault" | "url" | "adapter";
  value: string;
}

export interface GraphRelationEvidence {
  schemaVersion: 1;
  id: string;
  adapter: {
    id: string;
    version: string;
  };
  relation: string;
  fromNodeId: string;
  toNodeId: string;
  confidence: GraphRelationConfidence;
  evidence: GraphEvidenceReference[];
}

export interface MindMapCrossLink {
  id: string;
  from: string;
  to: string;
  relation: string;
  provenance: {
    kind: "explicit" | "graph_relation_evidence" | "model_suggestion";
    evidenceId?: string;
    adapterId?: string;
    confidence?: GraphRelationConfidence;
  };
}

export interface MindMapDocument {
  schemaVersion: 1;
  id: string;
  title: string;
  rootId: string;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
  crossLinks?: MindMapCrossLink[];
}

export interface ManagedMindMapSection {
  document: MindMapDocument;
  start: number;
  end: number;
  raw: string;
  eol: "\n" | "\r\n" | "\r";
}

export interface VisualEditSnapshot {
  document: MindMapDocument;
  documentFingerprint: Sha256Digest;
  managedMarkdown: string;
}

export interface VisualEditPlan {
  schemaVersion: 1;
  source: {
    path: string;
    sha256: Sha256Digest;
  };
  preview: {
    before: VisualEditSnapshot;
    after: VisualEditSnapshot;
  };
  affectedPaths: string[];
  provenance: {
    actor: string;
    origin: "user" | "assistant" | "import";
  };
  warnings: string[];
  fingerprint: Sha256Digest;
}

export interface VisualApplyRequest {
  plan: VisualEditPlan;
  presentedFingerprint: Sha256Digest;
  actor: string;
  transitionToken: string;
}

export interface ApplyVisualEditPlanResult {
  path: string;
  source: string;
  sourceSha256: Sha256Digest;
  planFingerprint: Sha256Digest;
  actor: string;
  transitionToken: string;
  replayed: boolean;
}

export interface SourceRange {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}

export interface VisualSourceReference {
  path: string;
  range?: SourceRange;
  blockId?: string;
  canvasNodeId?: string;
  wikilinks?: string[];
}

export interface VisualSourceDiagnostic {
  code:
    | "AMBIGUOUS_ROOT"
    | "AMBIGUOUS_PARENT"
    | "DUPLICATE_ID"
    | "EMPTY_SOURCE"
    | "INFERRED_ID"
    | "UNSUPPORTED_CANVAS_FIELD"
    | "UNSUPPORTED_CANVAS_NODE"
    | "UNSUPPORTED_MARKDOWN"
    | "UNDIRECTED_CANVAS_EDGE";
  severity: "info" | "warning" | "error";
  message: string;
  subjectIds: string[];
}

export interface VisualAdoptionCandidate {
  schemaVersion: 1;
  sourceKind: "markdown" | "canvas";
  sourcePath: string;
  sourceSha256: Sha256Digest;
  title: string;
  nodes: MindMapNode[];
  relations: Array<{
    id: string;
    from: string;
    to: string;
    relation: string;
  }>;
  candidateRootIds: string[];
  parentChoices: Record<string, string[]>;
  sourceReferences: Record<string, VisualSourceReference>;
  diagnostics: VisualSourceDiagnostic[];
}

export interface VisualSourceReadResult {
  schemaVersion: 1;
  sourceKind: "managed_markdown" | "markdown" | "canvas";
  sourcePath: string;
  sourceSha256: Sha256Digest;
  document?: MindMapDocument;
  adoptionCandidate?: VisualAdoptionCandidate;
  sourceReferences: Record<string, VisualSourceReference>;
  diagnostics: VisualSourceDiagnostic[];
}

export interface AdoptionChoices {
  rootId: string;
  parentByNode: Record<string, string>;
}

export interface ProjectionPolicy {
  maxNodes: number;
  maxDepth: number;
  horizontalGap?: number;
  verticalGap?: number;
}

export interface ProjectionDiagnostic {
  code: "DEPTH_TRUNCATED" | "NODE_LIMIT_TRUNCATED" | "CROSS_LINK_OMITTED";
  message: string;
  omittedNodeIds: string[];
  omittedCrossLinkIds: string[];
}

export interface ProjectedMindMapNode extends MindMapNode {
  depth: number;
  x: number;
  y: number;
  sourceLink: string;
}

export interface BoundedMindMapProjection {
  schemaVersion: 1;
  documentId: string;
  rootId: string;
  nodes: ProjectedMindMapNode[];
  edges: MindMapEdge[];
  crossLinks: MindMapCrossLink[];
  diagnostics: ProjectionDiagnostic[];
}
