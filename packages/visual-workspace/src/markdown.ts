import { canonicalJson, canonicalMindMapDocument } from "./canonical.js";
import { VisualWorkspaceError } from "./errors.js";
import type { ManagedMindMapSection, MindMapCrossLink, MindMapDocument } from "./types.js";
import {
  assertExactFields,
  isObsidianBlockId,
  parseMindMapCrossLink,
  parseMindMapDocument,
} from "./validation.js";

const START_PREFIX = "<!-- llmwiki:mind-map:v1 ";
const START_SUFFIX = " -->";
const END_MARKER = "<!-- /llmwiki:mind-map:v1 -->";
const CROSS_LINK_PREFIX = "<!-- llmwiki:cross-link:v1 ";
const CROSS_LINK_SUFFIX = " -->";
const LIST_ITEM = /^( *)(- )("(?:[^"\\]|\\.)*") \^([A-Za-z0-9][A-Za-z0-9-]{0,127})$/;

interface SourceLine {
  content: string;
  start: number;
  contentEnd: number;
  eol: "" | "\n" | "\r\n" | "\r";
}

function linesOf(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (let index = 0; index <= source.length; index += 1) {
    if (index < source.length && source[index] !== "\r" && source[index] !== "\n") continue;
    const contentEnd = index;
    let eol: SourceLine["eol"] = "";
    if (index < source.length) {
      if (source[index] === "\r" && source[index + 1] === "\n") {
        eol = "\r\n";
        index += 1;
      } else {
        eol = source[index] as "\r" | "\n";
      }
    }
    lines.push({ content: source.slice(start, contentEnd), start, contentEnd, eol });
    start = index + 1;
  }
  return lines;
}

function parseHeader(line: string): { id: string; title: string } | null {
  if (!line.startsWith(START_PREFIX) || !line.endsWith(START_SUFFIX)) return null;
  let metadata: unknown;
  try {
    metadata = JSON.parse(line.slice(START_PREFIX.length, -START_SUFFIX.length));
  } catch {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Mind-map section metadata must be valid JSON");
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Mind-map section metadata must be an object");
  }
  const candidate = metadata as Record<string, unknown>;
  try {
    assertExactFields(candidate, ["id", "title"], "Mind-map section metadata");
  } catch (error) {
    throw new VisualWorkspaceError(
      "INVALID_MARKDOWN",
      error instanceof Error ? error.message : "Invalid mind-map section metadata",
    );
  }
  if (typeof candidate.id !== "string" || !isObsidianBlockId(candidate.id)) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Mind-map section ID must be an Obsidian-compatible block ID");
  }
  if (typeof candidate.title !== "string" || candidate.title.length === 0 || /[\r\n]/.test(candidate.title)) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Mind-map section title must be a non-empty single line");
  }
  return { id: candidate.id, title: candidate.title };
}

function parseCrossLink(line: string, lineNumber: number): MindMapCrossLink | null {
  if (!line.startsWith(CROSS_LINK_PREFIX) || !line.endsWith(CROSS_LINK_SUFFIX)) return null;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(CROSS_LINK_PREFIX.length, -CROSS_LINK_SUFFIX.length));
    return parseMindMapCrossLink(value, `Cross-link on line ${lineNumber}`);
  } catch (error) {
    throw new VisualWorkspaceError(
      "INVALID_MARKDOWN",
      error instanceof Error ? error.message : `Invalid cross-link on line ${lineNumber}`,
    );
  }
}

