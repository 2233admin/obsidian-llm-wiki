import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planAssignment } from "./assignment.js";
import {
  GovernedMcpProxy,
  HostCapabilityProxyError,
} from "./proxy.js";
import {
  ExpertDescriptorRegistry,
  HostCapabilityConnectorRegistry,
  type HostCapabilityConnectorFactory,
} from "./registry.js";
import {
  TEST_NOW,
  TEST_NOW_MS,
  connector,
  descriptor,
  grant,
  health,
  policy,
  requirement,
} from "./test-fixtures.js";

function harness(factory: HostCapabilityConnectorFactory) {
  const descriptors = new ExpertDescriptorRegistry();
  const connectors = new HostCapabilityConnectorRegistry();
  descriptors.register(descriptor());
  descriptors.setHealth("expert/code-review", "1.0.0", health());
  connectors.register(connector(), factory);
  const capabilityGrant = grant();
  const planned = planAssignment({
    plannedAt: TEST_NOW,
    requirement: requirement(),
    policy: policy(),
    grant: capabilityGrant,
    candidates: [
      {
        descriptor: descriptors.require("expert/code-review", "1.0.0"),
        connector: connectors.require("connector/mock", "1.0.0"),
      },
    ],
  });
  const assignmentPlan = {
    ...planned,
    approval: {
      status: "approved" as const,
      reviewedBy: "approver/test",
      reviewedAt: TEST_NOW,
    },
  };
  const scope = {
    projectId: "project/llmwiki",
    workRunId: "work-run/review-001",
    descriptorKeys: ["expert/code-review@1.0.0"],
    grant: capabilityGrant,
  };
  const proxy = new GovernedMcpProxy(descriptors, connectors, {
    now: () => TEST_NOW_MS,
    connectionTimeoutMs: 25,
    invocationTimeoutMs: 25,
  });
  return { descriptors, connectors, proxy, assignmentPlan, scope };
}

function captureProxyError(error: unknown): boolean {
  assert.ok(error instanceof HostCapabilityProxyError);
  return true;
}

