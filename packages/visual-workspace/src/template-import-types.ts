import type {
  TemplateActionKind,
  TemplateComponentType,
  TemplateFormFieldV1,
  TemplateManifestV1,
} from "@obsidian-llm-wiki/agent-wiki-contracts";
import type { Sha256Digest } from "./types.js";

export type { TemplateActionKind, TemplateComponentType, TemplateManifestV1 };
export type TemplateSourceFormat = "components" | "markdown" | "json";

export interface TemplateArtifactSource {
  path: string;
  sha256: string;
}

export interface TemplateImportInput {
  source: TemplateArtifactSource;
  manifest: TemplateManifestV1;
}

export interface TemplateLayoutProfile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TemplateFormField {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "checkbox";
  property: string;
  options?: readonly string[];
  required?: boolean;
}

export interface TemplateActionDescriptor {
  kind: TemplateActionKind;
  target?: string;
  property?: string;
  value?: string | number | boolean | null;
  template?: string;
  commandId?: string;
}

export interface TemplateImportDiagnostic {
  kind: "unsupported" | "ambiguous" | "warning";
  code: string;
  message: string;
  componentId?: string;
  evidence?: readonly string[];
}

export interface TemplateImportComponent {
  id: string;
  kind: TemplateComponentType | "unsupported";
  status: "supported" | "unsupported";
  title?: string;
  children?: readonly string[];
  layoutProfiles?: {
    mobile?: TemplateLayoutProfile;
    laptop?: TemplateLayoutProfile;
  };
  form?: {
    fields: readonly TemplateFormField[];
  };
  actions: readonly TemplateActionDescriptor[];
}

export interface TemplateImportPreview {
  readOnly: true;
  source: TemplateArtifactSource;
  template: TemplateManifestV1["template"];
  manifestId: string;
  home: TemplateManifestV1["home"];
  components: readonly TemplateImportComponent[];
  diagnostics: readonly TemplateImportDiagnostic[];
  provenance: TemplateManifestV1["provenance"];
  fingerprint: Sha256Digest;
}
