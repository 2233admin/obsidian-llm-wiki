import { Buffer } from "node:buffer";
import { canonicalDigest, canonicalJson, deepClone } from "./canonical.js";
import { ContextBudgetError, DomainConflictError, DomainValidationError } from "./errors.js";
import { assertSafeSharedState } from "./security.js";
import type {
  ContextChunk,
  ContextChunkInput,
  ContextEnvelope,
  ContextEnvelopeCompileInput,
  ContextLayer,
  ContextLayerName,
  ContextOmission,
  JsonValue,
  ProvenanceRef,
} from "./types.js";
import {
  envelopeFingerprintMaterial,
  validateAgentProfile,
  validateContextChunk,
  validateContextEnvelope,
  validateMemoryRevision,
  validateProjectAgentBinding,
} from "./validation.js";

const LAYER_ORDER: ContextLayerName[] = [
  "platformKernel",
  "agentConstitution",
  "governedWorkingMemory",
  "runtimeEnvelope",
];

const EVICTION_ORDER: Record<ContextLayerName, number> = {
  runtimeEnvelope: 0,
  governedWorkingMemory: 1,
  agentConstitution: 2,
  platformKernel: 3,
};

export const TOKEN_ESTIMATOR = "utf8-bytes-div4/v1" as const;

export function estimateTokens(content: JsonValue): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(canonicalJson(content), "utf8") / 4));
}

export function compileContextEnvelope(rawInput: ContextEnvelopeCompileInput): ContextEnvelope {
  const input = deepClone(rawInput);
  assertSafeSharedState(input, "ContextEnvelopeCompileInput");
  validateCompileInput(input);

  const layers = new Map<ContextLayerName, ContextChunk[]>();
  layers.set("platformKernel", input.platformKernel.map((chunk) => buildChunk(chunk, true)));
  layers.set("agentConstitution", buildConstitutionChunks(input));
  layers.set("governedWorkingMemory", buildMemoryChunks(input));
  layers.set("runtimeEnvelope", buildRuntimeChunks(input));

  const allChunks = LAYER_ORDER.flatMap((name) => layers.get(name) ?? []);
  const duplicate = firstDuplicate(allChunks.map((chunk) => chunk.chunkId));
  if (duplicate) throw new DomainValidationError(`Context chunk IDs must be globally unique: ${duplicate}`);

  const mandatoryTokens = allChunks
    .filter((chunk) => chunk.mandatory)
    .reduce((sum, chunk) => sum + chunk.tokenCount, 0);
  if (mandatoryTokens > input.tokenBudget) throw new ContextBudgetError(mandatoryTokens, input.tokenBudget);

  let tokenCount = allChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
  const omissions: ContextOmission[] = [];
  const candidates = LAYER_ORDER.flatMap((layer) => (layers.get(layer) ?? [])
    .filter((chunk) => !chunk.mandatory)
    .map((chunk) => ({ layer, chunk })))
    .sort((left, right) =>
      EVICTION_ORDER[left.layer] - EVICTION_ORDER[right.layer]
      || left.chunk.priority - right.chunk.priority
      || left.chunk.chunkId.localeCompare(right.chunk.chunkId));

  for (const candidate of candidates) {
    if (tokenCount <= input.tokenBudget) break;
    layers.set(candidate.layer, (layers.get(candidate.layer) ?? []).filter((chunk) => chunk.chunkId !== candidate.chunk.chunkId));
    tokenCount -= candidate.chunk.tokenCount;
    omissions.push({
      layer: candidate.layer,
      chunkId: candidate.chunk.chunkId,
      reason: "token-budget",
      tokenCount: candidate.chunk.tokenCount,
      mandatory: false,
    });
  }

  const compiledLayers = LAYER_ORDER.map((name) => buildLayer(name, layers.get(name) ?? [])) as ContextEnvelope["layers"];
  const material: Omit<ContextEnvelope, "fingerprint"> = {
    schemaVersion: 1,
    envelopeId: input.envelopeId,
    compiledAt: input.compiledAt,
    modelLock: input.modelLock,
    tokenEstimator: TOKEN_ESTIMATOR,
    tokenBudget: input.tokenBudget,
    tokenCount,
    layers: compiledLayers,
    omissions,
  };
  const envelope: ContextEnvelope = {
    ...material,
    fingerprint: canonicalDigest(envelopeFingerprintMaterial(material as ContextEnvelope)),
  };
  return validateContextEnvelope(envelope);
}

