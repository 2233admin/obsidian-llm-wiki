import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { canonicalDigest } from "../src/canonical.js";
import { compileContextEnvelope } from "../src/context-envelope.js";
import { ContextBudgetError } from "../src/errors.js";
import type { ContextEnvelopeCompileInput } from "../src/types.js";
import { checkpointCandidate, approvedMemory, binding, modelLock, NOW, profile } from "./helpers.js";

function input(): ContextEnvelopeCompileInput {
  const memoryRevision = approvedMemory({
    recentContext: {
      content: " Recent context remains byte-exact.\n",
      citations: ["thread/message-1"],
      contentHash: canonicalDigest({ content: " Recent context remains byte-exact.\n", citations: ["thread/message-1"] }),
    },
    openItems: {
      content: "Open item",
      citations: ["work-run/run-1"],
      contentHash: canonicalDigest({ content: "Open item", citations: ["work-run/run-1"] }),
    },
    stableMemory: {
      content: "Stable fact",
      citations: ["artifact/report-1"],
      contentHash: canonicalDigest({ content: "Stable fact", citations: ["artifact/report-1"] }),
    },
  });
  return {
    envelopeId: "envelope/demo-1",
    compiledAt: NOW,
    modelLock,
    tokenBudget: 100_000,
    platformKernel: [{
      chunkId: "governance/v1",
      content: { rules: ["Manual approval for memory", "No secret persistence"] },
      provenance: [{ kind: "governance", id: "llmwiki/kernel", revision: 1 }],
      mandatory: false,
    }],
    profile: profile(),
    binding: binding(),
    memoryRevision,
    memoryRevisionLock: {
      revisionId: memoryRevision.revisionId,
      revision: memoryRevision.revision,
      fingerprint: memoryRevision.fingerprint,
    },
    runtime: {
      projectContext: {
        chunkId: "context",
        content: { projectId: "project/demo", objective: "Ship governed rooms" },
        provenance: [{ kind: "project", id: "project/demo", fingerprint: canonicalDigest({ project: "demo" }) }],
        mandatory: false,
      },
      threadWindow: [{
        chunkId: "window-1",
        content: { summary: "x".repeat(4_000) },
        provenance: [{ kind: "thread", id: "thread/fixture", revision: 1 }],
        mandatory: false,
        priority: 0,
      }],
      settingsSnapshot: {
        chunkId: "effective",
        content: { modelPolicy: "local", memoryApproval: "manual" },
        provenance: [{ kind: "settings", id: "settings/project/demo", revision: 1 }],
        mandatory: false,
      },
      deviceCapabilities: [],
      capabilityGrants: [],
    },
  };
}

