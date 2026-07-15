import {
  HOST_CAPABILITY_SCHEMA_VERSION,
  type AssignmentRequirement,
  type CapabilityHealth,
  type CapabilityImportProvenance,
  type CapabilityOperationGrant,
  type ExpertDescriptor,
  type HostCapabilityConnector,
  type ProjectCapabilityPolicy,
} from "./contracts.js";

export const TEST_NOW = "2026-07-15T00:00:00.000Z";
export const TEST_NOW_MS = Date.parse(TEST_NOW);

export function provenance(
  overrides: Partial<CapabilityImportProvenance> = {},
): CapabilityImportProvenance {
  return {
    schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
    source: {
      url: "https://github.com/example/expert",
      revision: { kind: "commit", value: "abc123" },
      contentHash: `sha256:${"a".repeat(64)}`,
    },
    licenseReview: {
      status: "approved",
      expression: "Apache-2.0",
      reviewedBy: "reviewer/test",
      reviewedAt: "2026-07-14T00:00:00.000Z",
    },
    importer: {
      name: "llmwiki-importer",
      version: "1.0.0",
    },
    approval: {
      status: "approved",
      reviewedBy: "approver/test",
      reviewedAt: "2026-07-14T01:00:00.000Z",
    },
    ...overrides,
  };
}
export function descriptor(
  overrides: Partial<ExpertDescriptor> = {},
): ExpertDescriptor {
  return {
    schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
    descriptorId: "expert/code-review",
    descriptorVersion: "1.0.0",
    displayName: "Code Review Expert",
    capabilities: ["code.review", "repository.search"],
    operations: [
      {
        operation: "expert.search",
        description: "Search the expert's declared capability surface",
        sideEffectClass: "none",
        grantKey: "host.expert.search",
      },
      {
        operation: "expert.write",
        description: "Write through the expert connector",
        sideEffectClass: "external-write",
        grantKey: "host.expert.write",
      },
    ],
    models: ["model/local"],
    cost: { kind: "free" },
    connectorRef: {
      connectorId: "connector/mock",
      connectorVersion: "1.0.0",
    },
    importProvenance: provenance(),
    ...overrides,
  };
}

export function connector(
  overrides: Partial<HostCapabilityConnector> = {},
): HostCapabilityConnector {
  return {
    schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
    connectorId: "connector/mock",
    connectorVersion: "1.0.0",
    displayName: "Mock MCP Connector",
    kind: "mcp",
    transport: "mock",
    supportedOperations: ["expert.search", "expert.write"],
    importProvenance: provenance({
      source: {
        url: "https://github.com/example/connector",
        revision: { kind: "version", value: "1.0.0" },
        contentHash: `sha256:${"b".repeat(64)}`,
      },
    }),
    ...overrides,
  };
}

export function health(
  overrides: Partial<CapabilityHealth> = {},
): CapabilityHealth {
  return {
    schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
    state: "available",
    observedAt: "2026-07-14T23:00:00.000Z",
    expiresAt: "2026-07-16T00:00:00.000Z",
    reasonCodes: [],
    remediationKeys: [],
    ...overrides,
  };
}

export function requirement(
  overrides: Partial<AssignmentRequirement> = {},
): AssignmentRequirement {
  return {
    schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
    requirementId: "requirement/review",
    projectId: "project/llmwiki",
    workRunId: "work-run/review-001",
    capabilities: ["code.review"],
    operations: ["expert.search"],
    model: "model/local",
    ...overrides,
  };
}

export function policy(
  overrides: Partial<ProjectCapabilityPolicy> = {},
): ProjectCapabilityPolicy {
  return {
    schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
    policyId: "policy/default",
    policyVersion: "1.0.0",
    allowedSideEffectClasses: ["none"],
    allowDegradedHealth: true,
    allowUnknownCost: false,
    ...overrides,
  };
}

export function grant(
  overrides: Partial<CapabilityOperationGrant> = {},
): CapabilityOperationGrant {
  return {
    schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
    grantId: "grant/review",
    projectId: "project/llmwiki",
    workRunId: "work-run/review-001",
    descriptorIds: ["expert/code-review"],
    connectorIds: ["connector/mock"],
    operations: ["expert.search"],
    sideEffectClasses: ["none"],
    expiresAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}
