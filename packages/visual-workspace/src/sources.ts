import { canonicalDigest, sha256Text } from "./canonical.js";
import { VisualWorkspaceError } from "./errors.js";
import { parseManagedMindMapSection } from "./markdown.js";
import type {
  AdoptionChoices,
  MindMapDocument,
  MindMapNode,
  VisualAdoptionCandidate,
  VisualSourceDiagnostic,
  VisualSourceReadResult,
  VisualSourceReference,
} from "./types.js";
import { isObsidianBlockId, parseMindMapDocument, parseVaultRelativePath } from "./validation.js";

interface ParsedSourceNode {
  node: MindMapNode;
  level: number;
  reference: VisualSourceReference;
}

interface CanvasNode {
  id: string;
  type: string;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
  [key: string]: unknown;
}

interface CanvasEdge {
  id?: string;
  fromNode: string;
  toNode: string;
  fromEnd?: string;
  toEnd?: string;
  label?: string;
  [key: string]: unknown;
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", `${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stableId(prefix: string, identity: string): string {
  return `${prefix}-${sha256Text(identity).slice("sha256:".length, "sha256:".length + 20)}`;
}

function lineRanges(source: string): Array<{ text: string; start: number; end: number; line: number }> {
  const lines: Array<{ text: string; start: number; end: number; line: number }> = [];
  const expression = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  let line = 1;
  while ((match = expression.exec(source)) !== null) {
    if (match[0] === "" && match.index === source.length) break;
    const raw = match[0];
    const text = raw.replace(/\r\n$|\r$|\n$/, "");
    lines.push({ text, start: match.index, end: match.index + text.length, line });
    line += 1;
  }
  return lines;
}

function extractWikilinks(label: string): string[] {
  const links: string[] = [];
  const expression = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(label)) !== null) {
    const target = match[1]!.split("|", 1)[0]!;
    if (target && !links.includes(target)) links.push(target);
  }
  return links;
}

function stripBlockId(value: string): { label: string; blockId?: string } {
  const match = /^(.*?)(?:\s+\^([A-Za-z0-9][A-Za-z0-9-]{0,127}))\s*$/.exec(value);
  if (!match) return { label: value.trim() };
  return { label: match[1]!.trim(), blockId: match[2]! };
}

function candidateFromParsedNodes(input: {
  sourceKind: "markdown" | "canvas";
  sourcePath: string;
  source: string;
  title: string;
  parsed: ParsedSourceNode[];
  relations: VisualAdoptionCandidate["relations"];
  diagnostics: VisualSourceDiagnostic[];
}): VisualAdoptionCandidate {
  const incoming = new Map<string, string[]>();
  for (const relation of input.relations) {
    const parents = incoming.get(relation.to) ?? [];
    if (!parents.includes(relation.from)) parents.push(relation.from);
    incoming.set(relation.to, parents);
  }
  const candidateRootIds = input.parsed
    .map(({ node }) => node.id)
    .filter((id) => (incoming.get(id) ?? []).length === 0);
  if (candidateRootIds.length !== 1) {
    input.diagnostics.push({
      code: "AMBIGUOUS_ROOT",
      severity: "warning",
      message: `Source has ${candidateRootIds.length} structural roots; adoption requires an explicit root choice.`,
      subjectIds: candidateRootIds.length > 0 ? candidateRootIds : input.parsed.map(({ node }) => node.id),
    });
  }
  const parentChoices = Object.fromEntries(
    input.parsed
      .map(({ node }) => [node.id, [...(incoming.get(node.id) ?? [])].sort()] as const)
      .filter(([, parents]) => parents.length > 0),
  );
  for (const [nodeId, parents] of Object.entries(parentChoices)) {
    if (parents.length > 1) {
      input.diagnostics.push({
        code: "AMBIGUOUS_PARENT",
        severity: "warning",
        message: `Node ${nodeId} has ${parents.length} possible parents.`,
        subjectIds: [nodeId, ...parents],
      });
    }
  }
  return {
    schemaVersion: 1,
    sourceKind: input.sourceKind,
    sourcePath: input.sourcePath,
    sourceSha256: sha256Text(input.source),
    title: input.title,
    nodes: input.parsed.map(({ node }) => node),
    relations: [...input.relations].sort((left, right) =>
      left.id === right.id ? 0 : left.id < right.id ? -1 : 1),
    candidateRootIds,
    parentChoices,
    sourceReferences: Object.fromEntries(input.parsed.map(({ node, reference }) => [node.id, reference])),
    diagnostics: input.diagnostics,
  };
}

