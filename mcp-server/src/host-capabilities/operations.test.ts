import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  AgentDomainService,
  DelegationStore,
  canonicalDigest,
  createDelegationPlan,
} from "../../../packages/agent-domain/dist/src/index.js";
import {
  normalizeHostCapabilityConnectorId,
  type HostCapabilityProvider,
} from "../../../packages/settings-platform/dist/src/index.js";
import type { Operation, OperationContext } from "../core/types.js";
import { normalizedProjectContext, resolveProjectContext } from "../project/project-context.js";
import { createSettingsService } from "../settings/settings.js";
import { makeHostCapabilityOps } from "./operations.js";
import { parseDefaultHostTransport } from "./transport.js";
import {
  TEST_NOW,
  TEST_NOW_MS,
  connector,
  descriptor,
  health,
  policy,
  requirement,
} from "./test-fixtures.js";

const PROVIDERS: Array<{ provider: HostCapabilityProvider; endpoint: string; locator: string }> = [
  { provider: "linear", endpoint: "https://api.linear.app/graphql", locator: "LINEAR_TOKEN" },
  { provider: "github", endpoint: "https://api.github.com", locator: "GITHUB_TOKEN" },
  { provider: "gitea", endpoint: "https://git.example.test/api/v1", locator: "GITEA_TOKEN" },
];

interface Fixture {
  root: string;
  operationContext: OperationContext;
  settingsService: ReturnType<typeof createSettingsService>;
  environment: NodeJS.ProcessEnv;
  access: { project: string; bindingId: string; grantId: string };
  workRunId: string;
}

