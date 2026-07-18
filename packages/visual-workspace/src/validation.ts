import { canonicalDigest, canonicalMindMapDocument, deepClone } from "./canonical.js";
import { VisualWorkspaceError } from "./errors.js";
import type {
  MindMapDocument,
  MindMapEdge,
  MindMapNode,
  Sha256Digest,
} from "./types.js";

const BLOCK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:/;

function fail(message: string): never {
  throw new VisualWorkspaceError("INVALID_CONTRACT", message);
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function assertExactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
): void {
  const expectedSet = new Set(expected);
  const unknown = Object.keys(value).filter((key) => !expectedSet.has(key));
  const missing = expected.filter((key) => !(key in value));
  if (unknown.length > 0) fail(`${context} has unknown fields: ${unknown.join(", ")}`);
  if (missing.length > 0) fail(`${context} is missing fields: ${missing.join(", ")}`);
}

function text(value: unknown, context: string, allowNewlines = false): string {
  if (typeof value !== "string" || value.length === 0) return fail(`${context} must be a non-empty string`);
  if (!allowNewlines && /[\r\n]/.test(value)) return fail(`${context} must not contain a newline`);
  return value;
}

function blockId(value: unknown, context: string): string {
  const candidate = text(value, context);
  if (!BLOCK_ID.test(candidate)) return fail(`${context} must be an Obsidian-compatible block ID`);
  return candidate;
}

export function assertSha256Digest(value: unknown, context: string): asserts value is Sha256Digest {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${context} must be a sha256 digest`);
}

export function parseVaultRelativePath(value: unknown, context = "path"): string {
  const candidate = text(value, context);
  if (
    candidate.length > 4096
    || candidate.startsWith("/")
    || candidate.startsWith("\\")
    || WINDOWS_DRIVE_PATH.test(candidate)
    || candidate.includes("\\")
    || candidate.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return fail(`${context} must be a normalized vault-relative path`);
  }
  return candidate;
}

export function parseMindMapNode(value: unknown, context = "MindMapNode"): MindMapNode {
  const candidate = record(value, context);
  assertExactFields(candidate, ["id", "label"], context);
  return {
    id: blockId(candidate.id, `${context}.id`),
    label: text(candidate.label, `${context}.label`),
  };
}

export function parseMindMapEdge(value: unknown, context = "MindMapEdge"): MindMapEdge {
  const candidate = record(value, context);
  assertExactFields(candidate, ["from", "to"], context);
  return {
    from: blockId(candidate.from, `${context}.from`),
    to: blockId(candidate.to, `${context}.to`),
  };
}

export function parseMindMapDocument(value: unknown): MindMapDocument {
  const candidate = record(value, "MindMapDocument");
  assertExactFields(candidate, ["schemaVersion", "id", "title", "rootId", "nodes", "edges"], "MindMapDocument");
  if (candidate.schemaVersion !== 1) fail("MindMapDocument.schemaVersion must be 1");
  if (!Array.isArray(candidate.nodes) || candidate.nodes.length === 0) fail("MindMapDocument.nodes must be non-empty");
  if (!Array.isArray(candidate.edges)) fail("MindMapDocument.edges must be an array");

  const document: MindMapDocument = {
    schemaVersion: 1,
    id: blockId(candidate.id, "MindMapDocument.id"),
    title: text(candidate.title, "MindMapDocument.title"),
    rootId: blockId(candidate.rootId, "MindMapDocument.rootId"),
    nodes: candidate.nodes.map((node, index) => parseMindMapNode(node, `MindMapDocument.nodes[${index}]`)),
    edges: candidate.edges.map((edge, index) => parseMindMapEdge(edge, `MindMapDocument.edges[${index}]`)),
  };
  assertValidMindMapGraph(document);
  return deepClone(document);
}

export function assertValidMindMapGraph(document: MindMapDocument): void {
  const ids = new Set<string>();
  for (const node of document.nodes) {
    if (ids.has(node.id)) {
      throw new VisualWorkspaceError("INVALID_GRAPH", `Duplicate node ID: ${node.id}`);
    }
    ids.add(node.id);
  }
  if (!ids.has(document.rootId)) {
    throw new VisualWorkspaceError("INVALID_GRAPH", "The declared root node does not exist");
  }

  const indegree = new Map(document.nodes.map((node) => [node.id, 0]));
  const adjacency = new Map<string, string[]>();
  const edges = new Set<string>();
  for (const edge of document.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new VisualWorkspaceError("INVALID_GRAPH", `Dangling edge: ${edge.from} -> ${edge.to}`);
    }
    if (edge.from === edge.to) {
      throw new VisualWorkspaceError("INVALID_GRAPH", `Self cycle at node: ${edge.from}`);
    }
    const key = `${edge.from}\0${edge.to}`;
    if (edges.has(key)) {
      throw new VisualWorkspaceError("INVALID_GRAPH", `Duplicate edge: ${edge.from} -> ${edge.to}`);
    }
    edges.add(key);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    const children = adjacency.get(edge.from) ?? [];
    children.push(edge.to);
    adjacency.set(edge.from, children);
  }

  const roots = document.nodes.filter((node) => indegree.get(node.id) === 0);
  if (roots.length !== 1 || roots[0]?.id !== document.rootId) {
    throw new VisualWorkspaceError("INVALID_GRAPH", "A mind map must have exactly one declared root");
  }
  for (const node of document.nodes) {
    const degree = indegree.get(node.id) ?? 0;
    if (node.id !== document.rootId && degree !== 1) {
      throw new VisualWorkspaceError("INVALID_GRAPH", `Node ${node.id} must have exactly one parent`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new VisualWorkspaceError("INVALID_GRAPH", `Cycle detected at node: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of adjacency.get(id) ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  };
  visit(document.rootId);
  if (visited.size !== document.nodes.length) {
    throw new VisualWorkspaceError("INVALID_GRAPH", "Every node must be reachable from the root");
  }
}

export function mindMapFingerprint(value: unknown): Sha256Digest {
  const document = parseMindMapDocument(value);
  return canonicalDigest(canonicalMindMapDocument(document));
}

export function isObsidianBlockId(value: string): boolean {
  return BLOCK_ID.test(value);
}
