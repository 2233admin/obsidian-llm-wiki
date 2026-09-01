import type { SourceRange, Sha256Digest } from "./types.js";

export type DataViewKind = "table" | "kanban";
export type DataViewScalar = string | number | boolean | null;

export interface DataViewDefinitionV1 {
  schemaVersion: 1;
  id: string;
  title: string;
  view: DataViewKind;
  source: {
    kind: "file" | "folder" | "files";
    path?: string;
    paths?: string[];
  };
  select: Array<{ field: string; label: string }>;
  where?: DataViewPredicateV1;
  groupBy?: string;
  groupOrder?: string[];
  orderBy?: Array<{ field: string; direction: "asc" | "desc" }>;
}

export type DataViewPredicateV1 =
  | { kind: "and" | "or"; predicates: DataViewPredicateV1[] }
  | {
      kind: "field";
      field: string;
      operator: "equals" | "in" | "exists" | "contains";
      value?: DataViewScalar | DataViewScalar[];
    };

export interface DataViewSourceBlock {
  path: string;
  sha256: Sha256Digest;
  title: string;
  frontmatter: Record<string, unknown>;
  blocks: readonly DataViewSourceBlockEntry[];
}

export interface DataViewSourceBlockEntry {
  id?: string;
  text: string;
  range: SourceRange;
}

export interface ManagedDataViewSection {
  definition: DataViewDefinitionV1;
  start: number;
  end: number;
  raw: string;
  eol: "\n" | "\r\n" | "\r";
}

export interface DataViewQueryInput {
  definition: DataViewDefinitionV1;
  sources: readonly DataViewSourceBlock[];
}

export interface DataViewQueryResult {
  model: {
    schemaVersion: 1;
    queryId: string;
    view: DataViewKind;
    columns: Array<{ field: string; label: string }>;
    rows: Array<{
      id: string;
      source: { path: string; blockId?: string };
      values: Record<string, DataViewValueV1>;
    }>;
    groups: Array<{ id: string; label: string; rowIds: string[] }>;
    diagnostics: Array<{
      code: string;
      severity: "info" | "warning" | "error";
      message: string;
      sourcePath?: string;
      field?: string;
    }>;
  };
  sourceLocks: Record<string, Sha256Digest>;
  fingerprint: Sha256Digest;
}

export interface DataViewValueV1 {
  state: "known" | "unknown";
  value?: DataViewScalar | DataViewScalar[];
  source: { path: string; field?: string; start?: number; end?: number; blockId?: string };
}

export interface DataViewActionRequestV1 {
  schemaVersion: 1;
  kind: "edit-property" | "move-card";
  queryId: string;
  sourcePath: string;
  field: string;
  value: DataViewScalar | DataViewScalar[];
  actor: string;
}

export interface DataViewEditPlan {
  schemaVersion: 1;
  source: {
    path: string;
    sha256: Sha256Digest;
  };
  preview: {
    before: {
      sourceMarkdown: string;
      sourceSha256: Sha256Digest;
    };
    after: {
      sourceMarkdown: string;
      sourceSha256: Sha256Digest;
    };
  };
  provenance: {
    actor: string;
    origin: "user" | "assistant" | "import";
    queryId: string;
    view: DataViewKind;
    actionKind: DataViewActionRequestV1["kind"];
    sourcePath: string;
    field: string;
    range: { start: number; end: number };
    groupBy?: string;
  };
  affectedPaths: string[];
  warnings: string[];
  fingerprint: Sha256Digest;
}

export interface DataViewPlanInput {
  definition: DataViewDefinitionV1;
  result: DataViewQueryResult;
  action: DataViewActionRequestV1;
  sourceMarkdown: string;
}

export interface DataViewApplyRequest {
  plan: DataViewEditPlan;
  presentedFingerprint: Sha256Digest;
  actor: string;
  transitionToken: string;
}

export interface ApplyDataViewEditPlanResult {
  path: string;
  source: string;
  sourceSha256: Sha256Digest;
  planFingerprint: Sha256Digest;
  actor: string;
  transitionToken: string;
  replayed: boolean;
}
