import { canonicalJson } from "./canonical.js";
import { VisualWorkspaceError } from "./errors.js";
import type { DataViewDefinitionV1, ManagedDataViewSection } from "./data-view-types.js";
import { validateDataViewDefinition } from "./data-view-validation.js";

const START_PREFIX = "<!-- llmwiki:data-view:v1 ";
const START_SUFFIX = " -->";
const END_MARKER = "<!-- /llmwiki:data-view:v1 -->";

type SourceLine = {
  content: string;
  start: number;
  contentEnd: number;
  eol: "" | "\n" | "\r\n" | "\r";
};

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
        eol = source[index] as "\n" | "\r";
      }
    }
    lines.push({ content: source.slice(start, contentEnd), start, contentEnd, eol });
    start = index + 1;
  }
  return lines;
}

function parseHeader(line: string): { id: string; title: string; view: DataViewDefinitionV1["view"] } | null {
  if (!line.startsWith(START_PREFIX)) return null;
  if (!line.endsWith(START_SUFFIX)) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Data-view section header must end with a Markdown comment terminator");
  }
  let value: unknown;
  try {
    value = JSON.parse(line.slice(START_PREFIX.length, -START_SUFFIX.length));
  } catch {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Data-view section header metadata must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Data-view section header metadata must be an object");
  }
  const metadata = value as Record<string, unknown>;
  const keys = Object.keys(metadata);
  if (keys.some((key) => !["id", "title", "view"].includes(key)) || keys.length !== 3) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Data-view section header metadata has unknown or missing fields");
  }
  if (
    typeof metadata.id !== "string"
    || metadata.id.length === 0
    || typeof metadata.title !== "string"
    || metadata.title.length === 0
    || (metadata.view !== "table" && metadata.view !== "kanban")
  ) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Data-view section header metadata is invalid");
  }
  return { id: metadata.id, title: metadata.title, view: metadata.view };
}

function sectionEol(
  lines: readonly SourceLine[],
  headerIndex: number,
  closingMarkerIndex: number,
): ManagedDataViewSection["eol"] {
  return lines
    .slice(headerIndex, closingMarkerIndex + 1)
    .map((line) => line.eol)
    .find((candidate): candidate is "\n" | "\r\n" | "\r" => candidate !== "") ?? "\n";
}

export function parseManagedDataViewSection(source: string): ManagedDataViewSection {
  const lines = linesOf(source);
  const headerEntries = lines
    .map((line, index) => ({ header: parseHeader(line.content), index }))
    .filter((entry): entry is { header: { id: string; title: string; view: DataViewDefinitionV1["view"] }; index: number } => entry.header !== null);
  if (headerEntries.length !== 1) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", `Expected exactly one managed data-view section, found ${headerEntries.length}`);
  }

  const { header, index: headerIndex } = headerEntries[0]!;
  const closingMarkerIndexes = lines
    .map((line, index) => line.content === END_MARKER ? index : -1)
    .filter((index) => index > headerIndex);
  if (closingMarkerIndexes.length !== 1) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Managed data-view section must have exactly one closing marker");
  }
  const closingMarkerIndex = closingMarkerIndexes[0]!;
  if (lines.slice(0, headerIndex).some((line) => line.content === END_MARKER)) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Closing marker appears before the managed data-view section");
  }
  const body = lines.slice(headerIndex + 1, closingMarkerIndex).map((line) => line.content).join("\n").trim();
  if (body.length === 0) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Managed data-view section must contain a JSON definition body");
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Data-view section definition body must be valid JSON");
  }
  let definition: DataViewDefinitionV1;
  try {
    definition = validateDataViewDefinition(value);
  } catch (error) {
    throw new VisualWorkspaceError(
      "INVALID_MARKDOWN",
      error instanceof Error ? error.message : "Invalid data-view section definition",
    );
  }
  if (definition.id !== header.id || definition.title !== header.title || definition.view !== header.view) {
    throw new VisualWorkspaceError("INVALID_MARKDOWN", "Data-view header metadata must match the definition body");
  }

  const startOffset = lines[headerIndex]!.start;
  const endOffset = lines[closingMarkerIndex]!.contentEnd;
  return {
    definition,
    start: startOffset,
    end: endOffset,
    raw: source.slice(startOffset, endOffset),
    eol: sectionEol(lines, headerIndex, closingMarkerIndex),
  };
}

export function serializeManagedDataViewSection(
  definition: DataViewDefinitionV1,
  eol: ManagedDataViewSection["eol"] = "\n",
): string {
  const normalized = validateDataViewDefinition(definition);
  const header = canonicalJson({
    id: normalized.id,
    title: normalized.title,
    view: normalized.view,
  });
  const body = JSON.stringify(JSON.parse(canonicalJson(normalized)), null, 2).replace(/\n/gu, eol);
  return [
    `${START_PREFIX}${header}${START_SUFFIX}`,
    body,
    END_MARKER,
  ].join(eol);
}

export function replaceManagedDataViewSection(source: string, definition: DataViewDefinitionV1): string {
  const section = parseManagedDataViewSection(source);
  const normalized = validateDataViewDefinition(definition);
  if (normalized.id !== section.definition.id) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", "A managed data-view section cannot be replaced by another definition");
  }
  const replacement = serializeManagedDataViewSection(normalized, section.eol);
  return source.slice(0, section.start) + replacement + source.slice(section.end);
}
