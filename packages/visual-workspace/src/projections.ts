import { canonicalJson, sha256Text } from "./canonical.js";
import { VisualWorkspaceError } from "./errors.js";
import { serializeManagedMindMapSection } from "./markdown.js";
import type {
  BoundedMindMapProjection,
  MindMapDocument,
  ProjectionDiagnostic,
  ProjectionPolicy,
  ProjectedMindMapNode,
  VisualSourceReference,
} from "./types.js";
import { parseMindMapDocument, parseVaultRelativePath } from "./validation.js";

export interface ProjectionOptions {
  sourcePath: string;
  sourceReferences?: Record<string, VisualSourceReference>;
}

export interface MindMapProjectionBundle {
  projection: BoundedMindMapProjection;
  markdown: string;
  text: string;
  mermaid: string;
  canvas: string;
}

function positiveInteger(value: number, context: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new VisualWorkspaceError(
      "INVALID_CONTRACT",
      `${context} must be an integer between 1 and ${maximum}`,
    );
  }
  return value;
}

function sourceLink(
  nodeId: string,
  sourcePath: string,
  references: Record<string, VisualSourceReference>,
): string {
  const reference = references[nodeId];
  const path = reference?.path ?? sourcePath;
  if (reference?.blockId) return `[[${path}#^${reference.blockId}]]`;
  if (reference?.canvasNodeId) return `[[${path}]]#canvas-node=${reference.canvasNodeId}`;
  return `[[${path}#^${nodeId}]]`;
}

function descendants(adjacency: Map<string, string[]>, rootId: string): string[] {
  const output: string[] = [];
  const visit = (id: string): void => {
    for (const child of adjacency.get(id) ?? []) {
      output.push(child);
      visit(child);
    }
  };
  visit(rootId);
  return output;
}

export function deriveBoundedMindMapProjection(
  value: unknown,
  policy: ProjectionPolicy,
  options: ProjectionOptions,
): BoundedMindMapProjection {
  const document = parseMindMapDocument(value);
  const sourcePath = parseVaultRelativePath(options.sourcePath, "ProjectionOptions.sourcePath");
  const maxNodes = positiveInteger(policy.maxNodes, "ProjectionPolicy.maxNodes", 10_000);
  const maxDepth = positiveInteger(policy.maxDepth, "ProjectionPolicy.maxDepth", 256);
  const horizontalGap = policy.horizontalGap === undefined
    ? 260
    : positiveInteger(policy.horizontalGap, "ProjectionPolicy.horizontalGap", 2_000);
  const verticalGap = policy.verticalGap === undefined
    ? 96
    : positiveInteger(policy.verticalGap, "ProjectionPolicy.verticalGap", 1_000);
  const references = options.sourceReferences ?? {};
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const nodeOrder = new Map(document.nodes.map((node, index) => [node.id, index]));
  const adjacency = new Map<string, string[]>();
  for (const edge of document.edges) {
    const children = adjacency.get(edge.from) ?? [];
    children.push(edge.to);
    adjacency.set(edge.from, children);
  }
  for (const children of adjacency.values()) {
    children.sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));
  }

  const included: Array<{ id: string; depth: number }> = [];
  const depthOmitted = new Set<string>();
  const nodeLimitOmitted = new Set<string>();
  const visit = (id: string, depth: number): void => {
    if (included.length >= maxNodes) {
      nodeLimitOmitted.add(id);
      for (const descendant of descendants(adjacency, id)) nodeLimitOmitted.add(descendant);
      return;
    }
    included.push({ id, depth });
    const children = adjacency.get(id) ?? [];
    if (depth >= maxDepth) {
      for (const child of children) {
        depthOmitted.add(child);
        for (const descendant of descendants(adjacency, child)) depthOmitted.add(descendant);
      }
      return;
    }
    for (const child of children) visit(child, depth + 1);
  };
  visit(document.rootId, 0);
  const includedIds = new Set(included.map(({ id }) => id));
  const edges = document.edges.filter((edge) => includedIds.has(edge.from) && includedIds.has(edge.to));
  const crossLinks = (document.crossLinks ?? []).filter(
    (edge) => includedIds.has(edge.from) && includedIds.has(edge.to),
  );
  const omittedCrossLinkIds = (document.crossLinks ?? [])
    .filter((edge) => !includedIds.has(edge.from) || !includedIds.has(edge.to))
    .map((edge) => edge.id);

  const includedChildren = new Map<string, string[]>();
  for (const edge of edges) {
    const children = includedChildren.get(edge.from) ?? [];
    children.push(edge.to);
    includedChildren.set(edge.from, children);
  }
  let nextLeaf = 0;
  const yById = new Map<string, number>();
  const place = (id: string): number => {
    const children = includedChildren.get(id) ?? [];
    if (children.length === 0) {
      const y = nextLeaf * verticalGap;
      nextLeaf += 1;
      yById.set(id, y);
      return y;
    }
    const childPositions = children.map(place);
    const y = (childPositions[0]! + childPositions.at(-1)!) / 2;
    yById.set(id, y);
    return y;
  };
  place(document.rootId);
  const nodes: ProjectedMindMapNode[] = included.map(({ id, depth }) => ({
    ...nodeById.get(id)!,
    depth,
    x: depth * horizontalGap,
    y: yById.get(id) ?? 0,
    sourceLink: sourceLink(id, sourcePath, references),
  }));

  const diagnostics: ProjectionDiagnostic[] = [];
  if (depthOmitted.size > 0) {
    diagnostics.push({
      code: "DEPTH_TRUNCATED",
      message: `Projection omitted ${depthOmitted.size} nodes below depth ${maxDepth}.`,
      omittedNodeIds: [...depthOmitted].sort(),
      omittedCrossLinkIds: [],
    });
  }
  if (nodeLimitOmitted.size > 0) {
    diagnostics.push({
      code: "NODE_LIMIT_TRUNCATED",
      message: `Projection omitted ${nodeLimitOmitted.size} nodes after reaching the ${maxNodes}-node limit.`,
      omittedNodeIds: [...nodeLimitOmitted].sort(),
      omittedCrossLinkIds: [],
    });
  }
  if (omittedCrossLinkIds.length > 0) {
    diagnostics.push({
      code: "CROSS_LINK_OMITTED",
      message: `Projection omitted ${omittedCrossLinkIds.length} cross-links with truncated endpoints.`,
      omittedNodeIds: [],
      omittedCrossLinkIds: omittedCrossLinkIds.sort(),
    });
  }
  return {
    schemaVersion: 1,
    documentId: document.id,
    rootId: document.rootId,
    nodes,
    edges,
    crossLinks,
    diagnostics,
  };
}