async function fixture(options: {
  enabled?: boolean;
  withSecret?: boolean;
  provider?: HostCapabilityProvider;
  settingsCredential?: boolean;
  environment?: NodeJS.ProcessEnv;
} = {}): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "llmwiki-host-capability-"));
  mkdirSync(join(root, "Projects"), { recursive: true });
  writeFileSync(join(root, "Projects", "llmwiki.md"), [
    "---", "entity: project/llmwiki", "type: project", "status: active", "---", "", "# LLM Wiki", "",
  ].join("\n"), "utf8");
  const provider = options.provider ?? "github";
  const providerFixture = PROVIDERS.find(item => item.provider === provider) ?? {
    provider,
    endpoint: "https://host.example.test/mcp",
    locator: "HOST_CONNECTOR_KEY",
  };
  const environment = options.environment ?? (
    options.withSecret === false ? {} : { [providerFixture.locator]: "never-return-this-token" }
  );
  const settingsService = createSettingsService({
    vaultPath: root,
    userDevicePath: join(root, "device-settings.json"),
    userDeviceId: "device/test",
    sessionId: "host-test",
    environment,
    clock: () => TEST_NOW,
  });
  await configureProvider(settingsService, provider, {
    enabled: options.enabled ?? true,
    endpoint: providerFixture.endpoint,
    ...(options.settingsCredential === false ? {} : { locator: providerFixture.locator }),
  });

  const stateRoot = join(root, "_llmwiki", "agent-domain", "v1");
  const agentDomain = new AgentDomainService({ stateRoot, clock: () => TEST_NOW });
  const project = resolveProjectContext(root, "project/llmwiki");
  const plan = createDelegationPlan({
    planId: "delegation-plan/host-review",
    projectId: "project/llmwiki",
    parentWorkRunId: "work-run/parent",
    objective: "Execute one governed host capability",
    assignment: {
      assignmentPlanId: "assignment-plan/host-review",
      assignmentPlanVersion: 1,
      assignmentPlanFingerprint: canonicalDigest({ assignment: "host-review" }),
      deviceSnapshot: {
        snapshotId: "device-snapshot/host-review",
        deviceId: "device/test",
        revision: 1,
        fingerprint: canonicalDigest({ device: "test" }),
        capturedAt: TEST_NOW,
        expiresAt: "2026-07-16T00:00:00.000Z",
      },
      profileId: "agent/reviewer",
      profileRevision: 1,
      bindingId: "binding/llmwiki/reviewer",
      bindingRevision: 1,
      contextEnvelopeFingerprint: canonicalDigest({ context: "host-review" }),
    },
    inputArtifactIds: [],
    requestedCapabilityScope: {
      connectors: [provider],
      operations: ["expert.search"],
      resources: ["repo/example/review", "descriptor/expert/code-review@1.0.0"],
      sideEffectClasses: ["read-only"],
    },
    budget: {
      policyVersion: "budget/v1",
      maxInputTokens: 1000,
      maxOutputTokens: 500,
      maxDurationMs: 60_000,
    },
    expiresAt: "2026-07-16T00:00:00.000Z",
    expectedOutput: {
      outputClass: "run-output",
      mediaType: "application/json",
      requiredArtifactCount: 1,
      acceptanceCriteria: ["Return a governed result"],
    },
    sideEffectPolicy: {
      externalEffectsRequirePerRunApproval: true,
      requestedExternalClasses: [],
    },
    provenance: [{ kind: "workRun", id: "work-run/parent" }],
    createdAt: TEST_NOW,
    createdBy: "human/reviewer",
  });
  const suffix = canonicalDigest({ planId: plan.planId, fingerprint: plan.fingerprint }).slice("sha256:".length, "sha256:".length + 24);
  const grantId = `grant/child-${suffix}` as const;
  await agentDomain.createProfile({
    profileId: "agent/reviewer",
    displayName: "Reviewer",
    role: "Project reviewer",
    constitution: { principles: ["Preserve governance"], instructions: ["Use server state"] },
    actor: "human/reviewer",
  });
  const binding = await agentDomain.createBinding({
    projectId: "project/llmwiki",
    projectContextFingerprint: canonicalDigest(normalizedProjectContext(project)),
    profileId: "agent/reviewer",
    profileRevision: 1,
    role: "Project reviewer",
    connectorGrantRefs: [grantId],
    actor: "human/reviewer",
  });
  assert.equal(binding.status, "committed");
  const delegation = new DelegationStore({
    collaborationRoot: join(stateRoot, "collaboration"),
    projectId: "project/llmwiki",
    clock: () => TEST_NOW,
  });
  await delegation.createPlan(plan);
  const issued = await delegation.approve({
    planId: plan.planId,
    presentedFingerprint: plan.fingerprint,
    transitionToken: "approve-host-review",
    approvedExternalClasses: [],
    actor: "human/reviewer",
    authorize: async () => ({
      allowed: true,
      policyVersion: "host-test/v1",
      reason: "Fixture approval",
      decidedAt: TEST_NOW,
      actor: "human/reviewer",
    }),
  });
  assert.equal(issued.grant.grantId, grantId);

  return {
    root,
    settingsService,
    environment,
    access: { project: "project/llmwiki", bindingId: "binding/llmwiki/reviewer", grantId },
    workRunId: issued.child.workRunId,
    operationContext: {
      vault: { execute: async () => null },
      adapters: null,
      config: {
        vault_path: root,
        collaboration: {
          actor: "human/reviewer",
          role: "human",
          allowed_write_paths: ["_llmwiki/host-capabilities/**", "external/host-capability/**"],
        },
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      dryRun: false,
    },
  };
}

async function configureProvider(
  service: ReturnType<typeof createSettingsService>,
  provider: HostCapabilityProvider,
  options: { enabled: boolean; endpoint: string; locator?: string },
): Promise<void> {
  const assignments: Array<readonly [
    string,
    Parameters<typeof service.assignmentSet>[0]["value"],
  ]> = [
    ["providers.host_capability.enabled", options.enabled],
    ["providers.host_capability.provider", provider],
    ["providers.host_capability.transport", "http"],
    ["providers.host_capability.endpoint", options.endpoint],
  ];
  if (options.locator) {
    assignments.push([
      "providers.host_capability.secret_ref",
      { provider: "environment", locator: options.locator },
    ]);
  }
  for (const [key, value] of assignments) {
    const current = await service.scopesGet("session");
    const result = await service.assignmentSet({
      scope: "session", key, value, expectedRevision: current.document.revision, updatedBy: "host-test",
    });
    assert.equal(result.status, "committed", JSON.stringify(result));
  }
}

function operationsByName(operations: Operation[]): Map<string, Operation> {
  return new Map(operations.map(operation => [operation.name, operation]));
}

async function call(
  operations: Map<string, Operation>,
  context: OperationContext,
  name: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  const operation = operations.get(name);
  assert.ok(operation, `Missing operation ${name}`);
  return operation.handler(context, params);
}

