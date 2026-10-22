import assert from "node:assert/strict";
import { test } from "node:test";

import {
  templateManifestFingerprint,
  type TemplateComponentV1,
  type TemplateManifestV1,
} from "@obsidian-llm-wiki/agent-wiki-contracts";
import { createTemplateImportPreview, type TemplateImportInput } from "../src/index.js";

const source = { path: "imports/Home.components", sha256: "a".repeat(64) };

function manifest(components: TemplateComponentV1[], diagnostics: TemplateManifestV1["diagnostics"] = []): TemplateManifestV1 {
  const value = {
    schemaVersion: 1 as const,
    manifestId: "template/home",
    source,
    template: { path: "Home.components", sha256: source.sha256 },
    home: {
      path: "Home.components",
      dashboard: { layout: "grid" as const, componentIds: components.map((item) => item.id) },
    },
    components,
    diagnostics,
    provenance: { origin: "external-observation" as const, sourceUrl: "https://example.com/template" },
  };
  return { ...value, fingerprint: templateManifestFingerprint({ ...value, fingerprint: "" }) };
}

function input(components: TemplateComponentV1[], diagnostics?: TemplateManifestV1["diagnostics"]): TemplateImportInput {
  return { source, manifest: manifest(components, diagnostics) };
}

test("maps bounded Home/dashboard components, forms, and allowlisted actions", () => {
  const preview = createTemplateImportPreview(input([
    {
      id: "multi-1",
      type: "multi",
      children: ["card-1", "form-1"],
    },
    {
      id: "card-1",
      type: "card",
      title: "New note",
      layout: { mobile: { x: 0, y: 0, w: 1, h: 1 }, laptop: { x: 0, y: 0, w: 2, h: 1 } },
      actions: [{ kind: "create-file", templatePath: "Templates/Note.md", targetFolder: "Inbox", fileName: "{{title}}.md" }],
    },
    {
      id: "form-1",
      type: "form",
      title: "Capture",
      fields: [
        { id: "title", label: "Title", type: "text", property: "title" },
        { id: "kind", label: "Kind", type: "select", property: "kind", options: ["idea", "task"] },
      ],
      actions: [{ kind: "update-property", property: "kind", value: "idea" }],
    },
  ]));
 
  assert.equal(preview.readOnly, true);
  assert.deepEqual(preview.components[0]?.children, ["card-1", "form-1"]);
  assert.deepEqual(preview.home.dashboard.componentIds, ["multi-1", "card-1", "form-1"]);
  assert.deepEqual(preview.template, { path: "Home.components", sha256: source.sha256 });
  assert.equal(preview.home.dashboard.layout, "grid");
  assert.equal(preview.components[1]?.kind, "card");
  assert.deepEqual(preview.components[1]?.layoutProfiles, {
    mobile: { x: 0, y: 0, w: 1, h: 1 },
    laptop: { x: 0, y: 0, w: 2, h: 1 },
  });
  assert.deepEqual(preview.components[2]?.form?.fields.map((field) => field.id), ["title", "kind"]);
  assert.equal(preview.components[1]?.actions[0]?.kind, "create-file");
  assert.equal(preview.components[2]?.actions[0]?.kind, "update-property");
  assert.match(preview.fingerprint, /^sha256:[a-f0-9]{64}$/u);

});

test("preserves unsupported diagnostics without executing code-bearing constructs", () => {
  const preview = createTemplateImportPreview(input([
    { id: "script", type: "markdown", title: "Safe fallback" },
    { id: "command", type: "card", actions: [{ kind: "call-command", commandId: "daily-notes" }] },
  ], [{ kind: "unsupported", code: "UNSUPPORTED_CODE", message: "Code-bearing component was quarantined.", componentId: "script", evidence: ["runScript"] }]));

  assert.equal(preview.readOnly, true);
  assert.ok(preview.diagnostics.some((diagnostic) => diagnostic.code === "UNSUPPORTED_CODE"));
  assert.deepEqual(preview.diagnostics.find((diagnostic) => diagnostic.code === "UNSUPPORTED_CODE")?.evidence, ["runScript"]);
  assert.equal(preview.components.find((item) => item.id === "command")?.actions[0]?.kind, "call-command");
  assert.doesNotMatch(JSON.stringify(preview), /process\.exit|throw new Error/iu);
});

test("rejects machine paths before producing a preview", () => {
  const invalid = input([{ id: "bad", type: "card", title: "C:\\\\Users\\alice\\secret.md" }]);
  assert.throws(() => createTemplateImportPreview(invalid), /vault-relative|path|unsafe/iu);
});

test("is deterministic and exposes no write capability", () => {
  const value = input([{ id: "count", type: "count", title: "Tasks" }]);
  const first = createTemplateImportPreview(value);
  const second = createTemplateImportPreview(JSON.parse(JSON.stringify(value)) as TemplateImportInput);
  assert.deepEqual(first, second);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "apply"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, "write"), false);
});
