import { canonicalDigest } from "../src/canonical.js";
import type {
  AgentProfile,
  MemoryProposalCandidate,
  MemoryRevision,
  MemorySections,
  ModelLock,
  ProjectAgentBinding,
} from "../src/types.js";
import { makeMemorySection, revisionFingerprintMaterial } from "../src/validation.js";

export const NOW = "2026-07-15T00:00:00.000Z";
export const LATER = "2026-07-16T00:00:00.000Z";

export const modelLock: ModelLock = {
  provider: "local",
  model: "fixture-model",
  contextWindow: 131_072,
  tokenizer: "fixture-tokenizer/v1",
  policyFingerprint: canonicalDigest({ policy: "fixture" }),
};

export function profile(revision = 1): AgentProfile {
  return {
    schemaVersion: 1,
    profileId: "agent/researcher",
    revision,
    displayName: "Researcher",
    role: "Project researcher",
    responsibilities: ["Gather evidence"],
    capabilityClaims: ["source-synthesis"],
    constitution: {
      principles: ["Preserve provenance"],
      instructions: ["Separate evidence from inference"],
    },
    defaultModelPolicy: { mode: "local", provider: "local", model: "fixture-model" },
    createdAt: NOW,
    createdBy: "fixture",
    updatedAt: NOW,
    updatedBy: "fixture",
  };
}

export function binding(revision = 1): ProjectAgentBinding {
  return {
    schemaVersion: 1,
    bindingId: "binding/demo/researcher",
    projectId: "project/demo",
    projectContextFingerprint: canonicalDigest({ project: "demo" }),
    profileId: "agent/researcher",
    profileRevision: 1,
    revision,
    role: "Project researcher",
    enabled: true,
    memoryScopes: ["recentContext", "openItems", "stableMemory"],
    connectorGrantRefs: ["grant/repo-read"],
    createdAt: NOW,
    createdBy: "fixture",
    updatedAt: NOW,
    updatedBy: "fixture",
  };
}

export function emptySections(): MemorySections {
  return {
    recentContext: makeMemorySection(),
    openItems: makeMemorySection(),
    stableMemory: makeMemorySection(),
  };
}

export function approvedMemory(sections: MemorySections = emptySections()): MemoryRevision {
  const material: Omit<MemoryRevision, "fingerprint"> = {
    schemaVersion: 1,
    revisionId: "memory-revision/fixture-1",
    revision: 1,
    previousRevisionId: null,
    previousFingerprint: null,
    projectId: "project/demo",
    profileId: "agent/researcher",
    lifecycle: "approved",
    sections,
    protectedDirectives: [],
    unresolvedConflicts: [],
    exactDiff: [{ operation: "replace", section: "recentContext", beforeHash: null, after: sections.recentContext }],
    provenance: [{ kind: "source", id: "fixture/source" }],
    approval: {
      proposalId: "memory-proposal/fixture-1",
      transitionTokenHash: canonicalDigest({ token: "fixture" }),
      actor: "fixture",
      policyVersion: "fixture-policy/v1",
      policyResult: "allowed",
    },
    createdAt: NOW,
  };
  return { ...material, fingerprint: canonicalDigest(revisionFingerprintMaterial(material as MemoryRevision)) };
}

export function checkpointCandidate(overrides: Partial<MemoryProposalCandidate> = {}): MemoryProposalCandidate {
  const after = makeMemorySection("Project checkpoint", ["thread/message-1"]);
  return {
    operation: "checkpoint",
    projectId: "project/demo",
    profileId: "agent/researcher",
    sourceIdentities: {
      threadId: "thread/fixture",
      revisionIds: [],
      artifactIds: [],
      cutoffAt: NOW,
    },
    expectedRevision: { revisionId: null, revision: 0, fingerprint: null },
    sourceFingerprint: canonicalDigest({ source: "fixture" }),
    candidateDiff: [{ operation: "replace", section: "recentContext", beforeHash: null, after }],
    protectedDirectives: [],
    unresolvedConflicts: [],
    provenance: [{ kind: "thread", id: "thread/fixture", revision: 1 }],
    warnings: [],
    modelLock,
    expiresAt: LATER,
    ...overrides,
  };
}

export const allow = async () => ({
  allowed: true,
  policyVersion: "test-policy/v1",
  reason: "Actor owns this test scope",
});
