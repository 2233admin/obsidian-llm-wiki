import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planAssignment } from "./assignment.js";
import {
  ExpertDescriptorRegistry,
  HostCapabilityConnectorRegistry,
} from "./registry.js";
import {
  TEST_NOW,
  connector,
  descriptor,
  grant,
  health,
  policy,
  requirement,
} from "./test-fixtures.js";

function registeredCandidate(
  descriptorOverrides: Parameters<typeof descriptor>[0] = {},
  healthOverrides: Parameters<typeof health>[0] = {},
) {
  const descriptors = new ExpertDescriptorRegistry();
  const connectors = new HostCapabilityConnectorRegistry();
  const expert = descriptor(descriptorOverrides);
  descriptors.register(expert);
  descriptors.setHealth(
    expert.descriptorId,
    expert.descriptorVersion,
    health(healthOverrides),
  );
  connectors.register(connector(), async () => ({ invoke: async () => null }));
  return {
    descriptor: descriptors.require(
      expert.descriptorId,
      expert.descriptorVersion,
    ),
    connector: connectors.require("connector/mock", "1.0.0"),
  };
}

describe("deterministic host capability assignment", () => {
  it("produces the same plan across candidate order and uses a stable identity tie-break", () => {
    const alpha = registeredCandidate({ descriptorId: "expert/alpha" });
    const beta = registeredCandidate({ descriptorId: "expert/beta" });
    const common = {
      plannedAt: TEST_NOW,
      requirement: requirement(),
      policy: policy(),
      grant: grant({
        descriptorIds: ["expert/alpha", "expert/beta"],
      }),
    };
    const forward = planAssignment({ ...common, candidates: [beta, alpha] });
    const reverse = planAssignment({ ...common, candidates: [alpha, beta] });
    assert.deepEqual(forward, reverse);
    assert.equal(forward.status, "matched");
    assert.equal(forward.selected?.descriptorId, "expert/alpha");
    assert.match(forward.planId, /^assignment-plan\/[a-f0-9]{24}$/);
  });

  it("prefers the highest version for otherwise equivalent versions of one expert", () => {
    const oldVersion = registeredCandidate({ descriptorVersion: "1.9.0" });
    const newVersion = registeredCandidate({ descriptorVersion: "1.10.0" });
    const plan = planAssignment({
      plannedAt: TEST_NOW,
      requirement: requirement(),
      policy: policy(),
      grant: grant(),
      candidates: [oldVersion, newVersion],
    });
    assert.equal(plan.selected?.descriptorVersion, "1.10.0");
  });

  it("returns ordered, actionable no-match diagnostics without connecting", () => {
    let factoryCalls = 0;
    const descriptors = new ExpertDescriptorRegistry();
    const connectors = new HostCapabilityConnectorRegistry();
    descriptors.register(descriptor({ capabilities: ["repository.search"] }));
    descriptors.setHealth(
      "expert/code-review",
      "1.0.0",
      health({ state: "unavailable", reasonCodes: ["probe.failed"] }),
    );
    connectors.register(connector(), async () => {
      factoryCalls += 1;
      return { invoke: async () => null };
    });
    const plan = planAssignment({
      plannedAt: TEST_NOW,
      requirement: requirement(),
      policy: policy(),
      grant: grant({ operations: [] }),
      candidates: [
        {
          descriptor: descriptors.require("expert/code-review", "1.0.0"),
          connector: connectors.require("connector/mock", "1.0.0"),
        },
      ],
    });
    assert.equal(plan.status, "no-match");
    assert.deepEqual(plan.evaluations[0]?.reasonCodes, [
      "health_unavailable",
      "capability_missing",
      "operation_not_granted",
    ]);
    assert.deepEqual(plan.diagnostics.reasonCodes, [
      "health_unavailable",
      "capability_missing",
      "operation_not_granted",
    ]);
    assert.equal(factoryCalls, 0, "planning must never connect or dispatch");
  });

  it("excludes descriptor source drift from assignment", () => {
    const descriptors = new ExpertDescriptorRegistry();
    const connectors = new HostCapabilityConnectorRegistry();
    descriptors.register(descriptor());
    descriptors.setHealth("expert/code-review", "1.0.0", health());
    descriptors.observeSource("expert/code-review", "1.0.0", {
      revision: { kind: "commit", value: "different" },
      contentHash: descriptor().importProvenance.source.contentHash,
      observedAt: TEST_NOW,
    });
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
    assert.equal(plan.status, "no-match");
    assert.deepEqual(plan.evaluations[0]?.reasonCodes, [
      "descriptor_source_drift",
    ]);
  });

  it("excludes an unavailable connector health observation", () => {
    const candidate = registeredCandidate();
    const plan = planAssignment({
      plannedAt: TEST_NOW,
      requirement: requirement(),
      policy: policy(),
      grant: grant(),
      candidates: [
        {
          ...candidate,
          connectorHealth: health({ state: "unavailable" }),
        },
      ],
    });
    assert.equal(plan.status, "no-match");
    assert.deepEqual(plan.evaluations[0]?.reasonCodes, [
      "connector_health_unavailable",
    ]);
  });
});
