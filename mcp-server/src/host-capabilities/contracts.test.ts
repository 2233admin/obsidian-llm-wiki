import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HostCapabilityContractError,
  fingerprintContract,
  normalizeExpertDescriptor,
  validateAssignmentPlan,
  validateCapabilityHealth,
  validateCapabilityImportProvenance,
  validateHostCapabilityConnector,
} from "./contracts.js";
import { descriptor, health, provenance } from "./test-fixtures.js";
import { planAssignment } from "./assignment.js";
import {
  connector,
  grant,
  policy,
  requirement,
  TEST_NOW,
} from "./test-fixtures.js";
import {
  ExpertDescriptorRegistry,
  HostCapabilityConnectorRegistry,
} from "./registry.js";

describe("host capability contracts", () => {
  it("requires reviewable import provenance with URL, revision, hash, license, importer, and approval", () => {
    const imported = provenance();
    assert.doesNotThrow(() => validateCapabilityImportProvenance(imported));
    assert.equal(imported.source.revision.kind, "commit");
    assert.match(imported.source.contentHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(imported.licenseReview.status, "approved");
    assert.equal(imported.importer.version, "1.0.0");
    assert.equal(imported.approval.status, "approved");
  });

  it("rejects malformed source hashes and sensitive health diagnostics", () => {
    const malformed = provenance({
      source: {
        ...provenance().source,
        contentHash: "sha256:not-a-hash" as `sha256:${string}`,
      },
    });
    assert.throws(
      () => validateCapabilityImportProvenance(malformed),
      HostCapabilityContractError,
    );
    assert.throws(
      () =>
        validateCapabilityHealth(
          health({ diagnostics: { authorization: "Bearer super-secret" } }),
        ),
      /sensitive keys are forbidden/,
    );
  });

  it("normalizes set-like descriptor fields before fingerprinting", () => {
    const left = normalizeExpertDescriptor(descriptor());
    const right = normalizeExpertDescriptor(
      descriptor({
        capabilities: [...descriptor().capabilities].reverse(),
        operations: [...descriptor().operations].reverse(),
        models: [...descriptor().models!].reverse(),
      }),
    );
    assert.equal(fingerprintContract(left), fingerprintContract(right));
  });

  it("models assignment selection and approval as separate contract states", () => {
    const descriptors = new ExpertDescriptorRegistry();
    const connectors = new HostCapabilityConnectorRegistry();
    descriptors.register(descriptor());
    descriptors.setHealth("expert/code-review", "1.0.0", health());
    connectors.register(connector(), async () => ({ invoke: async () => null }));
    const plan = planAssignment({
      plannedAt: TEST_NOW,
      requirement: requirement(),
      policy: policy(),
      grant: grant(),
      candidates: [
        {
          descriptor: descriptors.require("expert/code-review", "1.0.0"),
          connector: connectors.require("connector/mock", "1.0.0"),
        },
      ],
    });
    assert.equal(plan.status, "matched");
    assert.equal(plan.approval.status, "pending");
    assert.doesNotThrow(() => validateAssignmentPlan(plan));
    assert.doesNotThrow(() =>
      validateAssignmentPlan({
        ...plan,
        approval: {
          status: "approved",
          reviewedBy: "approver/test",
          reviewedAt: TEST_NOW,
        },
      }),
    );
  });

  it("accepts stdio/HTTP execution contracts for local and cloud Agent/model capability kinds", () => {
    const cases = [
      connector({ connectorId: "connector/local-cli", kind: "local-cli", transport: "stdio" }),
      connector({ connectorId: "connector/local-model", kind: "local-model", transport: "http" }),
      connector({ connectorId: "connector/cloud-model", kind: "cloud-model", transport: "http" }),
      connector({ connectorId: "connector/cloud-agent", kind: "cloud-agent", transport: "http" }),
      connector({ connectorId: "connector/remote-workflow", kind: "remote-workflow", transport: "http" }),
    ];
    for (const candidate of cases) assert.doesNotThrow(() => validateHostCapabilityConnector(candidate));
  });
});
