import { createHash } from "node:crypto";

import type { MindMapDocument, Sha256Digest } from "./types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Text(value: string): Sha256Digest {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function canonicalDigest(value: unknown): Sha256Digest {
  return sha256Text(canonicalJson(value));
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function canonicalMindMapDocument(document: MindMapDocument): MindMapDocument {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const nodeOrder = new Map(document.nodes.map((node, index) => [node.id, index]));
  const children = new Map<string, string[]>();
  for (const edge of document.edges) {
    const siblings = children.get(edge.from) ?? [];
    siblings.push(edge.to);
    children.set(edge.from, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));
  }

  const nodes: MindMapDocument["nodes"] = [];
  const edges: MindMapDocument["edges"] = [];
  const visit = (id: string): void => {
    nodes.push({ ...nodesById.get(id)! });
    for (const childId of children.get(id) ?? []) {
      edges.push({ from: id, to: childId });
      visit(childId);
    }
  };
  visit(document.rootId);

  return {
    schemaVersion: 1,
    id: document.id,
    title: document.title,
    rootId: document.rootId,
    nodes,
    edges,
    ...(document.crossLinks === undefined
      ? {}
      : {
          crossLinks: [...document.crossLinks].sort((left, right) =>
            left.id === right.id ? 0 : left.id < right.id ? -1 : 1),
        }),
  };
}