function validateCompileInput(input: ContextEnvelopeCompileInput): void {
  if (!input.envelopeId || input.envelopeId !== input.envelopeId.trim()) {
    throw new DomainValidationError("Envelope ID must be a non-empty trimmed string", "ContextEnvelopeCompileInput.envelopeId");
  }
  if (!Number.isInteger(input.tokenBudget) || input.tokenBudget < 1) {
    throw new DomainValidationError("Token budget must be a positive integer", "ContextEnvelopeCompileInput.tokenBudget");
  }
  const profile = validateAgentProfile(input.profile);
  const binding = validateProjectAgentBinding(input.binding);
  const memory = validateMemoryRevision(input.memoryRevision);
  if (!binding.enabled) throw new DomainConflictError("Disabled Project Agent Binding cannot compile context", { bindingId: binding.bindingId });
  if (binding.profileId !== profile.profileId || binding.profileRevision !== profile.revision) {
    throw new DomainConflictError("Context Profile does not match the exact revision locked by the Binding", {
      bindingProfileId: binding.profileId,
      bindingProfileRevision: binding.profileRevision,
      profileId: profile.profileId,
      profileRevision: profile.revision,
    });
  }
  if (memory.projectId !== binding.projectId || memory.profileId !== binding.profileId) {
    throw new DomainConflictError("Approved memory does not belong to the bound Project and Profile", {
      memoryProjectId: memory.projectId,
      memoryProfileId: memory.profileId,
      bindingProjectId: binding.projectId,
      bindingProfileId: binding.profileId,
    });
  }
  const projectContextRefs = input.runtime?.projectContext?.provenance?.filter((reference) => reference.kind === "project") ?? [];
  if (projectContextRefs.length !== 1
    || projectContextRefs[0]!.id !== binding.projectId
    || projectContextRefs[0]!.fingerprint !== binding.projectContextFingerprint) {
    throw new DomainConflictError("Runtime Project Context provenance does not match the exact Project Context fingerprint locked by the Binding", {
      bindingProjectId: binding.projectId,
      bindingProjectContextFingerprint: binding.projectContextFingerprint,
      projectContextProvenance: projectContextRefs,
    });
  }
  if (!input.memoryRevisionLock
    || typeof input.memoryRevisionLock !== "object"
    || !Number.isInteger(input.memoryRevisionLock.revision)
    || input.memoryRevisionLock.revision < 1
    || typeof input.memoryRevisionLock.revisionId !== "string"
    || typeof input.memoryRevisionLock.fingerprint !== "string") {
    throw new DomainValidationError("A complete approved memory revision lock is required", "ContextEnvelopeCompileInput.memoryRevisionLock");
  }
  if (input.memoryRevisionLock.revisionId !== memory.revisionId
    || input.memoryRevisionLock.revision !== memory.revision
    || input.memoryRevisionLock.fingerprint !== memory.fingerprint) {
    throw new DomainConflictError("Approved memory does not match the current revision lock", {
      lockedRevisionId: input.memoryRevisionLock.revisionId,
      lockedRevision: input.memoryRevisionLock.revision,
      memoryRevisionId: memory.revisionId,
      memoryRevision: memory.revision,
    });
  }
  if (!Array.isArray(input.platformKernel) || input.platformKernel.length === 0) {
    throw new DomainValidationError("Platform kernel requires at least one governance chunk", "ContextEnvelopeCompileInput.platformKernel");
  }
}

function buildConstitutionChunks(input: ContextEnvelopeCompileInput): ContextChunk[] {
  const profileProvenance: ProvenanceRef[] = [{
    kind: "profile",
    id: input.profile.profileId,
    revision: input.profile.revision,
    fingerprint: canonicalDigest(input.profile),
  }];
  const bindingProvenance: ProvenanceRef[] = [{
    kind: "binding",
    id: input.binding.bindingId,
    revision: input.binding.revision,
    fingerprint: canonicalDigest(input.binding),
  }];
  return [
    buildChunk({
      chunkId: "agent-constitution/profile",
      content: asJsonValue({
        profileId: input.profile.profileId,
        profileRevision: input.profile.revision,
        role: input.profile.role,
        responsibilities: input.profile.responsibilities,
        capabilityClaims: input.profile.capabilityClaims,
        constitution: input.profile.constitution,
        defaultModelPolicy: input.profile.defaultModelPolicy,
      }),
      provenance: profileProvenance,
      priority: 100,
    }, true),
    buildChunk({
      chunkId: "agent-constitution/project-binding",
      content: asJsonValue({
        bindingId: input.binding.bindingId,
        bindingRevision: input.binding.revision,
        projectId: input.binding.projectId,
        projectContextFingerprint: input.binding.projectContextFingerprint,
        profileId: input.binding.profileId,
        profileRevision: input.binding.profileRevision,
        role: input.binding.role,
        memoryScopes: input.binding.memoryScopes,
        connectorGrantRefs: input.binding.connectorGrantRefs,
      }),
      provenance: bindingProvenance,
      priority: 100,
    }, true),
  ];
}

