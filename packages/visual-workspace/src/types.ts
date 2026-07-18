export type Sha256Digest = `sha256:${string}`;

export interface MindMapNode {
  id: string;
  label: string;
}

export interface MindMapEdge {
  from: string;
  to: string;
}

export interface MindMapDocument {
  schemaVersion: 1;
  id: string;
  title: string;
  rootId: string;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
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
