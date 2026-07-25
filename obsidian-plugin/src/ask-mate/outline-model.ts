import {
  parseMindMapDocument,
  type MindMapDocument,
  type MindMapEdge,
  type MindMapNode,
  type VisualEditPlan,
} from "../../../packages/visual-workspace/dist/src/index.js";

export type GraphRelationConfidence = "extracted" | "inferred" | "ambiguous" | "unknown";

export interface GraphRelationSuggestion {
  id: string;
  adapter: string;
  relation: string;
  from: string;
  to: string;
  confidence: GraphRelationConfidence;
  evidenceRefs: string[];
}

export interface OutlineSnapshot {
  document: MindMapDocument;
  documentForPlan: MindMapDocument;
  textualPreview: string;
  selectedSuggestionIds: string[];
  selectedChangeIds: string[];
  structuralChanges: OutlineStructuralChange[];
}

export interface OutlineStructuralChange {
  id: string;
  kind: "add_subtree" | "remove_subtree" | "rename" | "reparent";
  nodeId: string;
  label: string;
  summary: string;
}

function cloneDocument(document: MindMapDocument): MindMapDocument {
  return structuredClone(document);
}

function childrenByParent(document: MindMapDocument): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const edge of document.edges) {
    const siblings = children.get(edge.from) ?? [];
    siblings.push(edge.to);
    children.set(edge.from, siblings);
  }
  return children;
}

export function renderTextualTree(document: MindMapDocument): string {
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const children = childrenByParent(document);
  const lines: string[] = [];
  const visit = (nodeId: string, depth: number): void => {
    const node = nodes.get(nodeId);
    if (!node) return;
    lines.push(`${"  ".repeat(depth)}- ${node.label} ^${node.id}`);
    for (const childId of children.get(nodeId) ?? []) visit(childId, depth + 1);
  };
  visit(document.rootId, 0);
  if (document.crossLinks?.length) {
    lines.push("", "Cross-links:");
    for (const edge of document.crossLinks) {
      const from = nodes.get(edge.from)?.label ?? edge.from;
      const to = nodes.get(edge.to)?.label ?? edge.to;
      const provenance = [
        edge.provenance.kind,
        edge.provenance.adapterId,
        edge.provenance.confidence,
      ].filter(Boolean).join(" · ");
      lines.push(`- ${from} —${edge.relation}→ ${to} [${provenance}]`);
    }
  }
  return lines.join("\n");
}