function buildMemoryChunks(input: ContextEnvelopeCompileInput): ContextChunk[] {
  const provenance: ProvenanceRef[] = [{
    kind: "memoryRevision",
    id: input.memoryRevision.revisionId,
    revision: input.memoryRevision.revision,
    fingerprint: input.memoryRevision.fingerprint,
  }];
  const chunks: ContextChunk[] = [buildChunk({
    chunkId: "governed-memory/governance",
    content: asJsonValue({
      revisionId: input.memoryRevision.revisionId,
      revision: input.memoryRevision.revision,
      protectedDirectives: input.memoryRevision.protectedDirectives,
      unresolvedConflicts: input.memoryRevision.unresolvedConflicts,
      approval: {
        proposalId: input.memoryRevision.approval.proposalId,
        policyVersion: input.memoryRevision.approval.policyVersion,
        policyResult: input.memoryRevision.approval.policyResult,
      },
    }),
    provenance,
    priority: 100,
  }, true)];

  for (const scope of input.binding.memoryScopes) {
    const section = input.memoryRevision.sections[scope];
    chunks.push(buildChunk({
      chunkId: `governed-memory/${scope}`,
      content: asJsonValue({ scope, section }),
      provenance,
      mandatory: false,
      priority: scope === "stableMemory" ? 70 : scope === "openItems" ? 60 : 50,
    }));
  }
  return chunks;
}

function buildRuntimeChunks(input: ContextEnvelopeCompileInput): ContextChunk[] {
  const runtime = input.runtime;
  const chunks: ContextChunk[] = [
    buildChunk({ ...runtime.projectContext, chunkId: `runtime/project/${runtime.projectContext.chunkId}` }, true),
    ...(runtime.workItem ? [buildChunk({ ...runtime.workItem, chunkId: `runtime/work-item/${runtime.workItem.chunkId}` })] : []),
    ...(runtime.workRun ? [buildChunk({ ...runtime.workRun, chunkId: `runtime/work-run/${runtime.workRun.chunkId}` })] : []),
    ...runtime.threadWindow.map((chunk) => buildChunk({ ...chunk, chunkId: `runtime/thread/${chunk.chunkId}` })),
    buildChunk({ ...runtime.settingsSnapshot, chunkId: `runtime/settings/${runtime.settingsSnapshot.chunkId}` }, true),
    ...runtime.deviceCapabilities.map((chunk) => buildChunk({ ...chunk, chunkId: `runtime/device/${chunk.chunkId}` })),
    ...runtime.capabilityGrants.map((chunk) => buildChunk({ ...chunk, chunkId: `runtime/grant/${chunk.chunkId}` })),
    ...(runtime.artifacts ?? []).map((chunk) => buildChunk({ ...chunk, chunkId: `runtime/artifact/${chunk.chunkId}` })),
  ];
  return chunks;
}

function buildChunk(input: ContextChunkInput, forceMandatory = false): ContextChunk {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new DomainValidationError("Context chunk input must be an object");
  const extras = Object.keys(input).filter((key) => !new Set(["chunkId", "content", "provenance", "mandatory", "priority"]).has(key));
  if (extras.length) throw new DomainValidationError(`Unknown Context chunk input fields: ${extras.join(", ")}`);
  if (!input.chunkId || input.chunkId !== input.chunkId.trim()) throw new DomainValidationError("Context chunk ID must be non-empty and trimmed");
  if (!Array.isArray(input.provenance)) throw new DomainValidationError("Context chunk provenance must be an array");
  if (input.mandatory !== undefined && typeof input.mandatory !== "boolean") throw new DomainValidationError("Context chunk mandatory must be boolean");
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 0)) throw new DomainValidationError("Context chunk priority must be a non-negative integer");
  assertJsonValue(input.content, `ContextChunkInput.${input.chunkId}.content`);
  assertSafeSharedState(input.content, `ContextChunkInput.${input.chunkId}.content`);
  const content = deepClone(input.content);
  return validateContextChunk({
    chunkId: input.chunkId,
    content,
    provenance: deepClone(input.provenance),
    mandatory: forceMandatory || input.mandatory === true,
    priority: input.priority ?? 50,
    tokenCount: estimateTokens(content),
    contentHash: canonicalDigest(content),
  });
}

function buildLayer(name: ContextLayerName, chunks: ContextChunk[]): ContextLayer {
  const provenanceByKey = new Map<string, ProvenanceRef>();
  for (const provenance of chunks.flatMap((chunk) => chunk.provenance)) {
    provenanceByKey.set(canonicalJson(provenance), deepClone(provenance));
  }
  const provenance = [...provenanceByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
  return {
    name,
    provenance,
    chunks,
    tokenCount: chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
    contentHash: canonicalDigest(chunks),
  };
}

function firstDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function asJsonValue(value: unknown): JsonValue {
  return deepClone(value) as JsonValue;
}

function assertJsonValue(value: unknown, path: string, seen = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DomainValidationError("Context content numbers must be finite", path);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new DomainValidationError("Context content must not contain cycles", path);
    seen.add(value);
    value.forEach((child, index) => assertJsonValue(child, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  if (!value || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new DomainValidationError("Context content must be JSON-compatible", path);
  }
  if (seen.has(value)) throw new DomainValidationError("Context content must not contain cycles", path);
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child === undefined) throw new DomainValidationError("Context content must not contain undefined", `${path}.${key}`);
    assertJsonValue(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}