export function parseManagedMindMapSection(source: string): ManagedMindMapSection {
  const lines = linesOf(source);
  const starts = lines
    .map((line, index) => ({ header: parseHeader(line.content), index }))
    .filter((entry): entry is { header: { id: string; title: string }; index: number } => entry.header !== null);
  if (starts.length !== 1) {
    throw new VisualWorkspaceError(
      "INVALID_MARKDOWN",
      `Expected exactly one managed mind-map section, found ${starts.length}`,
    );
  }
  const start = starts[0]!;
  const endIndexes = lines
    .map((line, index) => line.content === END_MARKER ? index : -1)
    .filter((index) => index > start.index);
  if (endIndexes.length !== 1) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Managed mind-map section must have exactly one closing marker");
  }
  const endIndex = endIndexes[0]!;
  if (lines.slice(0, start.index).some((line) => line.content === END_MARKER)) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Closing marker appears before the managed section");
  }

  const nodes: MindMapDocument["nodes"] = [];
  const edges: MindMapDocument["edges"] = [];
  const crossLinks: MindMapCrossLink[] = [];
  const parents: string[] = [];
  for (let index = start.index + 1; index < endIndex; index += 1) {
    const line = lines[index]!;
    const crossLink = parseCrossLink(line.content, index + 1);
    if (crossLink) {
      crossLinks.push(crossLink);
      continue;
    }
    const match = LIST_ITEM.exec(line.content);
    if (!match) {
      throw new VisualWorkspaceError("INVALID_MARKDOWN", `Invalid canonical mind-map list item on line ${index + 1}`);
    }
    const indent = match[1]!.length;
    if (indent % 2 !== 0) {
      throw new VisualWorkspaceError("INVALID_MARKDOWN", `Mind-map indentation must use two spaces on line ${index + 1}`);
    }
    const depth = indent / 2;
    if (nodes.length === 0 && depth !== 0) {
      throw new VisualWorkspaceError("INVALID_MARKDOWN", "The first mind-map node must be the root");
    }
    if (nodes.length > 0 && (depth === 0 || depth > parents.length)) {
      throw new VisualWorkspaceError("INVALID_MARKDOWN", `Invalid mind-map nesting on line ${index + 1}`);
    }
    let label: unknown;
    try {
      label = JSON.parse(match[3]!);
    } catch {
      throw new VisualWorkspaceError("INVALID_MARKDOWN", `Invalid JSON label on line ${index + 1}`);
    }
    if (typeof label !== "string" || label.length === 0 || /[\r\n]/.test(label)) {
      throw new VisualWorkspaceError("INVALID_MARKDOWN", `Mind-map labels must be non-empty single-line strings`);
    }
    const id = match[4]!;
    nodes.push({ id, label });
    if (depth > 0) {
      const parentId = parents[depth - 1];
      if (!parentId) throw new VisualWorkspaceError("INVALID_MARKDOWN", `Missing parent on line ${index + 1}`);
      edges.push({ from: parentId, to: id });
    }
    parents[depth] = id;
    parents.length = depth + 1;
  }
  if (nodes.length === 0) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Managed mind-map section must contain a root node");
  }

  let document: MindMapDocument;
  try {
    document = parseMindMapDocument({
      schemaVersion: 1,
      id: start.header.id,
      title: start.header.title,
      rootId: nodes[0]!.id,
      nodes,
      edges,
      ...(crossLinks.length === 0 ? {} : { crossLinks }),
    });
  } catch (error) {
    throw new VisualWorkspaceError(
      "INVALID_MARKDOWN",
      error instanceof Error ? error.message : "Invalid managed mind-map graph",
    );
  }
  const startOffset = lines[start.index]!.start;
  const endOffset = lines[endIndex]!.contentEnd;
  const eol = lines
    .slice(start.index, endIndex + 1)
    .map((line) => line.eol)
    .find((candidate): candidate is "\n" | "\r\n" | "\r" => candidate !== "") ?? "\n";
  return {
    document,
    start: startOffset,
    end: endOffset,
    raw: source.slice(startOffset, endOffset),
    eol,
  };
}

export function serializeManagedMindMapSection(
  value: unknown,
  options: { eol?: "\n" | "\r\n" | "\r" } = {},
): string {
  const document = canonicalMindMapDocument(parseMindMapDocument(value));
  const eol = options.eol ?? "\n";
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const edge of document.edges) {
    const siblings = children.get(edge.from) ?? [];
    siblings.push(edge.to);
    children.set(edge.from, siblings);
  }
  const lines = [
    `${START_PREFIX}${canonicalJson({ id: document.id, title: document.title })}${START_SUFFIX}`,
  ];
  const visit = (id: string, depth: number): void => {
    const node = nodeById.get(id)!;
    lines.push(`${"  ".repeat(depth)}- ${JSON.stringify(node.label)} ^${node.id}`);
    for (const childId of children.get(id) ?? []) visit(childId, depth + 1);
  };
  visit(document.rootId, 0);
  for (const crossLink of document.crossLinks ?? []) {
    lines.push(`${CROSS_LINK_PREFIX}${canonicalJson(crossLink)}${CROSS_LINK_SUFFIX}`);
  }
  lines.push(END_MARKER);
  return lines.join(eol);
}

export function replaceManagedMindMapSection(source: string, value: unknown): string {
  const section = parseManagedMindMapSection(source);
  const document = parseMindMapDocument(value);
  if (document.id !== section.document.id) {
    throw new VisualWorkspaceError("MAP_ID_MISMATCH", "A managed mind-map section cannot be replaced by another map");
  }
  const replacement = serializeManagedMindMapSection(document, { eol: section.eol });
  return source.slice(0, section.start) + replacement + source.slice(section.end);
}