describe("four-layer Context Envelope compiler", () => {
  test("compilation is deterministic, ordered, and locks Profile/Binding/Memory/Model", () => {
    const first = compileContextEnvelope(input());
    const second = compileContextEnvelope(input());
    assert.equal(first.fingerprint, second.fingerprint);
    assert.deepEqual(first.layers.map((layer) => layer.name), [
      "platformKernel",
      "agentConstitution",
      "governedWorkingMemory",
      "runtimeEnvelope",
    ]);
    assert.equal(first.layers[0].chunks[0]?.mandatory, true);
    assert.equal(first.layers[1].chunks.every((chunk) => chunk.mandatory), true);
    assert.equal(first.layers[2].chunks[0]?.mandatory, true);
    assert.equal(first.layers[3].chunks.find((chunk) => chunk.chunkId.startsWith("runtime/project/"))?.mandatory, true);
    assert.equal(first.layers[3].chunks.find((chunk) => chunk.chunkId.startsWith("runtime/settings/"))?.mandatory, true);
    assert.equal(first.tokenCount, first.layers.reduce((sum, layer) => sum + layer.tokenCount, 0));
  });

  test("deterministic trimming evicts optional runtime context before governed memory", () => {
    const full = compileContextEnvelope(input());
    const runtimeWindow = full.layers[3].chunks.find((chunk) => chunk.chunkId === "runtime/thread/window-1")!;
    const constrainedInput = input();
    constrainedInput.tokenBudget = full.tokenCount - runtimeWindow.tokenCount;
    const constrained = compileContextEnvelope(constrainedInput);
    assert.deepEqual(constrained.omissions, [{
      layer: "runtimeEnvelope",
      chunkId: "runtime/thread/window-1",
      reason: "token-budget",
      tokenCount: runtimeWindow.tokenCount,
      mandatory: false,
    }]);
    assert.equal(constrained.layers[2].chunks.some((chunk) => chunk.chunkId === "governed-memory/stableMemory"), true);
    assert.equal(constrained.layers.flatMap((layer) => layer.chunks).every((chunk) => chunk.mandatory || !constrained.omissions.some((omission) => omission.chunkId === chunk.chunkId)), true);
  });

  test("compiler fails closed when mandatory governance exceeds budget", () => {
    const full = compileContextEnvelope(input());
    const mandatoryTokens = full.layers.flatMap((layer) => layer.chunks)
      .filter((chunk) => chunk.mandatory)
      .reduce((sum, chunk) => sum + chunk.tokenCount, 0);
    const constrained = input();
    constrained.tokenBudget = mandatoryTokens - 1;
    assert.throws(() => compileContextEnvelope(constrained), ContextBudgetError);
  });

  test("changing the model lock changes the reproducibility fingerprint", () => {
    const first = compileContextEnvelope(input());
    const changed = input();
    changed.modelLock = { ...changed.modelLock, model: "fixture-model-v2" };
    const second = compileContextEnvelope(changed);
    assert.notEqual(first.fingerprint, second.fingerprint);
  });

  test("compiler rejects proposal-shaped memory, stale locks, and unsafe runtime data", () => {
    const proposalMemory = input();
    proposalMemory.memoryRevision = checkpointCandidate() as unknown as ContextEnvelopeCompileInput["memoryRevision"];
    assert.throws(() => compileContextEnvelope(proposalMemory), /MemoryRevision|Memory Revision/);

    const staleProfile = input();
    staleProfile.profile = profile(2);
    assert.throws(() => compileContextEnvelope(staleProfile), /exact revision locked/);

    const staleMemory = input();
    staleMemory.memoryRevisionLock = { ...staleMemory.memoryRevisionLock, revision: 99 };
    assert.throws(() => compileContextEnvelope(staleMemory), /current revision lock/);

    const unsafe = input();
    unsafe.runtime.threadWindow[0]!.content = { note: "C:\\Users\\alice\\vault" };
    assert.throws(() => compileContextEnvelope(unsafe), /absolute paths/);

    const leaseLeak = input();
    leaseLeak.runtime.threadWindow[0]!.content = { leaseToken: "device-lease" } as never;
    assert.throws(() => compileContextEnvelope(leaseLeak), /Forbidden sensitive/);

    const processLeak = input();
    processLeak.runtime.deviceCapabilities = [{
      chunkId: "unsafe-device",
      content: { processId: 42 } as never,
      provenance: [{ kind: "deviceCapability", id: "device/capability" }],
    }];
    assert.throws(() => compileContextEnvelope(processLeak), /Forbidden sensitive/);

    const invalidPriority = input();
    invalidPriority.runtime.threadWindow[0]!.priority = -1;
    assert.throws(() => compileContextEnvelope(invalidPriority), /non-negative integer/);

  });

  test("compiler rejects Runtime Project Context provenance not locked by the Binding", () => {
    const staleProjectContext = input();
    staleProjectContext.runtime.projectContext.provenance = [{
      kind: "project",
      id: "project/demo",
      fingerprint: canonicalDigest({ project: "stale" }),
    }];
    assert.throws(() => compileContextEnvelope(staleProjectContext), /Project Context.*Binding/);

    const wrongProjectContext = input();
    wrongProjectContext.runtime.projectContext.provenance = [{
      kind: "project",
      id: "project/other",
      fingerprint: wrongProjectContext.binding.projectContextFingerprint,
    }];
    assert.throws(() => compileContextEnvelope(wrongProjectContext), /Project Context.*Binding/);
  });

  test("byte-exact governed memory survives when not trimmed", () => {
    const compiled = compileContextEnvelope(input());
    const recent = compiled.layers[2].chunks.find((chunk) => chunk.chunkId === "governed-memory/recentContext")!;
    const section = (recent.content as { section: { content: string } }).section;
    assert.equal(section.content, " Recent context remains byte-exact.\n");
  });
});