function descriptorRegistration(
  provider: HostCapabilityProvider = "github",
  overrides: Parameters<typeof descriptor>[0] = {},
) {
  const connectorId = normalizeHostCapabilityConnectorId(provider)!;
  return {
    schemaVersion: 1,
    descriptor: descriptor({
      ...overrides,
      connectorRef: { connectorId, connectorVersion: "1.0.0" },
    }),
    health: health(),
  };
}

function connectorRegistration(provider: HostCapabilityProvider = "github", configuration: Record<string, unknown> = {}) {
  const connectorId = normalizeHostCapabilityConnectorId(provider)!;
  return {
    schemaVersion: 1,
    connector: connector({
      connectorId,
      displayName: `${provider} connector`,
      transport: "mock",
    }),
    health: health(),
    configuration,
  };
}

describe("Host Capability Operation[] factory", () => {
  it("requires an authenticated approver and server-binds descriptor approval provenance", async () => {
    const state = await fixture();
    try {
      const operations = operationsByName(makeHostCapabilityOps(state.root, {
        now: () => TEST_NOW_MS,
        settingsService: state.settingsService,
        environment: state.environment,
      }));
      const forged = descriptorRegistration();
      forged.descriptor.importProvenance.licenseReview.reviewedBy = "attacker/self";
      forged.descriptor.importProvenance.licenseReview.reviewedAt = "2020-01-01T00:00:00.000Z";
      forged.descriptor.importProvenance.approval.reviewedBy = "attacker/self";
      forged.descriptor.importProvenance.approval.reviewedAt = "2020-01-01T00:00:00.000Z";

      const agentContext: OperationContext = {
        ...state.operationContext,
        config: {
          ...state.operationContext.config,
          collaboration: {
            ...state.operationContext.config.collaboration,
            actor: "agent/attacker",
            role: "agent",
          },
        },
      };
      await assert.rejects(
        call(operations, agentContext, "host.descriptor.register", { registration: forged }),
        (error: any) => error?.code === -32010,
      );
      const unauthenticatedContext: OperationContext = {
        ...state.operationContext,
        config: { ...state.operationContext.config, collaboration: undefined },
      };
      await assert.rejects(
        call(operations, unauthenticatedContext, "host.descriptor.register", { registration: forged }),
        (error: any) => error?.code === -32010,
      );

      await call(operations, state.operationContext, "host.descriptor.register", { registration: forged });
      const read = await call(operations, state.operationContext, "host.descriptor.read", {
        descriptorId: "expert/code-review",
        descriptorVersion: "1.0.0",
      });
      assert.equal(read.descriptor.importProvenance.licenseReview.reviewedBy, "human/reviewer");
      assert.equal(read.descriptor.importProvenance.licenseReview.reviewedAt, TEST_NOW);
      assert.equal(read.descriptor.importProvenance.approval.reviewedBy, "human/reviewer");
      assert.equal(read.descriptor.importProvenance.approval.reviewedAt, TEST_NOW);
    } finally {
      rmSync(state.root, { recursive: true, force: true });
    }
  });

  it("requires an authenticated approver and server-binds connector approval provenance", async () => {
    const state = await fixture();
    try {
      const operations = operationsByName(makeHostCapabilityOps(state.root, {
        now: () => TEST_NOW_MS,
        settingsService: state.settingsService,
        environment: state.environment,
      }));
      const forged = connectorRegistration();
      forged.connector.importProvenance.licenseReview.reviewedBy = "attacker/self";
      forged.connector.importProvenance.licenseReview.reviewedAt = "2020-01-01T00:00:00.000Z";
      forged.connector.importProvenance.approval.reviewedBy = "attacker/self";
      forged.connector.importProvenance.approval.reviewedAt = "2020-01-01T00:00:00.000Z";
      const agentContext: OperationContext = {
        ...state.operationContext,
        config: {
          ...state.operationContext.config,
          collaboration: {
            ...state.operationContext.config.collaboration,
            actor: "agent/attacker",
            role: "agent",
          },
        },
      };
      await assert.rejects(
        call(operations, agentContext, "host.connector.register", { registration: forged }),
        (error: any) => error?.code === -32010,
      );

      await call(operations, state.operationContext, "host.connector.register", { registration: forged });
      const read = await call(operations, state.operationContext, "host.connector.read", {
        connectorId: "connector/github",
        connectorVersion: "1.0.0",
      });
      assert.equal(read.connector.importProvenance.licenseReview.reviewedBy, "human/reviewer");
      assert.equal(read.connector.importProvenance.licenseReview.reviewedAt, TEST_NOW);
      assert.equal(read.connector.importProvenance.approval.reviewedBy, "human/reviewer");
      assert.equal(read.connector.importProvenance.approval.reviewedAt, TEST_NOW);
    } finally {
      rmSync(state.root, { recursive: true, force: true });
    }
  });

  it("binds generic and canonical reviewed connector identities without tracker provider synthesis", async () => {
    for (const provider of ["reviewed-expert", "connector/reviewed-expert"]) {
      const state = await fixture({ provider });
      try {
        const operations = operationsByName(makeHostCapabilityOps(state.root, {
          now: () => TEST_NOW_MS,
          settingsService: state.settingsService,
          environment: state.environment,
        }));
        await call(operations, state.operationContext, "host.connector.register", {
          registration: connectorRegistration(provider),
        });
        const read = await call(operations, state.operationContext, "host.connector.read", {
          connectorId: "connector/reviewed-expert",
          connectorVersion: "1.0.0",
        });
        assert.equal(read.connector.connectorId, "connector/reviewed-expert");
        assert.equal(read.configuration.parameters.connectorId, "connector/reviewed-expert");
        assert.equal(read.configuration.parameters.provider, provider);
      } finally {
        rmSync(state.root, { recursive: true, force: true });
      }
    }
  });

  it("does not expand an issued grant when a new descriptor version is registered on the same connector", async () => {
    const state = await fixture();
    try {
      const operations = operationsByName(makeHostCapabilityOps(state.root, {
        now: () => TEST_NOW_MS,
        settingsService: state.settingsService,
        environment: state.environment,
      }));
      await call(operations, state.operationContext, "host.descriptor.register", {
        registration: descriptorRegistration(),
      });
      await call(operations, state.operationContext, "host.descriptor.register", {
        registration: descriptorRegistration("github", {
          descriptorVersion: "2.0.0",
          displayName: "Post-grant Expert Version",
        }),
      });
      await call(operations, state.operationContext, "host.connector.register", {
        registration: connectorRegistration(),
      });

      const search = await call(operations, state.operationContext, "host.proxy.search", state.access);
      assert.deepEqual(search.results.map((item: { descriptorVersion: string }) => item.descriptorVersion), ["1.0.0"]);
      const project = await call(operations, state.operationContext, "host.project", state.access);
      assert.deepEqual(project.descriptors.map((item: { descriptorVersion: string }) => item.descriptorVersion), ["1.0.0"]);
      await assert.rejects(call(operations, state.operationContext, "host.proxy.describe", {
        ...state.access,
        descriptorId: "expert/code-review",
        descriptorVersion: "2.0.0",
      }), (error: any) => error?.code === -32010);
    } finally {
      rmSync(state.root, { recursive: true, force: true });
    }
  });

  it("derives Linear, GitHub, and Gitea connector runtime configuration only from Settings", async () => {
    for (const item of PROVIDERS) {
      const state = await fixture();
      try {
        const environment = { [item.locator]: "provider-secret" };
        const service = createSettingsService({
          vaultPath: state.root,
          userDevicePath: join(state.root, `${item.provider}-device.json`),
          userDeviceId: `device/${item.provider}`,
          sessionId: `host-${item.provider}`,
          environment,
          clock: () => TEST_NOW,
        });
        await configureProvider(service, item.provider, { enabled: true, endpoint: item.endpoint, locator: item.locator });
        const operations = operationsByName(makeHostCapabilityOps(state.root, {
          now: () => TEST_NOW_MS, settingsService: service, environment,
        }));
        await call(operations, state.operationContext, "host.connector.register", {
          registration: connectorRegistration(item.provider),
        });
        const read = await call(operations, state.operationContext, "host.connector.read", {
          connectorId: `connector/${item.provider}`, connectorVersion: "1.0.0",
        });
        assert.equal(read.configuration.parameters.provider, item.provider);
        assert.equal(read.configuration.parameters.endpoint, item.endpoint);
        assert.equal(read.configuration.secretReference.locator, item.locator);
        assert.equal(read.configuration.parameters.settingsProvenance.connectorIdentity.source, "settings-assignment");
        assert.deepEqual(parseDefaultHostTransport(read), { transport: "http", endpoint: new URL(item.endpoint).toString() });
        assert.equal(JSON.stringify(read).includes("provider-secret"), false);
      } finally {
        rmSync(state.root, { recursive: true, force: true });
      }
    }
  });

  it("rejects client connector configuration, including reference-shaped authorization bypasses", async () => {
    const state = await fixture();
    try {
      const operations = operationsByName(makeHostCapabilityOps(state.root, {
        now: () => TEST_NOW_MS,
        settingsService: state.settingsService,
        environment: state.environment,
      }));
      await assert.rejects(call(operations, state.operationContext, "host.connector.register", {
        registration: connectorRegistration("github", {
          parameters: { endpoint: "https://attacker.invalid" },
          secretReference: { provider: "environment", locator: "ATTACKER_TOKEN" },
        }),
      }), (error: any) => error?.code === -32602);
      await call(operations, state.operationContext, "host.connector.register", {
        registration: connectorRegistration("github"),
      });
      const read = await call(operations, state.operationContext, "host.connector.read", {
        connectorId: "connector/github", connectorVersion: "1.0.0",
      });
      assert.equal(read.connector.transport, "http");
      assert.equal(read.configuration.secretReference.locator, "GITHUB_TOKEN");
    } finally {
      rmSync(state.root, { recursive: true, force: true });
    }
  });

  it("fails before opening a transport when the only legacy credential belongs to another provider", async () => {
    const state = await fixture({
      provider: "gitea",
      environment: {
        GITEA_TOKEN: "initial-gitea-secret",
        GITHUB_TOKEN: "wrong-provider-secret",
      },
    });
    let transportCalls = 0;
    try {
      const operations = operationsByName(makeHostCapabilityOps(state.root, {
        now: () => TEST_NOW_MS,
        settingsService: state.settingsService,
        environment: state.environment,
        transportFactory: async () => {
          transportCalls += 1;
          return { invoke: async () => null };
        },
      }));
      await call(operations, state.operationContext, "host.descriptor.register", {
        registration: descriptorRegistration("gitea"),
      });
      await call(operations, state.operationContext, "host.connector.register", {
        registration: connectorRegistration("gitea"),
      });
      const planned = await call(operations, state.operationContext, "host.assignment.plan", {
        ...state.access,
        requirement: requirement({ workRunId: state.workRunId }),
        policy: policy(),
        plannedAt: TEST_NOW,
      });
      const approved = await call(operations, state.operationContext, "host.assignment.approve", {
        ...state.access,
        planId: planned.plan.planId,
        expectedFingerprint: planned.planFingerprint,
        approvedBy: "human/reviewer",
      });
      const described = await call(operations, state.operationContext, "host.proxy.describe", {
        ...state.access,
        descriptorId: "expert/code-review",
        descriptorVersion: "1.0.0",
      });

      const current = await state.settingsService.scopesGet("session");
      const unset = await state.settingsService.assignmentUnset({
        scope: "session",
        key: "providers.host_capability.secret_ref",
        expectedRevision: current.document.revision,
        updatedBy: "host-test",
      });
      assert.equal(unset.status, "committed");
      delete state.environment.GITEA_TOKEN;

      const read = await call(operations, state.operationContext, "host.connector.read", {
        connectorId: "connector/gitea",
        connectorVersion: "1.0.0",
      });
      assert.equal(read.health.state, "unavailable");
      assert.notEqual(read.configuration.secretReference?.locator, "GITHUB_TOKEN");
      await assert.rejects(call(operations, state.operationContext, "host.proxy.invoke", {
        ...state.access,
        planId: approved.plan.planId,
        descriptorId: "expert/code-review",
        descriptorVersion: "1.0.0",
        operation: "expert.search",
        describedDescriptorFingerprint: described.description.descriptorFingerprint,
        input: {},
      }), (error: any) => error?.code === -32010);
      assert.equal(transportCalls, 0);
    } finally {
      rmSync(state.root, { recursive: true, force: true });
    }
  });

  it("loads binding, profile, Child Work Run, and grant server-side for every gated host path", async () => {
    const state = await fixture();
    let transportCalls = 0;
    let invokeCalls = 0;
    try {
      const operations = operationsByName(makeHostCapabilityOps(state.root, {
        now: () => TEST_NOW_MS,
        settingsService: state.settingsService,
        environment: state.environment,
        transportFactory: async registration => {
          transportCalls += 1;
          assert.equal(registration.configuration.secretReference?.locator, "GITHUB_TOKEN");
          return { invoke: async request => { invokeCalls += 1; return { workRunId: request.workRunId }; } };
        },
      }));
      await call(operations, state.operationContext, "host.descriptor.register", { registration: descriptorRegistration() });
      await call(operations, state.operationContext, "host.connector.register", { registration: connectorRegistration() });

      const planned = await call(operations, state.operationContext, "host.assignment.plan", {
        ...state.access,
        requirement: requirement({ workRunId: state.workRunId }),
        policy: policy(),
        plannedAt: TEST_NOW,
      });
      assert.equal(planned.plan.status, "matched");
      const approved = await call(operations, state.operationContext, "host.assignment.approve", {
        ...state.access,
        planId: planned.plan.planId,
        expectedFingerprint: planned.planFingerprint,
        approvedBy: "human/reviewer",
      });
      assert.equal(approved.plan.approval.status, "approved");
      assert.equal((await call(operations, state.operationContext, "host.assignment.read", {
        ...state.access, planId: planned.plan.planId,
      })).plan.planId, planned.plan.planId);
      assert.equal((await call(operations, state.operationContext, "host.proxy.search", {
        ...state.access, capability: "code.review",
      })).count, 1);
      const described = await call(operations, state.operationContext, "host.proxy.describe", {
        ...state.access, descriptorId: "expert/code-review", descriptorVersion: "1.0.0",
      });
      assert.equal((await call(operations, state.operationContext, "host.project", state.access)).descriptors.length, 1);
      await call(operations, state.operationContext, "host.proxy.invoke", {
        ...state.access,
        planId: planned.plan.planId,
        descriptorId: "expert/code-review",
        descriptorVersion: "1.0.0",
        operation: "expert.search",
        describedDescriptorFingerprint: described.description.descriptorFingerprint,
        input: { query: "governance" },
      });
      assert.equal(transportCalls, 1);
      assert.equal(invokeCalls, 1);

      const legacy = { ...state.access, binding: { enabled: true }, grant: { operations: ["expert.search"] } };
      const oldPayloads: Array<[string, Record<string, unknown>]> = [
        ["host.assignment.plan", { ...legacy, requirement: requirement({ workRunId: state.workRunId }), policy: policy() }],
        ["host.assignment.approve", { ...legacy, planId: planned.plan.planId, expectedFingerprint: planned.planFingerprint, approvedBy: "human/reviewer" }],
        ["host.assignment.read", { ...legacy, planId: planned.plan.planId }],
        ["host.proxy.search", legacy],
        ["host.proxy.describe", { ...legacy, descriptorId: "expert/code-review", descriptorVersion: "1.0.0" }],
        ["host.proxy.invoke", { ...legacy, planId: planned.plan.planId, descriptorId: "expert/code-review", descriptorVersion: "1.0.0", operation: "expert.search", describedDescriptorFingerprint: described.description.descriptorFingerprint }],
        ["host.project", legacy],
      ];
      for (const [name, params] of oldPayloads) {
        await assert.rejects(call(operations, state.operationContext, name, params), (error: any) => error?.code === -32602, name);
      }
    } finally {
      rmSync(state.root, { recursive: true, force: true });
    }
  });

  it("projects disabled and unresolved Secret Reference settings as fail-closed connector health", async () => {
    for (const options of [
      { enabled: false, withSecret: true, expected: "disabled" },
      { enabled: true, withSecret: false, expected: "unavailable" },
    ] as const) {
      const state = await fixture(options);
      let transportCalls = 0;
      try {
        const operations = operationsByName(makeHostCapabilityOps(state.root, {
          now: () => TEST_NOW_MS,
          settingsService: state.settingsService,
          environment: state.environment,
          transportFactory: async () => { transportCalls += 1; return { invoke: async () => null }; },
        }));
        await call(operations, state.operationContext, "host.connector.register", { registration: connectorRegistration() });
        const read = await call(operations, state.operationContext, "host.connector.read", {
          connectorId: "connector/github", connectorVersion: "1.0.0",
        });
        assert.equal(read.health.state, options.expected);
        const doctor = await call(operations, state.operationContext, "host.doctor");
        assert.equal(doctor.ok, false);
        assert.ok(doctor.findings.some((finding: { code: string }) => finding.code === "connector_unavailable"));
        assert.equal(transportCalls, 0);
      } finally {
        rmSync(state.root, { recursive: true, force: true });
      }
    }
  });
});
