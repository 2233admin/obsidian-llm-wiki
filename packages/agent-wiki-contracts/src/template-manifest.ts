import { createHash } from "node:crypto";

export type TemplateComponentType = "multi" | "data-view" | "form" | "card" | "count" | "markdown" | "time";
export type TemplateActionKind = "create-file" | "update-property" | "open-file" | "call-command";

export interface TemplateLayoutV1 { x: number; y: number; w: number; h: number; }
export interface TemplateFormFieldV1 {
  id: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "checkbox";
  property: string;
  options?: string[];
}
export type TemplateActionV1 =
  | { kind: "create-file"; templatePath: string; targetFolder: string; fileName: string }
  | { kind: "update-property"; property: string; value: string | number | boolean | null }
  | { kind: "open-file"; path: string }
  | { kind: "call-command"; commandId: string };
export interface TemplateComponentV1 {
  id: string;
  type: TemplateComponentType;
  title?: string;
  layout?: { mobile?: TemplateLayoutV1; laptop?: TemplateLayoutV1 };
  children?: string[];
  fields?: TemplateFormFieldV1[];
  actions?: TemplateActionV1[];
}
export interface TemplateDiagnosticV1 {
  kind: "unsupported" | "ambiguous" | "warning";
  code: string;
  message: string;
  componentId?: string;
  evidence?: string[];
}
export interface TemplateManifestV1 {
  schemaVersion: 1;
  manifestId: string;
  source: { path: string; sha256: string };
  template: { path: string; sha256: string };
  home: { path: string; dashboard: { layout: "grid" | "tabs" | "stack"; componentIds: string[] } };
  components: TemplateComponentV1[];
  diagnostics: TemplateDiagnosticV1[];
  provenance: { origin: "external-observation" | "native-export" | "user-authored"; sourceUrl?: string; release?: string };
  fingerprint: string;
}

const PATH = /^(?!\/)(?![A-Za-z]:)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\u0000\\]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^.{1,512}$/u;
const ACTIONS = new Set<TemplateActionKind>(["create-file", "update-property", "open-file", "call-command"]);
const SECRET = /(?:api[_-]?key|client[_-]?secret|password|authorization|bearer\s|access[_-]?token|refresh[_-]?token|secret[_-]?key|token\s*[=:]|https?:\/\/[^/\s:@]+:[^/\s@]+@)/iu;

function fail(message: string): never { throw new TypeError(message); }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} has unknown field ${key}`);
  for (const key of required) if (!(key in value)) fail(`${label} is missing ${key}`);
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  if (SECRET.test(value)) fail(`${label} contains secret-bearing text`);
  return value;
}
function identifier(value: unknown, label: string): string {
  const result = text(value, label);
  if (!IDENTIFIER.test(result)) fail(`${label} must be a valid identifier`);
  return result;
}
function path(value: unknown, label: string): string {
  const result = text(value, label);
  if (!PATH.test(result) || /[\r\n]/u.test(result)) fail(`${label} must be vault-relative`);
  return result;
}
function digest(value: unknown, label: string): string {
  const result = text(value, label);
  if (!SHA256.test(result)) fail(`${label} must be a 64-character lowercase sha256`);
  return result;
}
function scalar(value: unknown, label: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  fail(`${label} must be a JSON scalar`);
}
function safeJson(value: unknown, label = "manifest"): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { if (SECRET.test(value)) fail(`${label} contains secret-bearing text`); return; }
  if (typeof value === "number") { if (Number.isFinite(value)) return; fail(`${label} must be JSON-safe`); }
  if (Array.isArray(value)) { value.forEach((item, index) => safeJson(item, `${label}[${index}]`)); return; }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be JSON-safe`);
    for (const [key, item] of Object.entries(value)) safeJson(item, `${label}.${key}`);
    return;
  }
  fail(`${label} must be JSON-safe`);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function templateManifestFingerprint(value: TemplateManifestV1): string {
  const { fingerprint: _fingerprint, ...payload } = value;
  return createHash("sha256").update(canonical(payload)).digest("hex");
}