export function readMarkdownMindMapSource(source: string, sourcePath: string): VisualSourceReadResult {
  const path = parseVaultRelativePath(sourcePath, "sourcePath");
  const sourceSha256 = sha256Text(source);
  try {
    const managed = parseManagedMindMapSection(source);
    const sourceReferences = Object.fromEntries(
      managed.document.nodes.map((node) => [
        node.id,
        { path, blockId: node.id } satisfies VisualSourceReference,
      ]),
    );
    return {
      schemaVersion: 1,
      sourceKind: "managed_markdown",
      sourcePath: path,
      sourceSha256,
      document: managed.document,
      sourceReferences,
      diagnostics: [],
    };
  } catch (error) {
    if (
      !(error instanceof VisualWorkspaceError)
      || error.code !== "INVALID_MARKDOWN"
      || !/Expected exactly one managed mind-map section, found 0/.test(error.message)
    ) {
      throw error;
    }
  }

  const diagnostics: VisualSourceDiagnostic[] = [];
  const parsed: ParsedSourceNode[] = [];
  const relations: VisualAdoptionCandidate["relations"] = [];
  const parentStack: Array<{ id: string; level: number }> = [];
  const seenIds = new Set<string>();
  let currentHeadingLevel = 0;
  let title = path.split("/").at(-1)?.replace(/\.md$/i, "") || "Imported map";

  for (const line of lineRanges(source)) {
    const heading = /^(#{1,6})[ \t]+(.+?)\s*$/.exec(line.text);
    const listItem = /^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+(.+?)\s*$/.exec(line.text);
    if (!heading && !listItem) continue;
    const rawLabel = heading ? heading[2]! : listItem![2]!;
    const { label, blockId } = stripBlockId(rawLabel);
    if (!label) continue;
    const level = heading
      ? heading[1]!.length - 1
      : currentHeadingLevel + 1 + Math.floor(listItem![1]!.replace(/\t/g, "  ").length / 2);
    if (heading) {
      currentHeadingLevel = heading[1]!.length - 1;
      if (heading[1]!.length === 1 && parsed.length === 0) title = label;
    }
    let id = blockId ?? stableId("md", `${path}\0${line.start}\0${label}`);
    if (!blockId) {
      diagnostics.push({
        code: "INFERRED_ID",
        severity: "info",
        message: `Node on line ${line.line} has no block ID; adoption will assign ${id}.`,
        subjectIds: [id],
      });
    }
    if (seenIds.has(id)) {
      const original = id;
      id = stableId("md", `${path}\0${line.start}\0${label}\0duplicate`);
      diagnostics.push({
        code: "DUPLICATE_ID",
        severity: "error",
        message: `Duplicate source block ID ${original} requires review before adoption.`,
        subjectIds: [original, id],
      });
    }
    seenIds.add(id);
    const wikilinks = extractWikilinks(label);
    const reference: VisualSourceReference = {
      path,
      range: { start: line.start, end: line.end, startLine: line.line, endLine: line.line },
      ...(blockId ? { blockId } : {}),
      ...(wikilinks.length > 0 ? { wikilinks } : {}),
    };
    const node = { id, label };
    while (parentStack.length > 0 && parentStack.at(-1)!.level >= level) parentStack.pop();
    const parent = parentStack.at(-1);
    if (parent) {
      relations.push({
        id: stableId("relation", `${parent.id}\0${id}\0contains`),
        from: parent.id,
        to: id,
        relation: "contains",
      });
    }
    parsed.push({ node, level, reference });
    parentStack.push({ id, level });
  }

  if (parsed.length === 0) {
    diagnostics.push({
      code: source.trim() ? "UNSUPPORTED_MARKDOWN" : "EMPTY_SOURCE",
      severity: "error",
      message: source.trim()
        ? "No headings or nested list items were found."
        : "The Markdown source is empty.",
      subjectIds: [],
    });
  }
  const adoptionCandidate = candidateFromParsedNodes({
    sourceKind: "markdown",
    sourcePath: path,
    source,
    title,
    parsed,
    relations,
    diagnostics,
  });
  return {
    schemaVersion: 1,
    sourceKind: "markdown",
    sourcePath: path,
    sourceSha256,
    adoptionCandidate,
    sourceReferences: adoptionCandidate.sourceReferences,
    diagnostics,
  };
}

function canvasNodeLabel(node: CanvasNode): string | null {
  if (node.type === "text" && typeof node.text === "string" && node.text.trim()) return node.text.trim();
  if (node.type === "file" && typeof node.file === "string" && node.file.trim()) return `[[${node.file.trim()}]]`;
  if (node.type === "link" && typeof node.url === "string" && node.url.trim()) return node.url.trim();
  if (node.type === "group" && typeof node.label === "string" && node.label.trim()) return node.label.trim();
  return null;
}

export function readObsidianCanvasSource(source: string, sourcePath: string): VisualSourceReadResult {
  const path = parseVaultRelativePath(sourcePath, "sourcePath");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(source);
  } catch {
    throw new VisualWorkspaceError("INVALID_CONTRACT", "Canvas source must be valid JSON");
  }
  const canvas = record(parsedJson, "Canvas");
  if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", "Canvas must contain nodes and edges arrays");
  }
  const diagnostics: VisualSourceDiagnostic[] = [];
  for (const field of Object.keys(canvas).filter((field) => field !== "nodes" && field !== "edges")) {
    diagnostics.push({
      code: "UNSUPPORTED_CANVAS_FIELD",
      severity: "warning",
      message: `Canvas field ${field} is outside the supported adoption subset.`,
      subjectIds: [],
    });
  }
  const parsedNodes: ParsedSourceNode[] = [];
  const canvasToMap = new Map<string, string>();
  const seenCanvasIds = new Set<string>();
  const seenMapIds = new Set<string>();
  const allowedNodeFields = new Set([
    "id", "type", "x", "y", "width", "height", "text", "file", "subpath", "url", "label", "color",
  ]);
  for (const [index, value] of canvas.nodes.entries()) {
    const node = record(value, `Canvas.nodes[${index}]`) as CanvasNode;
    if (typeof node.id !== "string" || typeof node.type !== "string") {
      throw new VisualWorkspaceError("INVALID_CONTRACT", `Canvas.nodes[${index}] requires string id and type`);
    }
    const label = canvasNodeLabel(node);
    if (!label) {
      diagnostics.push({
        code: "UNSUPPORTED_CANVAS_NODE",
        severity: "warning",
        message: `Canvas node ${node.id} has an unsupported type or empty label.`,
        subjectIds: [node.id],
      });
      continue;
    }
    for (const field of Object.keys(node).filter((field) => !allowedNodeFields.has(field))) {
      diagnostics.push({
        code: "UNSUPPORTED_CANVAS_FIELD",
        severity: "warning",
        message: `Canvas node ${node.id} field ${field} is outside the supported adoption subset.`,
        subjectIds: [node.id],
      });
    }
    let id = isObsidianBlockId(node.id) ? node.id : stableId("canvas", `${path}\0${node.id}`);
    if (seenCanvasIds.has(node.id) || seenMapIds.has(id)) {
      const original = id;
      id = stableId("canvas", `${path}\0${node.id}\0${index}`);
      diagnostics.push({
        code: "DUPLICATE_ID",
        severity: "error",
        message: `Duplicate Canvas node identity ${original} requires review before adoption.`,
        subjectIds: [original, id],
      });
    }
    seenCanvasIds.add(node.id);
    seenMapIds.add(id);
    canvasToMap.set(node.id, id);
    parsedNodes.push({
      node: { id, label },
      level: 0,
      reference: {
        path,
        canvasNodeId: node.id,
        ...(node.type === "file" && typeof node.file === "string" ? { wikilinks: [node.file] } : {}),
      },
    });
  }

  const relations: VisualAdoptionCandidate["relations"] = [];
  const allowedEdgeFields = new Set([
    "id", "fromNode", "fromSide", "fromEnd", "toNode", "toSide", "toEnd", "color", "label",
  ]);
  for (const [index, value] of canvas.edges.entries()) {
    const edge = record(value, `Canvas.edges[${index}]`) as CanvasEdge;
    if (typeof edge.fromNode !== "string" || typeof edge.toNode !== "string") {
      throw new VisualWorkspaceError("INVALID_CONTRACT", `Canvas.edges[${index}] requires fromNode and toNode`);
    }
    for (const field of Object.keys(edge).filter((candidate) => !allowedEdgeFields.has(candidate))) {
      diagnostics.push({
        code: "UNSUPPORTED_CANVAS_FIELD",
        severity: "warning",
        message: `Canvas edge ${edge.id ?? index} field ${field} is outside the supported adoption subset.`,
        subjectIds: edge.id ? [edge.id] : [],
      });
    }
    let from = canvasToMap.get(edge.fromNode);
    let to = canvasToMap.get(edge.toNode);
    if (!from || !to) continue;
    if (edge.fromEnd === "arrow" && edge.toEnd !== "arrow") [from, to] = [to, from];
    if (edge.fromEnd !== "arrow" && edge.toEnd !== "arrow") {
      diagnostics.push({
        code: "UNDIRECTED_CANVAS_EDGE",
        severity: "warning",
        message: `Canvas edge ${edge.id ?? index} has no arrow; its stored from/to direction requires confirmation.`,
        subjectIds: [from, to],
      });
    }
    const relation = typeof edge.label === "string" && edge.label.trim() ? edge.label.trim() : "contains";
    relations.push({
      id: edge.id && isObsidianBlockId(edge.id)
        ? edge.id
        : stableId("canvas-edge", `${path}\0${edge.id ?? index}\0${from}\0${to}`),
      from,
      to,
      relation,
    });
  }
  const title = path.split("/").at(-1)?.replace(/\.canvas$/i, "") || "Imported canvas";
  const adoptionCandidate = candidateFromParsedNodes({
    sourceKind: "canvas",
    sourcePath: path,
    source,
    title,
    parsed: parsedNodes,
    relations,
    diagnostics,
  });
  return {
    schemaVersion: 1,
    sourceKind: "canvas",
    sourcePath: path,
    sourceSha256: sha256Text(source),
    adoptionCandidate,
    sourceReferences: adoptionCandidate.sourceReferences,
    diagnostics,
  };
}

