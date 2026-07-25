import { createHash } from "node:crypto";

export const TOOLCHAIN_PROFILE_SCHEMA_VERSION = 1 as const;

export type ToolchainId =
  | "opencli"
  | "qmd"
  | "graphify"
  | "ollama"
  | "lightrag"
  | "raganything"
  | "mcp-sdk";

export type ToolchainHealth = "available" | "degraded" | "unavailable" | "disabled";
export type ToolchainCompatibility = "compatible" | "partial" | "incompatible" | "unknown";

export interface ToolchainProfileDefinition {
  id: ToolchainId;
  revision: string;
  invocationMode: "cli" | "http" | "sdk";
  versionRange: string;
  requiredCapabilities: readonly string[];
  optionalCapabilities: readonly string[];
}

export interface ToolchainProbeObservation {
  observedVersion?: string;
  capabilities?: readonly string[];
  diagnosticCodes?: readonly string[];
  command?: readonly string[];
  exitCode?: number;
  output?: string;
  timedOut?: boolean;
  disabled?: boolean;
}

export interface ToolchainProbe {
  /** Implementations must use discovery/read-only commands and perform no capture or mutation. */
  observe(definition: ToolchainProfileDefinition): Promise<ToolchainProbeObservation>;
}

export interface ToolchainProbeReceipt {
  schemaVersion: typeof TOOLCHAIN_PROFILE_SCHEMA_VERSION;
  toolchainId: ToolchainId;
  profileRevision: string;
  invocationMode: ToolchainProfileDefinition["invocationMode"];
  observedVersion?: string;
  compatibility: ToolchainCompatibility;
  health: ToolchainHealth;
  capabilities: string[];
  missingCapabilities: string[];
  diagnosticCodes: string[];
  evidence: {
    command?: string[];
    exitCode?: number;
    outputDigest?: string;
    timedOut?: boolean;
  };
  probedAt: string;
  expiresAt: string;
}

export const TOOLCHAIN_PROFILES: Readonly<Record<ToolchainId, readonly ToolchainProfileDefinition[]>> = Object.freeze({
  opencli: [profile("opencli", "opencli/1.8", "cli", ">=1.8 <2", [
    "version.structured", "command.list.structured", "definition.validate", "definition.verify",
    "doctor", "profiles.list", "plugins.list", "adapters.status",
  ], ["help.structured", "capture.web", "browser.bridge"])],
  qmd: [profile("qmd", "qmd/2.5", "cli", ">=2.5 <3", [
    "query.hybrid", "query.json", "query.intent", "query.explain", "uri.qmd",
    "collections.multiple", "index.health", "model.fingerprint",
  ], ["sdk.query"])],
  graphify: [
    profile("graphify", "graphify/0.9", "cli", ">=0.9 <1", [
      "graph.query", "graph.read", "graph.update", "result.normalized",
    ], ["graph.search", "graph.visualize"]),
    profile("graphify", "graphify/legacy", "cli", ">=0 <0.9", [
      "graph.query", "graph.read", "result.normalized",
    ], ["graph.update"]),
  ],
  ollama: [profile("ollama", "ollama/openai-embeddings-v1", "http", ">=0.3", [
    "embeddings.openai-compatible", "models.list", "model.fingerprint",
  ], [])],
  lightrag: [profile("lightrag", "lightrag/wrapper-v1", "http", "wrapper-defined", [
    "query", "health",
  ], ["documents.text", "documents.upload"])],
  raganything: [profile("raganything", "raganything/wrapper-v1", "http", "wrapper-defined", [
    "query", "health",
  ], ["documents.process"])],
  "mcp-sdk": [profile("mcp-sdk", "mcp-typescript-sdk/v1", "sdk", ">=1 <2", [
    "transport.stdio", "transport.http", "server.tools",
  ], ["v2.seam"])],
});

export class ToolchainCapabilityRegistry {
  readonly #cache = new Map<ToolchainId, ToolchainProbeReceipt>();

