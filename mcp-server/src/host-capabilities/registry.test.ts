import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ExpertDescriptorRegistry,
  HostCapabilityConnectorRegistry,
  HostCapabilityRegistryError,
} from "./registry.js";
import { connector, descriptor, health } from "./test-fixtures.js";

describe("host capability registries", () => {
  it("is idempotent for canonical descriptor content and rejects conflicting duplicates", () => {
    const registry = new ExpertDescriptorRegistry();
    const first = registry.register(descriptor());
    const same = registry.register(
      descriptor({ capabilities: [...descriptor().capabilities].reverse() }),
    );
    assert.equal(first.fingerprint, same.fingerprint);
    assert.throws(
      () => registry.register(descriptor({ displayName: "Conflicting Name" })),
      (error: unknown) =>
        error instanceof HostCapabilityRegistryError &&
        error.code === "registry_conflict",
    );
  });

  it("marks a reviewed import stale when the observed revision or content hash drifts", () => {
    const registry = new ExpertDescriptorRegistry();
    registry.register(descriptor());
    registry.setHealth("expert/code-review", "1.0.0", health());
    const entry = registry.observeSource("expert/code-review", "1.0.0", {
      revision: { kind: "commit", value: "def456" },
      contentHash: `sha256:${"c".repeat(64)}`,
      observedAt: "2026-07-15T00:00:00.000Z",
    });
    assert.equal(entry.assignable, false);
    assert.deepEqual(entry.reasonCodes, [
      "source_revision_drift",
      "source_content_drift",
    ]);
  });

  it("connects lazily, shares concurrent connection attempts, and can close the cache", async () => {
    const registry = new HostCapabilityConnectorRegistry();
    let factoryCalls = 0;
    let closeCalls = 0;
    registry.register(connector(), async () => {
      factoryCalls += 1;
      await Promise.resolve();
      return {
        invoke: async () => ({ ok: true }),
        close: async () => {
          closeCalls += 1;
        },
      };
    });
    assert.equal(factoryCalls, 0);
    const [left, right] = await Promise.all([
      registry.connect("connector/mock", "1.0.0", 100),
      registry.connect("connector/mock", "1.0.0", 100),
    ]);
    assert.equal(left, right);
    assert.equal(factoryCalls, 1);
    await registry.closeAll();
    assert.equal(closeCalls, 1);
    await registry.connect("connector/mock", "1.0.0", 100);
    assert.equal(factoryCalls, 2);
  });

  it("excludes a connector when its observed imported source drifts", () => {
    const registry = new HostCapabilityConnectorRegistry();
    registry.register(connector(), async () => ({ invoke: async () => null }));
    const entry = registry.observeSource("connector/mock", "1.0.0", {
      revision: { kind: "version", value: "1.0.1" },
      contentHash: `sha256:${"d".repeat(64)}`,
      observedAt: "2026-07-15T00:00:00.000Z",
    });
    assert.equal(entry.assignable, false);
    assert.deepEqual(entry.reasonCodes, [
      "source_revision_drift",
      "source_content_drift",
    ]);
  });
});
