/**
 * Toolchain Capability Profile settings helpers.
 *
 * Builds redacted, host-neutral profile views from the Settings snapshot plus
 * optional probe receipts. Never returns credential material or private paths.
 */

import { createHash } from "node:crypto";
import { basename } from "node:path";

import type {
  EffectiveSetting,
  HealthState,
  SettingsSnapshot,
  ToolchainCapabilityProfileView,
  ToolchainDeviceBinding,
  ToolchainFieldProvenance,
  ToolchainProbeReceiptInput,
  ToolchainSemanticProfile,
  ValidationIssue,
} from "./types.js";

export const TOOLCHAIN_PROVIDER_IDS = [
  "opencli",
  "qmd",
  "graphify",
  "ollama",
  "lightrag",
  "raganything",
  "mcp-sdk",
] as const;

export type ToolchainProviderId = (typeof TOOLCHAIN_PROVIDER_IDS)[number];

export const BUILT_IN_EMBEDDING_PROFILE_IDS = [
  "ollama/bge-m3",
  "ollama/qwen3-embedding:0.6b",
] as const;

export const INVOCATION_MODES = ["filesystem", "cli", "http", "sdk"] as const;

const SENSITIVE_QUERY_RE = /(api[_-]?key|token|secret|password|auth|access[_-]?key)=([^&#]*)/gi;
const USERINFO_RE = /\/\/([^/@]+)@/g;

export function isToolchainProviderId(value: string): value is ToolchainProviderId {
  return (TOOLCHAIN_PROVIDER_IDS as readonly string[]).includes(value);
}

export function redactExecutable(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const base = basename(trimmed.replace(/\\/g, "/"));
  return base || "[redacted-executable]";
}

export function redactEndpoint(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    if (url.search) {
      url.search = url.search.replace(SENSITIVE_QUERY_RE, "$1=[redacted]");
    }
    url.hash = "";
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.origin}${path}${url.search}`.replace(/\/$/, "") || url.origin;
  } catch {
    return trimmed
      .replace(USERINFO_RE, "//[redacted]@")
      .replace(SENSITIVE_QUERY_RE, "$1=[redacted]");
  }
}

export function endpointHasCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password) || SENSITIVE_QUERY_RE.test(url.search);
  } catch {
    return /\/\/[^/@]+@/.test(value) || SENSITIVE_QUERY_RE.test(value);
  }
}

export function embeddingFingerprintDigest(input: {
  profileId: string;
  providerId: string;
  endpointIdentity: string;
  modelId: string;
  dimensions?: number;
  adapterSchemaVersion: string;
}): string {
  const canonical = JSON.stringify({
    schemaVersion: 1,
    profileId: input.profileId,
    providerId: input.providerId,
    endpointIdentity: input.endpointIdentity,
    modelId: input.modelId,
    ...(input.dimensions === undefined ? {} : { dimensions: input.dimensions }),
    adapterSchemaVersion: input.adapterSchemaVersion,
  });
  return "sha256:" + createHash("sha256").update(canonical).digest("hex");
}

function effectiveValue(snapshot: SettingsSnapshot, key: string): unknown {
  return snapshot.effective.find(item => item.key === key)?.value;
}

function effectiveSetting(snapshot: SettingsSnapshot, key: string): EffectiveSetting | undefined {
  return snapshot.effective.find(item => item.key === key);
}

function fieldProvenance(
  snapshot: SettingsSnapshot,
  key: string,
  path: string,
): ToolchainFieldProvenance {
  const setting = effectiveSetting(snapshot, key);
  if (!setting) {
    return { source: "product-default", path };
  }
  if (setting.winningScope === "product") {
    return { source: "product-default", path, scope: "product" };
  }
  const source = setting.assignmentProvenance.source === "legacy-environment"
    || setting.assignmentProvenance.source.startsWith("legacy")
    ? "legacy-environment"
    : "settings-assignment";
  return {
    source,
    path,
    scope: setting.winningScope,
    actor: setting.assignmentProvenance.actor,
    detail: setting.assignmentProvenance.source,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function profileFor(
  profiles: Record<string, unknown>,
  providerId: string,
): ToolchainSemanticProfile {
  const raw = asRecord(profiles[providerId]);
  return {
    invocationMode: typeof raw.invocationMode === "string" ? raw.invocationMode : "cli",
    versionPolicy: typeof raw.versionPolicy === "string" ? raw.versionPolicy : "",
    requiredFeatures: asStringList(raw.requiredFeatures),
    timeoutMs: typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs) ? raw.timeoutMs : 30_000,
    profileRevision: typeof raw.profileRevision === "string" ? raw.profileRevision : `${providerId}/unknown`,
    ...(typeof raw.indexId === "string" ? { indexId: raw.indexId } : {}),
    ...(Array.isArray(raw.collectionIds)
      ? { collectionIds: raw.collectionIds.filter((item): item is string => typeof item === "string") }
      : {}),
  };
}

function deviceFor(
  bindings: Record<string, unknown>,
  providerId: string,
): ToolchainDeviceBinding {
  const raw = asRecord(bindings[providerId]);
  return {
    executable: typeof raw.executable === "string" ? raw.executable : "",
    endpoint: typeof raw.endpoint === "string" ? raw.endpoint : "",
  };
}

function mapHealth(
  selected: boolean,
  profile: ToolchainSemanticProfile,
  device: ToolchainDeviceBinding,
  probe?: ToolchainProbeReceiptInput,
): { health: HealthState; compatibility: ToolchainCapabilityProfileView["compatibility"]; missing: string[]; codes: string[] } {
  if (!selected) {
    return { health: "disabled", compatibility: "unknown", missing: [], codes: [] };
  }
  if (probe?.disabled) {
    return { health: "disabled", compatibility: "unknown", missing: [], codes: probe.diagnosticCodes ?? [] };
  }
  if (probe?.timedOut) {
    return {
      health: "unavailable",
      compatibility: "unknown",
      missing: profile.requiredFeatures,
      codes: [...new Set([...(probe.diagnosticCodes ?? []), "TOOLCHAIN_PROBE_TIMEOUT"])],
    };
  }
  const needsExecutable = profile.invocationMode === "cli";
  const needsEndpoint = profile.invocationMode === "http";
  if (needsExecutable && !device.executable.trim()) {
    return {
      health: "unavailable",
      compatibility: "unknown",
      missing: profile.requiredFeatures,
      codes: ["PROVIDER_UNAVAILABLE"],
    };
  }
  if (needsEndpoint && !device.endpoint.trim()) {
    return {
      health: "unavailable",
      compatibility: "unknown",
      missing: profile.requiredFeatures,
      codes: ["PROVIDER_UNAVAILABLE"],
    };
  }
  if (device.endpoint && endpointHasCredentials(device.endpoint)) {
    return {
      health: "unavailable",
      compatibility: "incompatible",
      missing: profile.requiredFeatures,
      codes: ["SENSITIVE_ERROR_REDACTED"],
    };
  }
  if (!probe) {
    // Configuration is present; live capability evidence is deferred.
    return {
      health: "degraded",
      compatibility: "partial",
      missing: profile.requiredFeatures,
      codes: ["CAPABILITY_MISSING"],
    };
  }
  const observed = new Set(probe.capabilities ?? []);
  const missing = profile.requiredFeatures.filter(feature => !observed.has(feature));
  if (missing.length === 0) {
    return {
      health: "available",
      compatibility: "compatible",
      missing: [],
      codes: probe.diagnosticCodes ?? [],
    };
  }
  return {
    health: "degraded",
    compatibility: "partial",
    missing,
    codes: [...new Set([...(probe.diagnosticCodes ?? []), "CAPABILITY_MISSING"])],
  };
}

export function buildToolchainCapabilityProfiles(
  snapshot: SettingsSnapshot,
  options: {
    checkedAt: string;
    probes?: Partial<Record<string, ToolchainProbeReceiptInput>>;
    nowMs?: number;
  },
): ToolchainCapabilityProfileView[] {
  const selection = asStringList(effectiveValue(snapshot, "toolchain.provider_selection"));
  const profiles = asRecord(effectiveValue(snapshot, "toolchain.capability_profiles"));
  const bindings = asRecord(effectiveValue(snapshot, "toolchain.device_bindings"));
  const indexProfiles = asRecord(effectiveValue(snapshot, "embeddings.index_profiles"));
  const defaultProfile = effectiveValue(snapshot, "embeddings.default_profile");
  const embeddingEndpoint = typeof effectiveValue(snapshot, "embeddings.endpoint") === "string"
    ? String(effectiveValue(snapshot, "embeddings.endpoint"))
    : "";
  const recordedFingerprints = asRecord(effectiveValue(snapshot, "embeddings.index_fingerprints"));
  const nowMs = options.nowMs ?? Date.parse(options.checkedAt);

  const providerIds = [
    ...new Set([
      ...selection.filter(isToolchainProviderId),
      ...Object.keys(profiles).filter(isToolchainProviderId),
      ...Object.keys(bindings).filter(isToolchainProviderId),
    ]),
  ].sort();

  return providerIds.map(providerId => {
    const selected = selection.includes(providerId);
    const semantic = profileFor(profiles, providerId);
    const device = deviceFor(bindings, providerId);
    const probe = options.probes?.[providerId];
    const mapped = mapHealth(selected, semantic, device, probe);
    const probedAt = probe?.probedAt;
    const expiresAt = probe?.expiresAt;
    const probeAgeMs = probedAt && Number.isFinite(Date.parse(probedAt))
      ? Math.max(0, nowMs - Date.parse(probedAt))
      : null;

    const embedding = providerId === "ollama"
      ? buildEmbeddingFingerprintView(
        typeof defaultProfile === "string" ? defaultProfile : "ollama/bge-m3",
        embeddingEndpoint,
        indexProfiles,
        recordedFingerprints,
      )
      : undefined;

    const view: ToolchainCapabilityProfileView = {
      schemaVersion: 1,
      providerId,
      profileRevision: semantic.profileRevision,
      invocationMode: semantic.invocationMode,
      versionPolicy: semantic.versionPolicy,
      selected,
      compatibility: mapped.compatibility,
      health: mapped.health,
      requiredFeatures: [...semantic.requiredFeatures].sort(),
      capabilities: [...new Set(probe?.capabilities ?? [])].sort(),
      missingCapabilities: [...mapped.missing].sort(),
      diagnosticCodes: [...mapped.codes].sort(),
      timeoutMs: semantic.timeoutMs,
      ...(semantic.indexId !== undefined ? { indexId: semantic.indexId } : {}),
      ...(semantic.collectionIds ? { collectionIds: [...semantic.collectionIds] } : {}),
      redactedExecutable: redactExecutable(device.executable),
      redactedEndpoint: redactEndpoint(device.endpoint || embeddingEndpoint),
      ...(probe?.observedVersion ? { observedVersion: probe.observedVersion } : {}),
      ...(probedAt ? { probedAt } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      probeAgeMs,
      configurationProvenance: {
        selection: fieldProvenance(snapshot, "toolchain.provider_selection", "toolchain.provider_selection"),
        profile: fieldProvenance(snapshot, "toolchain.capability_profiles", `toolchain.capability_profiles.${providerId}`),
        device: fieldProvenance(snapshot, "toolchain.device_bindings", `toolchain.device_bindings.${providerId}`),
        ...(providerId === "ollama"
          ? {
              embeddingProfile: fieldProvenance(snapshot, "embeddings.default_profile", "embeddings.default_profile"),
              embeddingEndpoint: fieldProvenance(snapshot, "embeddings.endpoint", "embeddings.endpoint"),
            }
          : {}),
      },
      ...(embedding ? { embeddingFingerprint: embedding } : {}),
      checkedAt: options.checkedAt,
      snapshotId: snapshot.snapshotId,
    };
    return view;
  });
}

function buildEmbeddingFingerprintView(
  profileId: string,
  endpoint: string,
  indexProfiles: Record<string, unknown>,
  recorded: Record<string, unknown>,
): ToolchainCapabilityProfileView["embeddingFingerprint"] {
  const modelId = profileId.includes("/")
    ? profileId.slice(profileId.indexOf("/") + 1)
    : profileId;
  const endpointIdentity = redactEndpoint(endpoint) || "endpoint/unconfigured";
  const digest = embeddingFingerprintDigest({
    profileId,
    providerId: "ollama",
    endpointIdentity,
    modelId,
    dimensions: 1024,
    adapterSchemaVersion: "openai-compatible/v1",
  });
  const indexBindings = Object.entries(indexProfiles)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([indexId, boundProfile]) => ({ indexId, profileId: boundProfile }));
  const mismatches = indexBindings
    .filter(binding => {
      const observed = asRecord(recorded[binding.indexId]);
      const observedDigest = typeof observed.digest === "string" ? observed.digest : "";
      if (!observedDigest) return false;
      const expected = embeddingFingerprintDigest({
        profileId: binding.profileId,
        providerId: "ollama",
        endpointIdentity,
        modelId: binding.profileId.includes("/")
          ? binding.profileId.slice(binding.profileId.indexOf("/") + 1)
          : binding.profileId,
        dimensions: 1024,
        adapterSchemaVersion: "openai-compatible/v1",
      });
      return observedDigest !== expected;
    })
    .map(binding => binding.indexId);

  return {
    profileId,
    providerId: "ollama",
    endpointIdentity,
    modelId,
    dimensions: 1024,
    adapterSchemaVersion: "openai-compatible/v1",
    digest,
    indexBindings,
    mismatchedIndexIds: mismatches,
  };
}

/** Legacy environment keys that map to Toolchain / embedding Settings. */
export const LEGACY_TOOLCHAIN_ENV_MAP: ReadonlyArray<{
  env: string;
  targetKey: string;
  summary: string;
}> = [
  { env: "VAULT_MIND_ADAPTERS", targetKey: "adapters.enabled", summary: "Migrate enabled adapters into adapters.enabled." },
  { env: "VAULT_MIND_QMD_BINARY", targetKey: "toolchain.device_bindings", summary: "Migrate QMD executable into toolchain.device_bindings.qmd.executable." },
  { env: "VAULT_MIND_GRAPHIFY_BINARY", targetKey: "toolchain.device_bindings", summary: "Migrate Graphify executable into toolchain.device_bindings.graphify.executable." },
  { env: "VAULT_MIND_EMBED_URL", targetKey: "embeddings.endpoint", summary: "Migrate embedding endpoint into embeddings.endpoint." },
  { env: "VAULT_MIND_EMBED_MODEL", targetKey: "embeddings.default_profile", summary: "Migrate embedding model into embeddings.default_profile or embeddings.index_profiles." },
  { env: "VAULT_MIND_EMBED_PROFILE", targetKey: "embeddings.default_profile", summary: "Migrate embedding profile id into embeddings.default_profile." },
  { env: "OLLAMA_HOST", targetKey: "embeddings.endpoint", summary: "Migrate Ollama host into embeddings.endpoint / toolchain.device_bindings.ollama.endpoint." },
  { env: "OLLAMA_EMBED_MODEL", targetKey: "embeddings.default_profile", summary: "Migrate Ollama embed model into embeddings.default_profile." },
  { env: "OPENCLI_BIN", targetKey: "toolchain.device_bindings", summary: "Migrate OpenCLI executable into toolchain.device_bindings.opencli.executable." },
  { env: "QMD_BIN", targetKey: "toolchain.device_bindings", summary: "Migrate QMD executable into toolchain.device_bindings.qmd.executable." },
];

export function collectLegacyToolchainDiagnostics(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const entry of LEGACY_TOOLCHAIN_ENV_MAP) {
    const raw = environment[entry.env];
    if (typeof raw !== "string" || !raw.trim()) continue;
    issues.push({
      code: "legacy-toolchain-env",
      severity: "warning",
      message: `Legacy environment ${entry.env} is set; ${entry.summary}`,
      key: entry.targetKey,
      remediation: `Copy the non-secret value into ${entry.targetKey} through Settings, then unset ${entry.env} after verification.`,
    });
  }
  return issues;
}

export function assertNoSensitiveReflection(payload: unknown): void {
  const text = JSON.stringify(payload);
  if (!text) return;
  if (/(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._~+/=-]+|\/\/[^/@\s]+:[^/@\s]+@)/i.test(text)) {
    throw new Error("Sensitive material reflected in toolchain diagnostic payload");
  }
}
