import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  templateManifestFingerprint,
  validateTemplateManifestV1,
  type TemplateManifestV1,
} from "../src/index.js";

function fixture(): TemplateManifestV1 {
  return JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/v1/template-manifest.json", import.meta.url)), "utf8")) as TemplateManifestV1;
}

describe("TemplateManifest v1", () => {
  test("validates a strict Home/dashboard manifest with forms and allowlisted actions", () => {
    const value = validateTemplateManifestV1(fixture());
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.home.dashboard.layout, "grid");
    assert.equal(value.components.some((component) => component.type === "form"), true);
    assert.equal(value.components.some((component) => component.actions?.[0]?.kind === "create-file"), true);
    assert.equal(value.diagnostics[0]?.kind, "unsupported");
    assert.equal(value.provenance.origin, "external-observation");
    assert.equal(value.fingerprint, templateManifestFingerprint(value));
  });

  test("rejects unknown fields, unsafe paths, non-sha256 digests, and unallowlisted actions", () => {
    const value = fixture() as unknown as Record<string, unknown>;
    assert.throws(() => validateTemplateManifestV1({ ...value, extra: true }), /unknown field|additional/i);
    assert.throws(() => validateTemplateManifestV1({ ...value, source: { ...(value.source as object), path: "C:/Users/private" } }), /vault-relative|path/i);
    assert.throws(() => validateTemplateManifestV1({ ...value, source: { ...(value.source as object), sha256: "bad" } }), /sha256/i);
    const components = [...(value.components as unknown[])];
    const first = { ...(components[0] as object), actions: [{ kind: "run-script", target: "x" }] };
    assert.throws(() => validateTemplateManifestV1({ ...value, components: [first, ...components.slice(1)] }), /allowlisted|action/i);
  });
  test("rejects newline-bearing vault paths", () => {
    const value = fixture();
    assert.throws(() => validateTemplateManifestV1({ ...value, source: { ...value.source, path: "Templates\nHome.components" } }), /vault-relative|path/i);
  });

  test("rejects secret-bearing text and credential URLs", () => {
    const value = fixture();
    assert.throws(() => validateTemplateManifestV1({ ...value, provenance: { ...value.provenance, sourceUrl: "https://user:password@example.com" } }), /secret|credential/i);
    const component = { ...value.components[1]!, actions: [{ kind: "call-command" as const, commandId: "token=secret" }] };
    assert.throws(() => validateTemplateManifestV1({ ...value, components: [value.components[0]!, component] }), /secret|credential/i);
  });

  test("rejects duplicate and dangling IDs and enforces component semantics", () => {
    const value = fixture();
    assert.throws(() => validateTemplateManifestV1({ ...value, home: { ...value.home, dashboard: { ...value.home.dashboard, componentIds: ["dashboard", "dashboard"] } } }), /duplicate|unique/i);
    assert.throws(() => validateTemplateManifestV1({ ...value, components: [{ ...value.components[0]!, children: ["missing"] }, value.components[1]!] }), /unknown|reference|child/i);
    assert.throws(() => validateTemplateManifestV1({ ...value, components: [{ ...value.components[0]!, fields: [{ id: "x", label: "x", type: "text", property: "x" }] }, value.components[1]!] }), /field|form/i);
    assert.throws(() => validateTemplateManifestV1({ ...value, components: [{ ...value.components[0]!, type: "count", actions: [{ kind: "open-file", path: "Notes/x.md" }] }, value.components[1]!] }), /action|card|form/i);
  });

  test("requires evidence for unsupported and ambiguous diagnostics in the schema-shaped contract", () => {
    const value = fixture();
    assert.throws(() => validateTemplateManifestV1({ ...value, diagnostics: [{ kind: "ambiguous", code: "x", message: "x" }] }), /provenance|evidence/i);
  });

  test("rejects ambiguous diagnostics without evidence and keeps fingerprint deterministic", () => {
    const value = fixture();
    const reordered = { ...value, components: [...value.components].reverse() };
    assert.notEqual(templateManifestFingerprint(value), templateManifestFingerprint(reordered));
    assert.throws(() => validateTemplateManifestV1({
      ...value,
      diagnostics: [{ kind: "ambiguous", code: "x", message: "x" }],
    }), /provenance|evidence/i);
  });
});
