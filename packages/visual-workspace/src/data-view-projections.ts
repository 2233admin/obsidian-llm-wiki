import { deepClone } from "./canonical.js";
import { VisualWorkspaceError } from "./errors.js";
import type { DataViewKind, DataViewQueryResult } from "./data-view-types.js";

export interface DataViewProjectionInput {
  result: DataViewQueryResult;
  view: DataViewKind;
}

export function projectDataView(input: DataViewProjectionInput): DataViewQueryResult["model"] {
  if (input.result.model.view !== input.view) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", "Data-view projection view must match the query result view");
  }
  return deepClone(input.result.model);
}
