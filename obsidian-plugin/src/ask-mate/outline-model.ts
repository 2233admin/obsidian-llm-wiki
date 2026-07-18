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
  textualPreview: string;
  selectedSuggestionIds: string[];
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
  #plan: VisualEditPlan | null = null;
  #suggestions: GraphRelationSuggestion[] = [];
  #selectedSuggestionIds = new Set<string>();

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
    return {
      document,
      textualPreview: renderTextualTree(document),
      selectedSuggestionIds: [...this.#selectedSuggestionIds].sort(),
    };
  }

  load(document: unknown, suggestions: readonly GraphRelationSuggestion[] = []): void {
    this.#document = parseMindMapDocument(document);
    this.replaceSuggestions(suggestions);
    this.#plan = null;
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

  acceptPlan(plan: VisualEditPlan): void {
    this.#plan = structuredClone(plan);
  }

  clearPlan(): void {
    this.#plan = null;
  }

  dispose(): void {
    this.#document = null;
    this.#plan = null;
    this.#suggestions = [];
    this.#selectedSuggestionIds.clear();
  }

  #mutate(update: (document: MindMapDocument) => MindMapDocument, requiredNodeId: string): void {
    const document = this.document;
    if (!document.nodes.some(node => node.id === requiredNodeId)) throw new Error(`Unknown node: ${requiredNodeId}`);
    this.#adopt(update(document));
  }

  #adopt(document: unknown): void {
    this.#document = parseMindMapDocument(document);
    this.#plan = null;
  }
}
