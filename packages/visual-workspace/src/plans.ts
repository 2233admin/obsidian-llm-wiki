import { canonicalDigest, deepClone, deepFreeze, sha256Text } from "./canonical.js";
import { VisualWorkspaceError } from "./errors.js";
import { parseManagedMindMapSection, serializeManagedMindMapSection } from "./markdown.js";
import type {
  VisualApplyRequest,
  VisualEditPlan,
  VisualEditSnapshot,
} from "./types.js";
import {
  assertExactFields,
  assertSha256Digest,
  mindMapFingerprint,
  parseMindMapDocument,
  parseVaultRelativePath,
} from "./validation.js";

function planPayload(plan: Omit<VisualEditPlan, "fingerprint">): Omit<VisualEditPlan, "fingerprint"> {
  return deepClone(plan);
}

function planFingerprint(plan: Omit<VisualEditPlan, "fingerprint">): `sha256:${string}` {
  return canonicalDigest(planPayload(plan));
}

function assertSnapshot(value: unknown, context: string): asserts value is VisualEditSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", `${context} must be an object`);
  }
  const candidate = value as unknown as Record<string, unknown>;
  assertExactFields(candidate, ["document", "documentFingerprint", "managedMarkdown"], context);
  const document = parseMindMapDocument(candidate.document);
  assertSha256Digest(candidate.documentFingerprint, `${context}.documentFingerprint`);
  if (candidate.documentFingerprint !== mindMapFingerprint(document)) {
    throw new VisualWorkspaceError("PLAN_TAMPERED", `${context} document fingerprint does not match`);
  }
  if (typeof candidate.managedMarkdown !== "string") {
    throw new VisualWorkspaceError("INVALID_CONTRACT", `${context}.managedMarkdown must be a string`);
  }
  const parsed = parseManagedMindMapSection(candidate.managedMarkdown);
  if (parsed.raw !== candidate.managedMarkdown || mindMapFingerprint(parsed.document) !== candidate.documentFingerprint) {
    throw new VisualWorkspaceError("PLAN_TAMPERED", `${context} Markdown does not match its document`);
  }
}

export function createVisualEditPlan(input: {
  sourcePath: string;
  sourceMarkdown: string;
  nextDocument: unknown;
  provenance: VisualEditPlan["provenance"];
  warnings?: readonly string[];
}): Readonly<VisualEditPlan> {
  const sourcePath = parseVaultRelativePath(input.sourcePath, "sourcePath");
  const provenance = parseProvenance(input.provenance, "provenance");
  const warnings = parseStringArray(input.warnings ?? [], "warnings");
  const current = parseManagedMindMapSection(input.sourceMarkdown);
  const nextDocument = parseMindMapDocument(input.nextDocument);
  if (current.document.id !== nextDocument.id) {
    throw new VisualWorkspaceError("MAP_ID_MISMATCH", "An edit plan cannot change the managed map identity");
  }
  const before: VisualEditSnapshot = {
    document: current.document,
    documentFingerprint: mindMapFingerprint(current.document),
    managedMarkdown: current.raw,
  };
  const afterMarkdown = serializeManagedMindMapSection(nextDocument, { eol: current.eol });
  const after: VisualEditSnapshot = {
    document: nextDocument,
    documentFingerprint: mindMapFingerprint(nextDocument),
    managedMarkdown: afterMarkdown,
  };
  const payload: Omit<VisualEditPlan, "fingerprint"> = {
    schemaVersion: 1,
    source: {
      path: sourcePath,
      sha256: sha256Text(input.sourceMarkdown),
    },
    preview: { before, after },
    affectedPaths: [sourcePath],
    provenance,
    warnings,
  };
  return deepFreeze({
    ...payload,
    fingerprint: planFingerprint(payload),
  }) as Readonly<VisualEditPlan>;
}