describe("governed MCP host capability proxy", () => {
  it("searches and describes granted capabilities without connecting unrelated servers", () => {
    let factoryCalls = 0;
    const { proxy, scope } = harness(async () => {
      factoryCalls += 1;
      return { invoke: async () => ({ ok: true }) };
    });
    const results = proxy.search({
      scope,
      capability: "code.review",
      operation: "expert.search",
    });
    const description = proxy.describe({
      scope,
      descriptorId: "expert/code-review",
      descriptorVersion: "1.0.0",
    });
    assert.equal(results.length, 1);
    assert.deepEqual(results[0]?.operations, ["expert.search"]);
    assert.deepEqual(
      description.visibleOperations.map((operation) => operation.operation),
      ["expert.search"],
    );
    assert.equal(factoryCalls, 0);
  });

  it("connects lazily on first authorized invoke and reuses the connection", async () => {
    let factoryCalls = 0;
    let invokeCalls = 0;
    const { proxy, scope, assignmentPlan } = harness(async () => {
      factoryCalls += 1;
      return {
        invoke: async (request) => {
          invokeCalls += 1;
          return {
            projectId: request.projectId,
            workRunId: request.workRunId,
            echo: request.input,
          };
        },
      };
    });
    const description = proxy.describe({
      scope,
      descriptorId: "expert/code-review",
      descriptorVersion: "1.0.0",
    });
    const request = {
      scope,
      assignmentPlan,
      descriptorId: "expert/code-review",
      descriptorVersion: "1.0.0",
      operation: "expert.search",
      describedDescriptorFingerprint: description.descriptorFingerprint,
      input: { query: "registry" },
    } as const;
    await proxy.invoke(request);
    await proxy.invoke(request);
    assert.equal(factoryCalls, 1);
    assert.equal(invokeCalls, 2);
  });

  it("rejects ungranted operations before opening a connector", async () => {
    let factoryCalls = 0;
    const { proxy, scope, assignmentPlan } = harness(async () => {
      factoryCalls += 1;
      return { invoke: async () => null };
    });
    const description = proxy.describe({
      scope,
      descriptorId: "expert/code-review",
      descriptorVersion: "1.0.0",
    });
    await assert.rejects(
      proxy.invoke({
        scope,
        assignmentPlan,
        descriptorId: "expert/code-review",
        descriptorVersion: "1.0.0",
        operation: "expert.write",
        describedDescriptorFingerprint: description.descriptorFingerprint,
        input: {},
      }),
      (error: unknown) => {
        captureProxyError(error);
        assert.equal(
          (error as HostCapabilityProxyError).diagnostic.code,
          "operation_not_granted",
        );
        return true;
      },
    );
    assert.equal(factoryCalls, 0);
  });

  it("rejects a matched but still-pending AssignmentPlan before connecting", async () => {
    let factoryCalls = 0;
    const { proxy, scope, assignmentPlan } = harness(async () => {
      factoryCalls += 1;
      return { invoke: async () => null };
    });
    const description = proxy.describe({
      scope,
      descriptorId: "expert/code-review",
      descriptorVersion: "1.0.0",
    });
    await assert.rejects(
      proxy.invoke({
        scope,
        assignmentPlan: {
          ...assignmentPlan,
          approval: { status: "pending" },
        },
        descriptorId: "expert/code-review",
        descriptorVersion: "1.0.0",
        operation: "expert.search",
        describedDescriptorFingerprint: description.descriptorFingerprint,
        input: {},
      }),
      (error: unknown) => {
        captureProxyError(error);
        assert.equal(
          (error as HostCapabilityProxyError).diagnostic.code,
          "assignment_not_approved",
        );
        return true;
      },
    );
    assert.equal(factoryCalls, 0);
  });

  it("rejects descriptor drift before connecting", async () => {
    let factoryCalls = 0;
    const { proxy, scope, assignmentPlan, descriptors } = harness(async () => {
      factoryCalls += 1;
      return { invoke: async () => null };
    });
    const description = proxy.describe({
      scope,
      descriptorId: "expert/code-review",
      descriptorVersion: "1.0.0",
    });
    descriptors.replace(descriptor({ displayName: "Changed after approval" }));
    await assert.rejects(
      proxy.invoke({
        scope,
        assignmentPlan,
        descriptorId: "expert/code-review",
        descriptorVersion: "1.0.0",
        operation: "expert.search",
        describedDescriptorFingerprint: description.descriptorFingerprint,
        input: {},
      }),
      (error: unknown) => {
        captureProxyError(error);
        assert.equal(
          (error as HostCapabilityProxyError).diagnostic.code,
          "descriptor_drift",
        );
        return true;
      },
    );
    assert.equal(factoryCalls, 0);
  });

  it("returns a structured timeout diagnostic", async () => {
    const { proxy, scope, assignmentPlan } = harness(async () => ({
      invoke: async () => await new Promise<never>(() => undefined),
    }));
    const description = proxy.describe({
      scope,
      descriptorId: "expert/code-review",
      descriptorVersion: "1.0.0",
    });
    await assert.rejects(
      proxy.invoke({
        scope,
        assignmentPlan,
        descriptorId: "expert/code-review",
        descriptorVersion: "1.0.0",
        operation: "expert.search",
        describedDescriptorFingerprint: description.descriptorFingerprint,
        input: {},
        timeoutMs: 5,
      }),
      (error: unknown) => {
        captureProxyError(error);
        const diagnostic = (error as HostCapabilityProxyError).diagnostic;
        assert.equal(diagnostic.code, "invoke_timeout");
        assert.equal(diagnostic.stage, "timeout");
        assert.equal(diagnostic.retryable, true);
        return true;
      },
    );
  });

  it("redacts credentials and machine-local paths from connector diagnostics", async () => {
    const { proxy, scope, assignmentPlan } = harness(async () => ({
      invoke: async () =>
        await Promise.reject({
          message: "Bearer super-secret at C:\\Users\\Admin\\private.env",
          headers: { Authorization: "Bearer another-secret" },
          apiKey: "raw-api-key",
        }),
    }));
    const description = proxy.describe({
      scope,
      descriptorId: "expert/code-review",
      descriptorVersion: "1.0.0",
    });
    await assert.rejects(
      proxy.invoke({
        scope,
        assignmentPlan,
        descriptorId: "expert/code-review",
        descriptorVersion: "1.0.0",
        operation: "expert.search",
        describedDescriptorFingerprint: description.descriptorFingerprint,
        input: { authorization: "this input is never copied to diagnostics" },
      }),
      (error: unknown) => {
        captureProxyError(error);
        const serialized = JSON.stringify(
          (error as HostCapabilityProxyError).diagnostic,
        );
        assert.equal(serialized.includes("super-secret"), false);
        assert.equal(serialized.includes("another-secret"), false);
        assert.equal(serialized.includes("raw-api-key"), false);
        assert.equal(serialized.includes("C:\\\\Users"), false);
        assert.match(serialized, /REDACTED/);
        return true;
      },
    );
  });

  it("rejects connector responses that conflict with canonical Project Context", async () => {
    const { proxy, scope, assignmentPlan } = harness(async () => ({
      invoke: async () => ({ projectId: "project/other", ok: true }),
    }));
    const description = proxy.describe({
      scope,
      descriptorId: "expert/code-review",
      descriptorVersion: "1.0.0",
    });
    await assert.rejects(
      proxy.invoke({
        scope,
        assignmentPlan,
        descriptorId: "expert/code-review",
        descriptorVersion: "1.0.0",
        operation: "expert.search",
        describedDescriptorFingerprint: description.descriptorFingerprint,
        input: {},
      }),
      (error: unknown) => {
        captureProxyError(error);
        assert.equal(
          (error as HostCapabilityProxyError).diagnostic.code,
          "identity_conflict",
        );
        return true;
      },
    );
  });
});
