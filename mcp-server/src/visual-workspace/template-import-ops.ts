import type { Operation } from "../core/types.js";
import { createTemplateImportPreview, type TemplateImportPreview } from "@obsidian-llm-wiki/visual-workspace";
import { readTemplateManifestJson } from "./template-import-reader.js";

export function makeTemplateImportOps(): Operation[] {
  return [{
    name: "visual.template.preview",
    namespace: "visual",
    description: "Preview a static TemplateManifest upload envelope without executing code or writing the vault. content must be JSON {manifest, artifactContent}; the artifact digest is verified.",
    mutating: false,
    closedParams: true,
    params: {
      path: { type: "string", required: true, description: "Vault-relative artifact path" },
      content: { type: "string", required: true, description: "JSON upload envelope containing manifest and artifactContent" },
    },
    handler: async (_ctx, params) => readOnlyPreview(params),
  }];
}
function readOnlyPreview(params: Record<string, unknown>): Readonly<TemplateImportPreview> {
  if (typeof params.path !== "string" || typeof params.content !== "string") {
    throw new TypeError("path and content are required");
  }
  return createTemplateImportPreview(readTemplateManifestJson(params.path, params.content));
}