export function assertVisualEditPlan(value: unknown): asserts value is VisualEditPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", "VisualEditPlan must be an object");
  }
  const plan = value as unknown as Record<string, unknown>;
  assertExactFields(
    plan,
    ["schemaVersion", "source", "preview", "affectedPaths", "provenance", "warnings", "fingerprint"],
    "VisualEditPlan",
  );
  if (plan.schemaVersion !== 1) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", "VisualEditPlan.schemaVersion must be 1");
  }
  if (!plan.source || typeof plan.source !== "object" || Array.isArray(plan.source)) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", "VisualEditPlan.source must be an object");
  }
  const source = plan.source as Record<string, unknown>;
  assertExactFields(source, ["path", "sha256"], "VisualEditPlan.source");
  parseVaultRelativePath(source.path, "VisualEditPlan.source.path");
  assertSha256Digest(source.sha256, "VisualEditPlan.source.sha256");
  if (!plan.preview || typeof plan.preview !== "object" || Array.isArray(plan.preview)) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", "VisualEditPlan.preview must be an object");
  }
  const preview = plan.preview as Record<string, unknown>;
  assertExactFields(preview, ["before", "after"], "VisualEditPlan.preview");
  assertSnapshot(preview.before, "VisualEditPlan.preview.before");
  assertSnapshot(preview.after, "VisualEditPlan.preview.after");
  if (preview.before.document.id !== preview.after.document.id) {
    throw new VisualWorkspaceError("PLAN_TAMPERED", "VisualEditPlan cannot change map identity");
  }
  const affectedPaths = parseStringArray(plan.affectedPaths, "VisualEditPlan.affectedPaths")
    .map((path, index) => parseVaultRelativePath(path, `VisualEditPlan.affectedPaths[${index}]`));
  if (affectedPaths.length !== 1 || affectedPaths[0] !== source.path) {
    throw new VisualWorkspaceError(
      "PLAN_TAMPERED",
      "VisualEditPlan.affectedPaths must contain exactly the locked source path",
    );
  }
  const provenance = parseProvenance(plan.provenance, "VisualEditPlan.provenance");
  const warnings = parseStringArray(plan.warnings, "VisualEditPlan.warnings");
  assertSha256Digest(plan.fingerprint, "VisualEditPlan.fingerprint");
  const payload = {
    schemaVersion: 1 as const,
    source: source as unknown as VisualEditPlan["source"],
    preview: preview as unknown as VisualEditPlan["preview"],
    affectedPaths,
    provenance,
    warnings,
  };
  if (plan.fingerprint !== planFingerprint(payload)) {
    throw new VisualWorkspaceError("PLAN_TAMPERED", "VisualEditPlan fingerprint does not match");
  }
}

export function visualEditPlanFingerprint(value: unknown): `sha256:${string}` {
  assertVisualEditPlan(value);
  return value.fingerprint;
}

export function assertVisualApplyRequest(value: unknown): asserts value is VisualApplyRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", "VisualApplyRequest must be an object");
  }
  const request = value as Record<string, unknown>;
  assertExactFields(
    request,
    ["plan", "presentedFingerprint", "actor", "transitionToken"],
    "VisualApplyRequest",
  );
  assertVisualEditPlan(request.plan);
  assertSha256Digest(request.presentedFingerprint, "VisualApplyRequest.presentedFingerprint");
  if (request.presentedFingerprint !== request.plan.fingerprint) {
    throw new VisualWorkspaceError("PLAN_TAMPERED", "Presented plan fingerprint does not match");
  }
  parseSingleLine(request.actor, "VisualApplyRequest.actor");
  parseSingleLine(request.transitionToken, "VisualApplyRequest.transitionToken", 256);
}

function parseProvenance(value: unknown, context: string): VisualEditPlan["provenance"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", `${context} must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  assertExactFields(candidate, ["actor", "origin"], context);
  const actor = parseSingleLine(candidate.actor, `${context}.actor`);
  if (candidate.origin !== "user" && candidate.origin !== "assistant" && candidate.origin !== "import") {
    throw new VisualWorkspaceError(
      "INVALID_CONTRACT",
      `${context}.origin must be user, assistant, or import`,
    );
  }
  return { actor, origin: candidate.origin };
}

function parseStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) {
    throw new VisualWorkspaceError("INVALID_CONTRACT", `${context} must be an array`);
  }
  return value.map((item, index) => parseSingleLine(item, `${context}[${index}]`, 2000));
}

function parseSingleLine(value: unknown, context: string, maxLength = 512): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || /[\r\n]/.test(value)
  ) {
    throw new VisualWorkspaceError(
      "INVALID_CONTRACT",
      `${context} must be a non-empty single-line string`,
    );
  }
  return value;
}
