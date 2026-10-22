import { createHash } from "node:crypto";
import { validateTemplateManifestV1, type TemplateManifestV1 } from "@obsidian-llm-wiki/agent-wiki-contracts";
import { VisualWorkspaceError, type TemplateImportInput } from "@obsidian-llm-wiki/visual-workspace";

export const MAX_TEMPLATE_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_TEMPLATE_ARTIFACT_BYTES = 2 * 1024 * 1024;

const SAFE_PATH = /^(?!\/)(?![A-Za-z]:)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\u0000\\]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function invalid(message: string): never {
  throw new VisualWorkspaceError("INVALID_CONTRACT", message);
}

/**
 * Read an upload envelope. The manifest describes the separately supplied
 * artifact bytes so its source digest can be checked without trusting input.
 */
export function readTemplateManifestJson(path: string, content: string): TemplateImportInput {
  if (!SAFE_PATH.test(path) || /[\r\n]/u.test(path)) invalid("template artifact path must be vault-relative and contain no newlines");
  if (typeof content !== "string" || content.length === 0) invalid("template artifact content must be non-empty text");
  if (Buffer.byteLength(content, "utf8") > MAX_TEMPLATE_IMPORT_BYTES) invalid("template import envelope exceeds the byte limit");

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    invalid("template artifact content must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("template artifact must be a JSON object");
  const envelope = value as Record<string, unknown>;
  const keys = Object.keys(envelope).sort();
  if (keys.length !== 2 || keys[0] !== "artifactContent" || keys[1] !== "manifest") {
    invalid("template upload envelope has unknown fields; expected exactly manifest and artifactContent");
  }
  if (!envelope.manifest || typeof envelope.artifactContent !== "string") {
    invalid("template artifact must contain manifest and artifactContent");
  }
  if (Buffer.byteLength(envelope.artifactContent, "utf8") > MAX_TEMPLATE_ARTIFACT_BYTES) invalid("template artifact exceeds the byte limit");

  const manifest = validateTemplateManifestV1(envelope.manifest);
  const source = manifest.source;
  if (source.path !== path || !SHA256.test(source.sha256)) {
    invalid("template artifact source does not match its path or digest");
  }
  const actual = createHash("sha256").update(envelope.artifactContent, "utf8").digest("hex");
  if (actual !== source.sha256) invalid("template artifact content hash does not match manifest source lock");
  return { source: { path, sha256: source.sha256 }, manifest };
}
