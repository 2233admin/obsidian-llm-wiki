export const AGENT_WIKI_CONTRACT_VERSION = 1 as const;

export const PROVIDER_IDS = [
  "filesystem",
  "opencli",
  "qmd",
  "graphify",
  "ollama",
  "openai-compatible",
  "lightrag",
  "raganything",
  "hindsight",
  "mcp-sdk",
] as const;

export const DIAGNOSTIC_CODES = [
  "ARTIFACT_MISSING",
  "CAPABILITY_MISSING",
  "FINGERPRINT_MISMATCH",
  "INCOMPATIBLE_OUTPUT",
  "LEASE_EXPIRED",
  "LEGACY_UNKNOWN_PROVENANCE",
  "MAINTENANCE_FAILED",
  "MISSING_PROVENANCE",
  "PARTIAL_RESULT",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "SENSITIVE_ERROR_REDACTED",
  "STALE_PROJECTION",
  "TOOLCHAIN_OUTPUT_INVALID",
  "TOOLCHAIN_PROBE_TIMEOUT",
  "UNCHANGED_CONTENT",
] as const;

export const EVIDENCE_TIERS = ["compiled", "raw-evidence", "adapter-evidence"] as const;
export const FRESHNESS_STATES = ["fresh", "stale", "unknown", "incompatible"] as const;
export const CAPABILITY_NAMES = [
  "adapters.status",
  "browser.bridge",
  "capture.filesystem",
  "capture.remote.structured",
  "capture.web",
  "command.list.structured",
  "definition.validate",
  "definition.verify",
  "doctor",
  "embedding.generate",
  "embeddings.openai-compatible",
  "graph.query",
  "health",
  "help.structured",
  "index.health",
  "ingest.verify",
  "media.transcribe",
  "model.fingerprint",
  "plugins.list",
  "profiles.list",
  "query",
  "query.explain",
  "query.hybrid",
  "query.intent",
  "query.lexical",
  "query.semantic",
  "result.normalized",
  "server.tools",
  "toolchain.doctor",
  "transport.stdio",
  "uri.qmd",
  "version.structured",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];
export type FreshnessState = (typeof FRESHNESS_STATES)[number];
export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

export interface EmbeddingFingerprint {
  schemaVersion: typeof AGENT_WIKI_CONTRACT_VERSION;
  providerId: ProviderId;
  endpointIdentity: string;
  modelId: string;
  dimensions?: number;
  adapterSchemaVersion: string;
  digest: `sha256:${string}`;
}

export interface ExecutionReceipt {
  schemaVersion: typeof AGENT_WIKI_CONTRACT_VERSION;
  receiptId: string;
  operation: string;
  status: "succeeded" | "partial" | "failed" | "skipped";
  startedAt: string;
  completedAt: string;
  outputDigests: string[];
  diagnosticCodes: DiagnosticCode[];
  providerId?: ProviderId;
  profileRevision?: string;
}

export interface ToolchainCapabilityProfile {
  schemaVersion: typeof AGENT_WIKI_CONTRACT_VERSION;
  providerId: ProviderId;
  profileRevision: string;
  invocationMode: "filesystem" | "cli" | "http" | "sdk";
  compatibility: "compatible" | "partial" | "incompatible" | "unknown";
  health: "available" | "degraded" | "unavailable" | "disabled";
  capabilities: CapabilityName[];
  missingCapabilities: CapabilityName[];
  diagnosticCodes: DiagnosticCode[];
  observedVersion?: string;
  probedAt: string;
  expiresAt: string;
}

export interface IngestRun {
  schemaVersion: typeof AGENT_WIKI_CONTRACT_VERSION;
  runId: string;
  idempotencyKey: string;
  sourceId: string;
  sourceRevision: string;
  requestedOperation: string;
  profileRevision: string;
  state: "planned" | "running" | "paused" | "succeeded" | "partial" | "failed";
  completedStages: string[];
  receiptIds: string[];
  createdAt: string;
  updatedAt: string;
  lease?: { owner: string; acquiredAt: string; expiresAt: string };
}

export interface ContributionManifest {
  schemaVersion: typeof AGENT_WIKI_CONTRACT_VERSION;
  manifestId: string;
  sourceId: string;
  sourceRevision: string;
  compilerSchemaVersion: string;
  active: boolean;
  contributionIds: string[];
  affectedConceptKeys: string[];
  contentDigest: string;
  createdAt: string;
}

export interface MaintenanceQueueEntry {
  schemaVersion: typeof AGENT_WIKI_CONTRACT_VERSION;
  entryId: string;
  sourceIds: string[];
  topicKeys: string[];
  dirtyReasons: string[];
  earliestRunAt: string;
  freshnessDeadline: string;
  attempts: number;
  state: "pending" | "leased" | "retry" | "quarantined" | "completed";
  receiptIds: string[];
  lease?: { owner: string; acquiredAt: string; expiresAt: string };
}

export interface QueryTrace {
  schemaVersion: typeof AGENT_WIKI_CONTRACT_VERSION;
  traceId: string;
  intent?: string;
  detail?: string;
  selectedTiers: EvidenceTier[];
  freshness: FreshnessState;
  normalizedIdentifiers: string[];
  providerIds: ProviderId[];
  diagnosticCodes: DiagnosticCode[];
  fallbacks: string[];
  createdAt: string;
}