export function validateTemplateManifestV1(value: unknown): TemplateManifestV1 {
  safeJson(value);
  const root = record(value, "TemplateManifest");
  exact(root, ["schemaVersion", "manifestId", "source", "template", "home", "components", "diagnostics", "provenance", "fingerprint"], [], "TemplateManifest");
  if (root.schemaVersion !== 1) fail("TemplateManifest.schemaVersion must be 1");
  const source = record(root.source, "source"); exact(source, ["path", "sha256"], [], "source"); path(source.path, "source.path"); digest(source.sha256, "source.sha256");
  const template = record(root.template, "template"); exact(template, ["path", "sha256"], [], "template"); path(template.path, "template.path"); digest(template.sha256, "template.sha256");
  const home = record(root.home, "home"); exact(home, ["path", "dashboard"], [], "home"); path(home.path, "home.path");
  const dashboard = record(home.dashboard, "home.dashboard"); exact(dashboard, ["layout", "componentIds"], [], "home.dashboard");
  if (!["grid", "tabs", "stack"].includes(String(dashboard.layout))) fail("home.dashboard.layout is invalid");
  if (!Array.isArray(dashboard.componentIds) || dashboard.componentIds.some((item) => typeof item !== "string" || item.length === 0)) fail("home.dashboard.componentIds must be non-empty strings");
  const dashboardIds = dashboard.componentIds.map((item) => identifier(item, "home.dashboard.componentIds"));
  if (new Set(dashboardIds).size !== dashboardIds.length) fail("home.dashboard.componentIds must be unique");
  if (!Array.isArray(root.components)) fail("components must be an array");
  const ids = new Set<string>();
  for (const [index, raw] of root.components.entries()) {
    const component = record(raw, `components[${index}]`); exact(component, ["id", "type"], ["title", "layout", "children", "fields", "actions"], `components[${index}]`);
    const id = identifier(component.id, `components[${index}].id`); if (ids.has(id)) fail(`components has duplicate id ${id}`); ids.add(id);
    const type = String(component.type);
    if (!(["multi", "data-view", "form", "card", "count", "markdown", "time"] as string[]).includes(type)) fail(`components[${index}].type is unsupported`);
    if (component.title !== undefined) text(component.title, `components[${index}].title`);
    if (component.children !== undefined) {
      if (type !== "multi" || !Array.isArray(component.children)) fail(`children are only valid on multi components`);
      const childIds = new Set<string>();
      for (const child of component.children) { const childId = identifier(child, "component child"); if (childIds.has(childId)) fail("component children must be unique"); childIds.add(childId); }
    }
    if (component.fields !== undefined && type !== "form") fail("fields are only valid on form components");
    if (component.actions !== undefined && !["form", "card", "data-view"].includes(type)) fail("actions are only valid on form, card, or data-view components");
    if (component.layout !== undefined) {
      const layout = record(component.layout, `components[${index}].layout`); exact(layout, [], ["mobile", "laptop"], `components[${index}].layout`);
      for (const key of ["mobile", "laptop"] as const) if (layout[key] !== undefined) { const box = record(layout[key], `${key} layout`); exact(box, ["x", "y", "w", "h"], [], `${key} layout`); for (const field of ["x", "y", "w", "h"]) if (!Number.isInteger(box[field]) || (box[field] as number) < 0) fail(`${key} layout.${field} must be a non-negative integer`); }
    }
    if (component.fields !== undefined) {
      if (!Array.isArray(component.fields)) fail(`components[${index}].fields must be an array`);
      const fieldIds = new Set<string>();
      for (const [fieldIndex, rawField] of component.fields.entries()) {
        const field = record(rawField, `fields[${fieldIndex}]`);
        exact(field, ["id", "label", "type", "property"], ["options"], `fields[${fieldIndex}]`);
        const fieldId = identifier(field.id, "field.id");
        if (fieldIds.has(fieldId)) fail("form field IDs must be unique");
        fieldIds.add(fieldId);
        text(field.label, "field.label"); identifier(field.property, "field.property");
        if (!["text", "number", "date", "select", "checkbox"].includes(String(field.type))) fail("field.type is invalid");
        if (field.options !== undefined && (!Array.isArray(field.options) || field.options.some((item) => typeof item !== "string"))) fail("field.options is invalid");
      }
    }
    if (component.actions !== undefined) {
      if (!Array.isArray(component.actions)) fail(`components[${index}].actions must be an array`);
      for (const [actionIndex, rawAction] of component.actions.entries()) { const action = record(rawAction, `actions[${actionIndex}]`); const kind = text(action.kind, "action.kind") as TemplateActionKind; if (!ACTIONS.has(kind)) fail(`action ${kind} is not allowlisted`); if (kind === "create-file") { exact(action, ["kind", "templatePath", "targetFolder", "fileName"], [], "create-file"); path(action.templatePath, "create-file.templatePath"); path(action.targetFolder, "create-file.targetFolder"); text(action.fileName, "create-file.fileName"); } else if (kind === "update-property") { exact(action, ["kind", "property", "value"], [], "update-property"); identifier(action.property, "update-property.property"); scalar(action.value, "update-property.value"); } else if (kind === "open-file") { exact(action, ["kind", "path"], [], "open-file"); path(action.path, "open-file.path"); } else { exact(action, ["kind", "commandId"], [], "call-command"); identifier(action.commandId, "call-command.commandId"); } }
    }
  }
  if (!dashboardIds.every((id) => ids.has(id))) fail("home.dashboard.componentIds references an unknown component");
  if (!Array.isArray(root.diagnostics)) fail("diagnostics must be an array");
  for (const [index, raw] of root.diagnostics.entries()) { const diagnostic = record(raw, `diagnostics[${index}]`); exact(diagnostic, ["kind", "code", "message"], ["componentId", "evidence"], `diagnostics[${index}]`); if (![...["unsupported", "ambiguous", "warning"]].includes(String(diagnostic.kind))) fail("diagnostic.kind is invalid"); identifier(diagnostic.code, "diagnostic.code"); text(diagnostic.message, "diagnostic.message"); if (diagnostic.componentId !== undefined && !ids.has(identifier(diagnostic.componentId, "diagnostic.componentId"))) fail("diagnostic.componentId is unknown"); if ((diagnostic.kind === "ambiguous" || diagnostic.kind === "unsupported") && (!Array.isArray(diagnostic.evidence) || diagnostic.evidence.length === 0)) fail("unsupported/ambiguous diagnostic requires evidence"); if (diagnostic.evidence !== undefined && (!Array.isArray(diagnostic.evidence) || diagnostic.evidence.some((item) => typeof item !== "string" || item.length === 0))) fail("diagnostic.evidence is invalid"); }
  const provenance = record(root.provenance, "provenance"); exact(provenance, ["origin"], ["sourceUrl", "release"], "provenance"); if (![...["external-observation", "native-export", "user-authored"]].includes(String(provenance.origin))) fail("provenance.origin is invalid"); if (provenance.sourceUrl !== undefined) { const url = text(provenance.sourceUrl, "provenance.sourceUrl"); if (!/^https:\/\//u.test(url) || SECRET.test(url)) fail("provenance.sourceUrl must be a safe HTTPS URL"); } if (provenance.release !== undefined) text(provenance.release, "provenance.release");
  const result = root as unknown as TemplateManifestV1;
  const fingerprint = digest(root.fingerprint, "fingerprint");
  for (const raw of root.components) {
    const component = raw as unknown as TemplateComponentV1;
    for (const child of component.children ?? []) if (!ids.has(child)) fail(`component child ${child} is an unknown reference`);
  }
  if (fingerprint !== templateManifestFingerprint(result)) fail("fingerprint does not match deterministic manifest content");
  return result;
}