  constructor(
    private readonly probe: ToolchainProbe,
    private readonly ttlMs = 5 * 60_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  cached(id: ToolchainId): ToolchainProbeReceipt | undefined {
    const receipt = this.#cache.get(id);
    if (!receipt || Date.parse(receipt.expiresAt) <= this.now().getTime()) return undefined;
    return structuredClone(receipt);
  }

  async inspect(id: ToolchainId, force = false): Promise<ToolchainProbeReceipt> {
    if (!force) {
      const cached = this.cached(id);
      if (cached) return cached;
    }
    const definitions = TOOLCHAIN_PROFILES[id];
    const bootstrap = definitions[0]!;
    const observation = await this.probe.observe(bootstrap);
    const definition = selectDefinition(definitions, observation.observedVersion) ?? bootstrap;
    const receipt = makeReceipt(definition, observation, this.now(), this.ttlMs);
    this.#cache.set(id, receipt);
    return structuredClone(receipt);
  }

  invalidate(id?: ToolchainId): void {
    if (id) this.#cache.delete(id);
    else this.#cache.clear();
  }
}

export function makeReceipt(
  definition: ToolchainProfileDefinition,
  observation: ToolchainProbeObservation,
  now: Date,
  ttlMs: number,
): ToolchainProbeReceipt {
  const capabilities = [...new Set(observation.capabilities ?? [])].sort();
  const missingCapabilities = definition.requiredCapabilities
    .filter(capability => !capabilities.includes(capability));
  const versionMatches = versionSatisfies(observation.observedVersion, definition.versionRange);
  const diagnosticCodes = [...new Set([
    ...(observation.diagnosticCodes ?? []),
    ...(observation.timedOut ? ["TOOLCHAIN_PROBE_TIMEOUT"] : []),
  ])].sort();
  const compatibility: ToolchainCompatibility = observation.disabled || observation.timedOut
    ? "unknown"
    : !observation.observedVersion
      ? "unknown"
      : !versionMatches
        ? "incompatible"
        : missingCapabilities.length === 0
          ? "compatible"
          : "partial";
  const health: ToolchainHealth = observation.disabled
    ? "disabled"
    : observation.timedOut || (observation.exitCode !== undefined && observation.exitCode !== 0)
      ? "unavailable"
      : compatibility === "compatible"
        ? "available"
        : compatibility === "partial"
          ? "degraded"
          : "unavailable";
  return {
    schemaVersion: TOOLCHAIN_PROFILE_SCHEMA_VERSION,
    toolchainId: definition.id,
    profileRevision: definition.revision,
    invocationMode: definition.invocationMode,
    ...(observation.observedVersion ? { observedVersion: observation.observedVersion } : {}),
    compatibility,
    health,
    capabilities,
    missingCapabilities,
    diagnosticCodes,
    evidence: {
      ...(observation.command ? { command: redactCommand(observation.command) } : {}),
      ...(observation.exitCode === undefined ? {} : { exitCode: observation.exitCode }),
      ...(observation.output === undefined ? {} : { outputDigest: digest(observation.output) }),
      ...(observation.timedOut ? { timedOut: true } : {}),
    },
    probedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

function profile(
  id: ToolchainId,
  revision: string,
  invocationMode: ToolchainProfileDefinition["invocationMode"],
  versionRange: string,
  requiredCapabilities: readonly string[],
  optionalCapabilities: readonly string[],
): ToolchainProfileDefinition {
  return { id, revision, invocationMode, versionRange, requiredCapabilities, optionalCapabilities };
}

function selectDefinition(
  definitions: readonly ToolchainProfileDefinition[],
  observedVersion: string | undefined,
): ToolchainProfileDefinition | undefined {
  return definitions.find(definition => versionSatisfies(observedVersion, definition.versionRange));
}

function versionSatisfies(version: string | undefined, range: string): boolean {
  if (range === "wrapper-defined") return Boolean(version);
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const lower = />=(\d+)(?:\.(\d+))?/.exec(range);
  const upper = /<(\d+)(?:\.(\d+))?/.exec(range);
  if (lower && compareVersion(parsed, [Number(lower[1]), Number(lower[2] ?? 0)]) < 0) return false;
  if (upper && compareVersion(parsed, [Number(upper[1]), Number(upper[2] ?? 0)]) >= 0) return false;
  return true;
}

function parseVersion(value: string | undefined): [number, number] | undefined {
  const match = value?.match(/(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

function compareVersion(left: [number, number], right: [number, number]): number {
  return left[0] - right[0] || left[1] - right[1];
}

function redactCommand(command: readonly string[]): string[] {
  return command.map((part, index) => {
    const previous = command[index - 1]?.toLowerCase();
    if (previous && ["--token", "--api-key", "--password", "--secret", "--authorization"].includes(previous)) {
      return "[redacted]";
    }
    return part
      .replace(/^(--(?:token|api-key|password|secret|authorization))=.*/i, "$1=[redacted]")
      .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[redacted]@")
      .replace(/([?&](?:token|api[_-]?key|password|secret)=)[^&#\s]*/gi, "$1[redacted]")
      .replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s]+/gi, "$1[redacted]");
  });
}

function digest(value: string): string {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}