function nextNodeId(document: MindMapDocument): string {
  const used = new Set(document.nodes.map(node => node.id));
  for (let index = 1; index <= document.nodes.length + 1; index += 1) {
    const candidate = `node-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate a stable outline node ID");
}

function nonEmptyLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    throw new Error("Node labels must be non-empty single-line text");
  }
  return trimmed;
}

function descendants(document: MindMapDocument, nodeId: string): Set<string> {
  const children = childrenByParent(document);
  const found = new Set<string>();
  const visit = (id: string): void => {
    for (const child of children.get(id) ?? []) {
      if (found.has(child)) continue;
      found.add(child);
      visit(child);
    }
  };
  visit(nodeId);
  return found;
}

/**
 * Ephemeral, deterministic outline state. No method writes a file. Every
 * mutation validates a complete MindMapDocument and invalidates any old plan.
 */
export class AskMateOutlineModel {
  #document: MindMapDocument | null = null;
  #baseline: MindMapDocument | null = null;
  #plan: VisualEditPlan | null = null;
  #suggestions: GraphRelationSuggestion[] = [];
  #selectedSuggestionIds = new Set<string>();
  #selectedChangeIds = new Set<string>();

  get hasDocument(): boolean {
    return this.#document !== null;
  }

  get document(): MindMapDocument {
    if (!this.#document) throw new Error("No mind map is loaded");
    return cloneDocument(this.#document);
  }

  get plan(): VisualEditPlan | null {
    return this.#plan ? structuredClone(this.#plan) : null;
  }

  get suggestions(): readonly GraphRelationSuggestion[] {
    return structuredClone(this.#suggestions);
  }

  get snapshot(): OutlineSnapshot {
    const document = this.document;
    const structuralChanges = diffMindMapDocuments(this.#requiredBaseline(), document);
    return {
      document,
      documentForPlan: documentForSelectedChanges(
        this.#requiredBaseline(),
        document,
        this.#selectedChangeIds,
      ),
      textualPreview: renderTextualTree(document),
      selectedSuggestionIds: [...this.#selectedSuggestionIds].sort(),
      selectedChangeIds: [...this.#selectedChangeIds].sort(),
      structuralChanges,
    };
  }

  load(document: unknown, suggestions: readonly GraphRelationSuggestion[] = []): void {
    this.#document = parseMindMapDocument(document);
    this.#baseline = cloneDocument(this.#document);
    this.replaceSuggestions(suggestions);
    this.#plan = null;
    this.#selectedChangeIds.clear();
  }

  replaceSuggestions(suggestions: readonly GraphRelationSuggestion[]): void {
    this.#suggestions = structuredClone([...suggestions]);
    this.#selectedSuggestionIds.clear();
  }

  rename(nodeId: string, label: string): void {
    this.#mutate(document => ({
      ...document,
      nodes: document.nodes.map(node => node.id === nodeId
        ? { ...node, label: nonEmptyLabel(label) }
        : node),
    }), nodeId);
  }

  add(parentId: string, label: string): string {
    const document = this.document;
    if (!document.nodes.some(node => node.id === parentId)) throw new Error(`Unknown parent node: ${parentId}`);
    const id = nextNodeId(document);
    const node: MindMapNode = { id, label: nonEmptyLabel(label) };
    const edge: MindMapEdge = { from: parentId, to: id };
    this.#adopt({ ...document, nodes: [...document.nodes, node], edges: [...document.edges, edge] });
    return id;
  }

  remove(nodeId: string): void {
    const document = this.document;
    if (nodeId === document.rootId) throw new Error("The root node cannot be removed");
    if (!document.nodes.some(node => node.id === nodeId)) throw new Error(`Unknown node: ${nodeId}`);
    const removed = descendants(document, nodeId);
    removed.add(nodeId);
    this.#adopt({
      ...document,
      nodes: document.nodes.filter(node => !removed.has(node.id)),
      edges: document.edges.filter(edge => !removed.has(edge.from) && !removed.has(edge.to)),
      ...(document.crossLinks
        ? { crossLinks: document.crossLinks.filter(edge =>
          !removed.has(edge.from) && !removed.has(edge.to)) }
        : {}),
    });
  }

  reparent(nodeId: string, nextParentId: string): void {
    const document = this.document;
    if (nodeId === document.rootId) throw new Error("The root node cannot be reparented");
    if (nodeId === nextParentId) throw new Error("A node cannot parent itself");
    if (!document.nodes.some(node => node.id === nodeId)) throw new Error(`Unknown node: ${nodeId}`);
    if (!document.nodes.some(node => node.id === nextParentId)) throw new Error(`Unknown parent node: ${nextParentId}`);
    if (descendants(document, nodeId).has(nextParentId)) {
      throw new Error("A node cannot be reparented beneath its descendant");
    }
    this.#adopt({
      ...document,
      edges: [
        ...document.edges.filter(edge => edge.to !== nodeId),
        { from: nextParentId, to: nodeId },
      ],
    });
  }

  selectSuggestion(suggestionId: string, selected: boolean): void {
    if (!this.#suggestions.some(suggestion => suggestion.id === suggestionId)) {
      throw new Error(`Unknown Graph Relation Evidence: ${suggestionId}`);
    }
    if (selected) this.#selectedSuggestionIds.add(suggestionId);
    else this.#selectedSuggestionIds.delete(suggestionId);
    // Evidence selection is review state only in this slice. It never mutates
    // the accepted hierarchy or silently enters a plan.
    this.#plan = null;
  }

  setChangeSelected(changeId: string, selected: boolean): void {
    const changes = diffMindMapDocuments(this.#requiredBaseline(), this.document);
    if (!changes.some(change => change.id === changeId)) {
      throw new Error(`Unknown structural change: ${changeId}`);
    }
    const next = new Set(this.#selectedChangeIds);
    if (selected) next.add(changeId);
    else next.delete(changeId);
    documentForSelectedChanges(this.#requiredBaseline(), this.document, next);
    this.#selectedChangeIds = next;
    this.#plan = null;
  }

  get selectedSuggestions(): readonly GraphRelationSuggestion[] {
    return structuredClone(
      this.#suggestions.filter(suggestion => this.#selectedSuggestionIds.has(suggestion.id)),
    );
  }

  get documentForPlan(): MindMapDocument {
    return this.snapshot.documentForPlan;
  }

  acceptPlan(plan: VisualEditPlan): void {
    this.#plan = structuredClone(plan);
  }

  clearPlan(): void {
    this.#plan = null;
  }

  dispose(): void {
    this.#document = null;
    this.#baseline = null;
    this.#plan = null;
    this.#suggestions = [];
    this.#selectedSuggestionIds.clear();
    this.#selectedChangeIds.clear();
  }

  #mutate(update: (document: MindMapDocument) => MindMapDocument, requiredNodeId: string): void {
    const document = this.document;
    if (!document.nodes.some(node => node.id === requiredNodeId)) throw new Error(`Unknown node: ${requiredNodeId}`);
    this.#adopt(update(document));
  }

  #adopt(document: unknown): void {
    this.#document = parseMindMapDocument(document);
    this.#selectedChangeIds = new Set(
      diffMindMapDocuments(this.#requiredBaseline(), this.#document).map(change => change.id),
    );
    this.#plan = null;
  }

  #requiredBaseline(): MindMapDocument {
    if (!this.#baseline) throw new Error("No mind map baseline is loaded");
    return cloneDocument(this.#baseline);
  }
}

function parentMap(document: MindMapDocument): Map<string, string> {
  return new Map(document.edges.map(edge => [edge.to, edge.from]));
}

function subtreeNodeIds(document: MindMapDocument, rootId: string): Set<string> {
  const found = descendants(document, rootId);
  found.add(rootId);
  return found;
}

export function diffMindMapDocuments(
  baseline: MindMapDocument,
  draft: MindMapDocument,
): OutlineStructuralChange[] {
  const baselineNodes = new Map(baseline.nodes.map(node => [node.id, node]));
  const draftNodes = new Map(draft.nodes.map(node => [node.id, node]));
  const baselineParents = parentMap(baseline);
  const draftParents = parentMap(draft);
  const changes: OutlineStructuralChange[] = [];

  for (const node of draft.nodes) {
    if (baselineNodes.has(node.id)) continue;
    const parent = draftParents.get(node.id);
    if (parent && !baselineNodes.has(parent)) continue;
    changes.push({
      id: `add_subtree:${node.id}`,
      kind: "add_subtree",
      nodeId: node.id,
      label: node.label,
      summary: `Add ${node.label}${parent ? ` under ${draftNodes.get(parent)?.label ?? parent}` : ""}`,
    });
  }

  for (const node of baseline.nodes) {
    if (draftNodes.has(node.id)) continue;
    const parent = baselineParents.get(node.id);
    if (parent && !draftNodes.has(parent)) continue;
    changes.push({
      id: `remove_subtree:${node.id}`,
      kind: "remove_subtree",
      nodeId: node.id,
      label: node.label,
      summary: `Remove ${node.label} and its removed descendants`,
    });
  }

  for (const baselineNode of baseline.nodes) {
    const draftNode = draftNodes.get(baselineNode.id);
    if (!draftNode) continue;
    if (baselineNode.label !== draftNode.label) {
      changes.push({
        id: `rename:${baselineNode.id}`,
        kind: "rename",
        nodeId: baselineNode.id,
        label: draftNode.label,
        summary: `Rename ${baselineNode.label} to ${draftNode.label}`,
      });
    }
    if (
      baselineNode.id !== baseline.rootId
      && baselineParents.get(baselineNode.id) !== draftParents.get(baselineNode.id)
    ) {
      const nextParent = draftParents.get(baselineNode.id);
      changes.push({
        id: `reparent:${baselineNode.id}`,
        kind: "reparent",
        nodeId: baselineNode.id,
        label: draftNode.label,
        summary: `Move ${draftNode.label} under ${nextParent
          ? draftNodes.get(nextParent)?.label ?? nextParent
          : "no parent"}`,
      });
    }
  }
  return changes;
}

export function documentForSelectedChanges(
  baseline: MindMapDocument,
  draft: MindMapDocument,
  selectedChangeIds: ReadonlySet<string>,
): MindMapDocument {
  const changes = diffMindMapDocuments(baseline, draft);
  const selected = new Set(changes.filter(change => selectedChangeIds.has(change.id)).map(change => change.id));
  const included = new Set(baseline.nodes.map(node => node.id));

  for (const change of changes) {
    if (change.kind === "remove_subtree" && selected.has(change.id)) {
      for (const nodeId of subtreeNodeIds(baseline, change.nodeId)) included.delete(nodeId);
    }
    if (change.kind === "add_subtree" && selected.has(change.id)) {
      for (const nodeId of subtreeNodeIds(draft, change.nodeId)) included.add(nodeId);
    }
  }

  const baselineNodes = new Map(baseline.nodes.map(node => [node.id, node]));
  const draftNodes = new Map(draft.nodes.map(node => [node.id, node]));
  const baselineParents = parentMap(baseline);
  const draftParents = parentMap(draft);
  const orderedIds = [
    ...baseline.nodes.map(node => node.id),
    ...draft.nodes.map(node => node.id).filter(nodeId => !baselineNodes.has(nodeId)),
  ].filter((nodeId, index, all) => included.has(nodeId) && all.indexOf(nodeId) === index);
  const nodes = orderedIds.map(nodeId => {
    const before = baselineNodes.get(nodeId);
    const after = draftNodes.get(nodeId);
    if (!before && after) return structuredClone(after);
    if (!before || !after) return structuredClone(before ?? after!);
    return selected.has(`rename:${nodeId}`) ? structuredClone(after) : structuredClone(before);
  });
  const chosenParents = new Map<string, string>();
  for (const nodeId of orderedIds) {
    if (nodeId === baseline.rootId) continue;
    const beforeParent = baselineParents.get(nodeId);
    const afterParent = draftParents.get(nodeId);
    const parent = !baselineNodes.has(nodeId)
      ? afterParent
      : selected.has(`reparent:${nodeId}`)
        ? afterParent
        : beforeParent;
    if (parent && included.has(parent)) chosenParents.set(nodeId, parent);
  }
  const edges: MindMapEdge[] = [];
  for (const edge of [...baseline.edges, ...draft.edges]) {
    if (
      chosenParents.get(edge.to) === edge.from
      && !edges.some(existing => existing.to === edge.to)
    ) edges.push({ from: edge.from, to: edge.to });
  }
  return parseMindMapDocument({
    ...baseline,
    nodes,
    edges,
    ...(baseline.crossLinks
      ? { crossLinks: baseline.crossLinks.filter(edge =>
        included.has(edge.from) && included.has(edge.to)) }
      : {}),
  });
}
