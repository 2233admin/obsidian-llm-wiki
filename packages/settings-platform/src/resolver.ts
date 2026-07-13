import { deepClone } from "./canonical.js";
import { getDefinition } from "./registry.js";
import { scopeMatchesContext, targetForScope, validateEffectiveValue } from "./validation.js";
import type {
  AssignmentProvenance,
  ConformanceFixture,
  ExplainCandidate,
  MutableSettingsScope,
  RedactedSettingValue,
  RuntimeContext,
  SecretStatus,
  SettingAssignment,
  SettingCandidate,
  SettingDefinition,
  SettingExplanation,
  SettingsDocument,
  SettingsRegistry,
  SettingsScope,
  SettingsSnapshot,
} from "./types.js";

export const SCOPE_PRECEDENCE: SettingsScope[] = [
  "session",
  "workspace-project",
  "vault",
  "user-device",
  "product",
];

export interface ResolveSettingsInput extends ConformanceFixture {
  registry: SettingsRegistry;
}

export interface ExplainSettingInput extends ResolveSettingsInput {
  key: string;
}

interface ResolvedCandidate extends SettingCandidate {
  assignment?: SettingAssignment;
}

export function resolveSettings(input: ResolveSettingsInput): SettingsSnapshot {
  const documents = participatingDocuments(input.documents, input.context);
  const sourceRevisions = buildSourceRevisions(input.registry, documents, input.context);
  const effective = input.registry.definitions.map(definition => {
    const candidates = valueCandidates(
      definition,
      documents,
      input.secretStatus ?? {},
      input.registry.registryVersion,
      input.createdAt,
    );
    const selected = candidates[0]!;
    return {
      key: definition.key,
      value: deepClone(selected.value),
      winningScope: selected.scope,
      assignmentProvenance: deepClone(selected.provenance),
      validation: validateEffectiveValue(definition, selected.value),
      applyMode: definition.applyMode,
      overriddenCandidates: candidates.slice(1).map(({ assignment: _assignment, ...candidate }) => deepClone(candidate)),
    };
  });
  const revisions = (["user-device", "vault", "workspace-project", "session"] as const)
    .map(scope => String(sourceRevisions[scope]?.revision ?? 0));
  const contextParts = [
    input.context.userDeviceId,
    input.context.vaultId ?? "-",
    input.context.workspaceProjectId ?? "-",
    input.context.sessionId ?? "-",
  ];
  return {
    snapshotId: ["settings", input.registry.registryVersion, ...contextParts, ...revisions].join(":"),
    registryVersion: input.registry.registryVersion,
    context: deepClone(input.context),
    effective,
    sourceRevisions,
    createdAt: input.createdAt,
  };
}

export function explainSetting(input: ExplainSettingInput): SettingExplanation {
  const definition = getDefinition(input.registry, input.key);
  if (!definition) throw new Error(`Unknown setting: ${input.key}`);
  const documents = participatingDocuments(input.documents, input.context);
  const candidates = valueCandidates(
    definition,
    documents,
    input.secretStatus ?? {},
    input.registry.registryVersion,
    input.createdAt,
  );
  const selected = candidates[0]!;
  const explanationCandidates: ExplainCandidate[] = [];
  let selectedSeen = false;
  for (const scope of SCOPE_PRECEDENCE) {
    if (scope === "product") {
      const product = candidates.find(candidate => candidate.scope === "product")!;
      explanationCandidates.push({
        scope,
        state: selected.scope === "product" ? "selected" : "overridden",
        revision: product.revision,
        value: deepClone(product.value),
        provenance: deepClone(product.provenance),
      });
      continue;
    }
    if (!definition.allowedScopes.includes(scope)) {
      explanationCandidates.push({ scope, state: "not-allowed" });
      continue;
    }
    const contextTarget = targetForScope(scope, input.context);
    if (!contextTarget) {
      explanationCandidates.push({ scope, state: "out-of-context" });
      continue;
    }
    const document = documents.get(scope);
    const candidate = candidates.find(item => item.scope === scope);
    if (!candidate) {
      explanationCandidates.push({ scope, state: "unset", revision: document?.revision ?? 0 });
      continue;
    }
    const state = selectedSeen ? "overridden" : "selected";
    if (state === "selected") selectedSeen = true;
    explanationCandidates.push({
      scope,
      state,
      revision: candidate.revision,
      value: deepClone(candidate.value),
      provenance: deepClone(candidate.provenance),
    });
  }
  return {
    key: definition.key,
    winningScope: selected.scope,
    value: deepClone(selected.value),
    candidates: explanationCandidates,
    validation: validateEffectiveValue(definition, selected.value),
  };
}

