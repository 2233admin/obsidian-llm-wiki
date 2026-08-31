import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { templateManifestFingerprint, type TemplateManifestV1 } from "@obsidian-llm-wiki/agent-wiki-contracts";
import { makeTemplateImportOps } from "./template-import-ops.js";
import { MAX_TEMPLATE_IMPORT_BYTES, readTemplateManifestJson } from "./template-import-reader.js";

const artifactPath = "Home.components";
const artifactContent = '{"components":[]}';

function manifest(sourceSha256 = createHash("sha256").update(artifactContent, "utf8").digest("hex")): TemplateManifestV1 {
  const value = {
    schemaVersion: 1 as const,
    manifestId: "template/home",
    source: { path: artifactPath, sha256: sourceSha256 },
    template: { path: artifactPath, sha256: sourceSha256 },
    home: { path: artifactPath, dashboard: { layout: "stack" as const, componentIds: ["multi"] } },
    components: [{ id: "multi", type: "multi" as const, children: [] }],
    diagnostics: [],
    provenance: { origin: "external-observation" as const },
  };
  return { ...value, fingerprint: templateManifestFingerprint({ ...value, fingerprint: "" }) };
}

function envelope(value = manifest(), content = artifactContent): string {
  return JSON.stringify({ manifest: value, artifactContent: content });
}

test("registers a mutating=false template preview operation", async () => {
  const operation = makeTemplateImportOps().find((item) => item.name === "visual.template.preview");
  assert.ok(operation);
  assert.equal(operation.mutating, false);
  assert.equal(operation.closedParams, true);
  assert.equal(operation.writePolicy, undefined);
  const result = await operation.handler({
    vault: { execute: async () => { throw new Error("vault must not be touched"); } },
    adapters: null,
    config: {} as never,
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  }, { path: artifactPath, content: envelope() });
  assert.equal((result as { readOnly: boolean }).readOnly, true);
  assert.deepEqual((result as { template: unknown }).template, { path: artifactPath, sha256: manifest().source.sha256 });
  assert.match((result as { fingerprint: string }).fingerprint, /^sha256:[a-f0-9]{64}$/u);
});

test("rejects malformed JSON, unsafe paths, and source lock mismatches", async () => {
  const operation = makeTemplateImportOps()[0]!;
  await assert.rejects(() => operation.handler({} as never, { path: artifactPath, content: "{" }), /valid JSON|JSON/iu);
  await assert.rejects(() => operation.handler({} as never, { path: "C:\\\\Users\\alice\\Home.components", content: "{}" }), /vault-relative|path/iu);
  await assert.rejects(() => operation.handler({} as never, { path: artifactPath, content: envelope(manifest("b".repeat(64))) }), /hash|source|lock/iu);
  await assert.rejects(() => operation.handler({} as never, { path: artifactPath, content: envelope(manifest(), "tampered") }), /hash|source|lock/iu);
});

test("returns a byte-stable digest and never invokes vault writes", async () => {
  const operation = makeTemplateImportOps()[0]!;
  const params = { path: artifactPath, content: envelope() };
  const context = {
    vault: { execute: async () => { throw new Error("vault must not be touched"); } },
    adapters: null,
    config: {} as never,
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
  const first = await operation.handler(context, params);
  const second = await operation.handler(context, params);
  assert.deepEqual(first, second);
  assert.match((first as { fingerprint: string }).fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "write"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "apply"), false);
});

test("requires an exact two-key upload envelope", () => {
  const value = JSON.parse(envelope()) as Record<string, unknown>;
  value.extra = true;
  assert.throws(() => readTemplateManifestJson(artifactPath, JSON.stringify(value)), /unknown|extra/iu);
});

test("rejects oversized envelope and artifact content before processing", () => {
  const oversizedArtifact = "x".repeat(MAX_TEMPLATE_IMPORT_BYTES + 1);
  const oversizedManifest = manifest(createHash("sha256").update(oversizedArtifact, "utf8").digest("hex"));
  assert.throws(() => readTemplateManifestJson(artifactPath, envelope(oversizedManifest, oversizedArtifact)), /size|large|limit/iu);
  assert.throws(() => readTemplateManifestJson(artifactPath, "x".repeat(MAX_TEMPLATE_IMPORT_BYTES + 1)), /size|large|limit/iu);
});

test("reader validates the shared manifest contract before returning", () => {
  const value = JSON.parse(envelope()) as { manifest: Record<string, unknown>; artifactContent: string };
  const badFingerprint = JSON.stringify({
    manifest: { ...value.manifest, fingerprint: "0".repeat(64) },
    artifactContent: value.artifactContent,
  });
  assert.throws(() => readTemplateManifestJson(artifactPath, badFingerprint), /fingerprint|digest/iu);

  const extraField = JSON.stringify({
    manifest: { ...value.manifest, unexpected: true },
    artifactContent: value.artifactContent,
  });
  assert.throws(() => readTemplateManifestJson(artifactPath, extraField), /unknown|field/iu);
});