export function adoptVisualSourceCandidate(
  candidate: VisualAdoptionCandidate,
  choices: AdoptionChoices,
): MindMapDocument {
  if (candidate.schemaVersion !== 1) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", "VisualAdoptionCandidate.schemaVersion must be 1");
  }
  const nodeIds = new Set(candidate.nodes.map((node) => node.id));
  if (!nodeIds.has(choices.rootId)) {
    throw new VisualWorkspaceError("INVALID_GRAPH", "The selected adoption root does not exist");
  }
  const allowed = new Set(candidate.relations.map((relation) => `${relation.from}\0${relation.to}`));
  const edges = candidate.nodes
    .filter((node) => node.id !== choices.rootId)
    .map((node) => {
      const parent = choices.parentByNode[node.id];
      if (!parent || !allowed.has(`${parent}\0${node.id}`)) {
        throw new VisualWorkspaceError(
          "INVALID_GRAPH",
          `Adoption requires an explicit supported parent for ${node.id}`,
        );
      }
      return { from: parent, to: node.id };
    });
  const selected = new Set(edges.map((edge) => `${edge.from}\0${edge.to}`));
  const crossLinks = candidate.relations
    .filter((relation) => !selected.has(`${relation.from}\0${relation.to}`))
    .map((relation) => ({
      id: relation.id,
      from: relation.from,
      to: relation.to,
      relation: relation.relation,
      provenance: { kind: "explicit" as const },
    }));
  return parseMindMapDocument({
    schemaVersion: 1,
    id: stableId(candidate.sourceKind === "canvas" ? "canvas-map" : "markdown-map", candidate.sourcePath),
    title: candidate.title,
    rootId: choices.rootId,
    nodes: candidate.nodes,
    edges,
    ...(crossLinks.length > 0 ? { crossLinks } : {}),
  });
}

export function adoptionCandidateFingerprint(candidate: VisualAdoptionCandidate): `sha256:${string}` {
  return canonicalDigest(candidate);
}