function participatingDocuments(
  documents: SettingsDocument[],
  context: RuntimeContext,
): Map<MutableSettingsScope, SettingsDocument> {
  const result = new Map<MutableSettingsScope, SettingsDocument>();
  for (const document of documents) {
    if (!scopeMatchesContext(document.scope, document.targetId, context)) continue;
    if (result.has(document.scope)) throw new Error(`Duplicate settings document for ${document.scope}`);
    result.set(document.scope, document);
  }
  return result;
}

function buildSourceRevisions(
  registry: SettingsRegistry,
  documents: Map<MutableSettingsScope, SettingsDocument>,
  context: RuntimeContext,
): SettingsSnapshot["sourceRevisions"] {
  const result: SettingsSnapshot["sourceRevisions"] = {
    product: { targetId: "settings-platform", revision: registry.registryVersion },
  };
  for (const scope of ["user-device", "vault", "workspace-project", "session"] as const) {
    const targetId = targetForScope(scope, context);
    if (!targetId) continue;
    result[scope] = { targetId, revision: documents.get(scope)?.revision ?? 0 };
  }
  return result;
}

function valueCandidates(
  definition: SettingDefinition,
  documents: Map<MutableSettingsScope, SettingsDocument>,
  secretStatus: Record<string, SecretStatus>,
  registryVersion: string,
  createdAt: string,
): ResolvedCandidate[] {
  const candidates: ResolvedCandidate[] = [];
  for (const scope of SCOPE_PRECEDENCE) {
    if (scope === "product") {
      candidates.push({
        scope,
        revision: registryVersion,
        value: productValue(definition, secretStatus),
        provenance: { actor: "registry", source: "registry/v1.json" },
      });
      continue;
    }
    if (!definition.allowedScopes.includes(scope)) continue;
    const document = documents.get(scope);
    if (!document) continue;
    const assignment = document.assignments.find(item => item.key === definition.key);
    if (!assignment || assignmentExpired(assignment, createdAt)) continue;
    candidates.push({
      scope,
      revision: document.revision,
      value: assignmentValue(definition, assignment, secretStatus),
      provenance: deepClone(assignment.provenance),
      assignment,
    });
  }
  return candidates;
}

function productValue(
  definition: SettingDefinition,
  secretStatus: Record<string, SecretStatus>,
): RedactedSettingValue {
  if (definition.valueType === "secret-reference") {
    const secretRef = definition.defaultSecretRef!;
    return { secretRef: deepClone(secretRef), status: statusFor(secretRef.provider, secretRef.locator, secretStatus) };
  }
  return deepClone(definition.defaultValue ?? null);
}

function assignmentValue(
  definition: SettingDefinition,
  assignment: SettingAssignment,
  secretStatus: Record<string, SecretStatus>,
): RedactedSettingValue {
  if (definition.valueType === "secret-reference") {
    const secretRef = assignment.secretRef ?? definition.defaultSecretRef!;
    return { secretRef: deepClone(secretRef), status: statusFor(secretRef.provider, secretRef.locator, secretStatus) };
  }
  return deepClone(assignment.value ?? null);
}

function statusFor(
  provider: string,
  locator: string,
  secretStatus: Record<string, SecretStatus>,
): SecretStatus {
  return secretStatus[`${provider}:${locator}`] ?? "missing";
}

function assignmentExpired(assignment: SettingAssignment, createdAt: string): boolean {
  return assignment.expiresAt !== undefined && Date.parse(assignment.expiresAt) <= Date.parse(createdAt);
}