function projectedDocument(
  source: MindMapDocument,
  projection: BoundedMindMapProjection,
): MindMapDocument {
  return parseMindMapDocument({
    schemaVersion: 1,
    id: source.id,
    title: source.title,
    rootId: projection.rootId,
    nodes: projection.nodes.map(({ id, label }) => ({ id, label })),
    edges: projection.edges,
    ...(projection.crossLinks.length > 0 ? { crossLinks: projection.crossLinks } : {}),
  });
}

export function renderTextMindMap(projection: BoundedMindMapProjection): string {
  const lines = projection.nodes.map(
    (node) => `${"  ".repeat(node.depth)}- ${node.label} (${node.sourceLink}) ^${node.id}`,
  );
  if (projection.crossLinks.length > 0) {
    const labelById = new Map(projection.nodes.map((node) => [node.id, node.label]));
    lines.push("", "Cross-links:");
    for (const edge of projection.crossLinks) {
      const provenance = edge.provenance.kind === "graph_relation_evidence"
        ? `; ${edge.provenance.adapterId}/${edge.provenance.confidence}; evidence=${edge.provenance.evidenceId}`
        : `; ${edge.provenance.kind}`;
      lines.push(
        `- ${labelById.get(edge.from)} --${edge.relation}--> ${labelById.get(edge.to)} (${edge.id}${provenance})`,
      );
    }
  }
  if (projection.diagnostics.length > 0) {
    lines.push("", "Projection diagnostics:");
    for (const diagnostic of projection.diagnostics) lines.push(`- ${diagnostic.code}: ${diagnostic.message}`);
  }
  return lines.join("\n");
}

function mermaidLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

export function renderMermaidMindMap(projection: BoundedMindMapProjection): string {
  const lines = ["mindmap"];
  for (const node of projection.nodes) {
    const label = mermaidLabel(`${node.label} · ${node.sourceLink}`);
    lines.push(`${"  ".repeat(node.depth + 1)}${node.id}["${label}"]`);
  }
  if (projection.crossLinks.length > 0) {
    lines.push(
      ...projection.crossLinks.map(
        (edge) => `%% cross-link ${edge.id}: ${edge.from} --${edge.relation}--> ${edge.to}`,
      ),
    );
  }
  for (const diagnostic of projection.diagnostics) {
    lines.push(`%% ${diagnostic.code}: ${diagnostic.message}`);
  }
  return lines.join("\n");
}

export function renderObsidianCanvas(projection: BoundedMindMapProjection): string {
  const nodes = projection.nodes.map((node) => ({
    id: node.id,
    type: "text",
    text: `${node.label}\n${node.sourceLink}`,
    x: node.x,
    y: node.y,
    width: Math.min(560, Math.max(220, 120 + node.label.length * 8)),
    height: 96,
  }));
  const treeEdges = projection.edges.map((edge) => ({
    id: `tree-${sha256Text(`${edge.from}\0${edge.to}`).slice(7, 27)}`,
    fromNode: edge.from,
    fromSide: "right",
    toNode: edge.to,
    toSide: "left",
    toEnd: "arrow",
  }));
  const crossLinkEdges = projection.crossLinks.map((edge) => ({
    id: edge.id,
    fromNode: edge.from,
    toNode: edge.to,
    toEnd: "arrow",
    color: "5",
    label: edge.relation,
  }));
  return canonicalJson({ nodes, edges: [...treeEdges, ...crossLinkEdges] });
}

export function renderMindMapProjectionBundle(
  value: unknown,
  policy: ProjectionPolicy,
  options: ProjectionOptions,
): MindMapProjectionBundle {
  const document = parseMindMapDocument(value);
  const projection = deriveBoundedMindMapProjection(document, policy, options);
  return {
    projection,
    markdown: serializeManagedMindMapSection(projectedDocument(document, projection)),
    text: renderTextMindMap(projection),
    mermaid: renderMermaidMindMap(projection),
    canvas: renderObsidianCanvas(projection),
  };
}
