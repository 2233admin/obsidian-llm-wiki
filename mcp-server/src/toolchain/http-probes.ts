import type {
  ToolchainId,
  ToolchainProbe,
  ToolchainProbeObservation,
  ToolchainProfileDefinition,
} from "./compatibility.js";

export interface HttpToolchainProbeConfig {
  endpoint?: string;
  apiKey?: string;
  timeoutMs?: number;
  disabled?: boolean;
  observedVersion?: string;
  versionPath?: string | false;
  healthPath?: string;
  modelsPath?: string;
  embeddingModel?: string;
  modelFingerprint?: string;
}

export type HttpToolchainProbeConfigs = Partial<Record<
  Extract<ToolchainId, "ollama" | "lightrag" | "raganything">,
  HttpToolchainProbeConfig
>>;

/** Side-effect-free HTTP compatibility probes for embedding and wrapper providers. */
export class HttpToolchainProbe implements ToolchainProbe {
  constructor(
    private readonly configs: HttpToolchainProbeConfigs,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async observe(definition: ToolchainProfileDefinition): Promise<ToolchainProbeObservation> {
    if (!isHttpToolchain(definition.id)) {
      return { diagnosticCodes: ["TOOLCHAIN_PROBE_UNSUPPORTED"], exitCode: 1 };
    }
    const config = this.configs[definition.id];
    if (config?.disabled) return { disabled: true };
    if (!config?.endpoint) {
      return { diagnosticCodes: ["PROVIDER_ENDPOINT_MISSING"], exitCode: 1 };
    }
    return definition.id === "ollama"
      ? this.observeEmbedding(config)
      : this.observeWrapper(definition.id, config);
  }

  private async observeEmbedding(config: HttpToolchainProbeConfig): Promise<ToolchainProbeObservation> {
    const command = ["GET", config.versionPath === false ? "(configured-version)" : normalizePath(config.versionPath ?? "/api/version"), "+", "GET", normalizePath(config.modelsPath ?? "/v1/models")];
    try {
      let version = config.observedVersion;
      if (config.versionPath !== false) {
        const versionResponse = await this.getJson(config, config.versionPath ?? "/api/version");
        if (!versionResponse.ok) return httpFailure(command, versionResponse.status);
        version ??= stringValue(versionResponse.body, "version");
      }
      const modelsResponse = await this.getJson(config, config.modelsPath ?? "/v1/models");
      if (!modelsResponse.ok) return httpFailure(command, modelsResponse.status);
      const models = modelIds(modelsResponse.body);
      if (!models) {
        return { observedVersion: version, command, exitCode: 0, diagnosticCodes: ["TOOLCHAIN_OUTPUT_INVALID"] };
      }
      const capabilities = ["embeddings.openai-compatible", "models.list"];
      const diagnosticCodes: string[] = [];
      if (config.embeddingModel && !models.includes(config.embeddingModel)) {
        diagnosticCodes.push("EMBEDDING_MODEL_MISSING");
      } else if (config.modelFingerprint) {
        capabilities.push("model.fingerprint");
      }
      return {
        observedVersion: version,
        capabilities,
        diagnosticCodes,
        command,
        exitCode: 0,
        output: JSON.stringify({ modelCount: models.length, selectedModelPresent: !config.embeddingModel || models.includes(config.embeddingModel) }),
      };
    } catch (error) {
      return probeException(command, error);
    }
  }

  private async observeWrapper(
    id: "lightrag" | "raganything",
    config: HttpToolchainProbeConfig,
  ): Promise<ToolchainProbeObservation> {
    const path = normalizePath(config.healthPath ?? "/health");
    const command = ["GET", path];
    try {
      const response = await this.getJson(config, path);
      if (!response.ok) return httpFailure(command, response.status);
      if (!response.body || typeof response.body !== "object" || Array.isArray(response.body)) {
        return { command, exitCode: 0, diagnosticCodes: ["TOOLCHAIN_OUTPUT_INVALID"] };
      }
      const body = response.body as Record<string, unknown>;
      const reported = stringArray(body.capabilities ?? body.features);
      const endpoints = stringArray(body.endpoints);
      const capabilities = new Set<string>(["health"]);
      for (const capability of reported) capabilities.add(capability);
      if (reported.includes("query") || endpoints.some(value => /(^|\/)query(?:$|\/)/.test(value))) {
        capabilities.add("query");
      }
      if (id === "lightrag") {
        if (reported.includes("documents.text") || endpoints.includes("/documents/text")) capabilities.add("documents.text");
        if (reported.includes("documents.upload") || endpoints.includes("/documents/upload")) capabilities.add("documents.upload");
      } else if (reported.includes("documents.process") || endpoints.includes("/process_document")) {
        capabilities.add("documents.process");
      }
      return {
        observedVersion: config.observedVersion ?? stringValue(body, "version") ?? "wrapper-defined",
        capabilities: [...capabilities].sort(),
        command,
        exitCode: 0,
        output: JSON.stringify({ status: stringValue(body, "status") ?? "ok", capabilityCount: capabilities.size }),
      };
    } catch (error) {
      return probeException(command, error);
    }
  }

  private async getJson(
    config: HttpToolchainProbeConfig,
    path: string,
  ): Promise<{ ok: boolean; status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 5_000);
    try {
      const response = await this.fetchImpl(joinUrl(config.endpoint!, path), {
        method: "GET",
        headers: {
          accept: "application/json",
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        signal: controller.signal,
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      return { ok: response.ok, status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }
}

function isHttpToolchain(id: ToolchainId): id is "ollama" | "lightrag" | "raganything" {
  return id === "ollama" || id === "lightrag" || id === "raganything";
}

function modelIds(body: unknown): string[] | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = body as Record<string, unknown>;
  const records = Array.isArray(value.data) ? value.data : Array.isArray(value.models) ? value.models : undefined;
  if (!records) return undefined;
  return records.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const id = record.id ?? record.name ?? record.model;
    return typeof id === "string" ? [id] : [];
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function normalizePath(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

function joinUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, "")}${normalizePath(path)}`;
}

function httpFailure(command: string[], status: number): ToolchainProbeObservation {
  return { command, exitCode: status, diagnosticCodes: ["PROVIDER_UNAVAILABLE"] };
}

function probeException(command: string[], error: unknown): ToolchainProbeObservation {
  const name = error instanceof Error ? error.name : "";
  return name === "AbortError"
    ? { command, timedOut: true, diagnosticCodes: ["TOOLCHAIN_PROBE_TIMEOUT"] }
    : { command, exitCode: 1, diagnosticCodes: ["PROVIDER_UNAVAILABLE"] };
}
