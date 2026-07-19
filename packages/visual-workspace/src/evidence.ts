import { canonicalDigest } from "./canonical.js";
import { VisualWorkspaceError } from "./errors.js";
import type {
  GraphRelationEvidence,
  MindMapDocument,
  Sha256Digest,
} from "./types.js";
import {
  parseGraphRelationEvidence,
  parseMindMapDocument,
} from "./validation.js";

export function graphRelationEvidenceFingerprint(value: unknown): Sha256Digest {
  return canonicalDigest(parseGraphRelationEvidence(value));
}

export function acceptGraphRelationEvidence(
  documentValue: unknown,
  evidenceValue: unknown,
): MindMapDocument {
  const document = parseMindMapDocument(documentValue);
  const evidence: GraphRelationEvidence = parseGraphRelationEvidence(evidenceValue);
  const nodeIds = new Set(document.nodes.map((node) => node.id));
  if (!nodeIds.has(evidence.fromNodeId) || !nodeIds.has(evidence.toNodeId)) {
    throw new VisualWorkspaceError(
      "INVALID_GRAPH",
      "Graph Relation Evidence endpoints must already exist in the Mind Map Document",
    );
  }
  if (evidence.fromNodeId === evidence.toNodeId) {
    throw new VisualWorkspaceError("INVALID_GRAPH", "Graph Relation Evidence cannot create a self cross-link");
  }
  const crossLinkId = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(evidence.id)
    ? evidence.id
    : `graph-${canonicalDigest(evidence.id).slice("sha256:".length, "sha256:".length + 24)}`;
  const existing = (document.crossLinks ?? []).find((edge) => edge.id === crossLinkId);
  const accepted = {
    id: crossLinkId,
    from: evidence.fromNodeId,
    to: evidence.toNodeId,
    relation: evidence.relation,
    provenance: {
      kind: "graph_relation_evidence" as const,
      evidenceId: evidence.id,
      adapterId: evidence.adapter.id,
      confidence: evidence.confidence,
    },
  };
  if (existing) {
    if (canonicalDigest(existing) !== canonicalDigest(accepted)) {
      throw new VisualWorkspaceError(
        "INVALID_GRAPH",
        `Cross-link ${crossLinkId} already records different evidence`,
      );
    }
    return document;
  }
  return parseMindMapDocument({
    ...document,
    crossLinks: [...(document.crossLinks ?? []), accepted],
  });
}
