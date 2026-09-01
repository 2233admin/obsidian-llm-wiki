import {
  validateTemplateManifestV1,
  type TemplateActionV1,
  type TemplateComponentV1,
  type TemplateFormFieldV1,
  type TemplateManifestV1,
} from "@obsidian-llm-wiki/agent-wiki-contracts";
import { canonicalDigest, deepFreeze } from "./canonical.js";
import { VisualWorkspaceError } from "./errors.js";
import type {
  TemplateActionDescriptor,
  TemplateFormField,
  TemplateImportComponent,
  TemplateImportDiagnostic,
  TemplateImportInput,
  TemplateImportPreview,
  TemplateLayoutProfile,
} from "./template-import-types.js";

const SAFE_PATH = /^(?!\/)(?![A-Za-z]:)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\u0000\\]+$/u;
const WINDOWS_PATH = /(?:^|[\s("'`])(?:[A-Za-z]:[\\/]|\\\\)/u;
const POSIX_PATH = /(?:^|[\s("'`])\/(?:Users|home|root|private|tmp|var|etc|opt)(?:\/|$)/u;
const SECRET = /(?:api[_-]?key|authorization|bearer\s+|password|secret|token|private[_-]?key|https?:\/\/[^\s/@]+:[^\s/@]+@)/iu;

function invalid(message: string): never {
  throw new VisualWorkspaceError("INVALID_CONTRACT", message);
}

function path(value: string, context: string): string {
  if (!SAFE_PATH.test(value) || /[\r\n]/u.test(value)) invalid(`${context} must be vault-relative`);
  return value;
}

function safeText(value: string, context: string): string {
  if (value.length === 0 || value.length > 512 || /[\r\n]/u.test(value)) invalid(`${context} must be bounded single-line text`);
  if (WINDOWS_PATH.test(value) || POSIX_PATH.test(value) || SECRET.test(value)) invalid(`${context} contains unsafe material`);
  return value;
}

function safeStrings(value: unknown, context = "manifest"): void {
  if (typeof value === "string") {
    if (WINDOWS_PATH.test(value) || POSIX_PATH.test(value) || SECRET.test(value)) invalid(`${context} contains unsafe material`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => safeStrings(item, `${context}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) safeStrings(item, `${context}.${key}`);
  }
}

function layoutProfile(value: { x: number; y: number; w: number; h: number }): TemplateLayoutProfile {
  return { x: value.x, y: value.y, w: value.w, h: value.h };
}

function formField(value: TemplateFormFieldV1): TemplateFormField {
  return {
    id: safeText(value.id, "form field id"),
    label: safeText(value.label, "form field label"),
    type: value.type,
    property: safeText(value.property, "form field property"),
    ...(value.options === undefined ? {} : { options: [...value.options] }),
  };
}

function action(value: TemplateActionV1, componentId: string): TemplateActionDescriptor {
  if (value.kind === "create-file") {
    const target = path(`${value.targetFolder}/${value.fileName}`, `${componentId}.create-file target`);
    return { kind: value.kind, target, template: path(value.templatePath, `${componentId}.create-file template`) };
  }
  if (value.kind === "update-property") {
    return { kind: value.kind, property: safeText(value.property, `${componentId}.update-property property`), value: value.value };
  }
  if (value.kind === "open-file") return { kind: value.kind, target: path(value.path, `${componentId}.open-file path`) };
  return { kind: value.kind, commandId: safeText(value.commandId, `${componentId}.call-command commandId`) };
}

function component(value: TemplateComponentV1): TemplateImportComponent {
  const result: TemplateImportComponent = {
    id: safeText(value.id, "component id"),
    kind: value.type,
    status: "supported",
    actions: value.actions?.map((item) => action(item, value.id)) ?? [],
  };
  if (value.title !== undefined) result.title = safeText(value.title, `${value.id}.title`);
  if (value.children !== undefined) result.children = value.children.map((child) => safeText(child, `${value.id}.children`));
  if (value.layout !== undefined) {
    result.layoutProfiles = {
      ...(value.layout.mobile === undefined ? {} : { mobile: layoutProfile(value.layout.mobile) }),
      ...(value.layout.laptop === undefined ? {} : { laptop: layoutProfile(value.layout.laptop) }),
    };
  }
  if (value.fields !== undefined) result.form = { fields: value.fields.map(formField) };
  return result;
}

function diagnostics(value: TemplateManifestV1["diagnostics"]): TemplateImportDiagnostic[] {
  return value.map((item) => ({
    kind: item.kind,
    code: safeText(item.code, "diagnostic code"),
    message: safeText(item.message, "diagnostic message"),
    ...(item.componentId === undefined ? {} : { componentId: safeText(item.componentId, "diagnostic component id") }),
    ...(item.evidence === undefined ? {} : { evidence: item.evidence.map((entry) => safeText(entry, "diagnostic evidence")) }),
  }));
}

export function createTemplateImportPreview(input: TemplateImportInput): Readonly<TemplateImportPreview> {
  const manifest = validateTemplateManifestV1(input.manifest);
  safeStrings(manifest);
  const sourcePath = path(input.source.path, "source.path");
  if (manifest.source.path !== sourcePath || manifest.source.sha256 !== input.source.sha256) {
    invalid("import source does not match manifest source lock");
  }
  const components = manifest.components.map(component);
  const previewPayload = {
    readOnly: true as const,
    source: { path: sourcePath, sha256: input.source.sha256 },
    template: manifest.template,
    manifestId: manifest.manifestId,
    home: manifest.home,
    components,
    diagnostics: diagnostics(manifest.diagnostics),
    provenance: manifest.provenance,
  };
  return deepFreeze({ ...previewPayload, fingerprint: canonicalDigest(previewPayload) });
}
