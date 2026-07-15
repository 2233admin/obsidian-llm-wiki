import type {
  HostCapabilityCompatibilityCandidate,
  HostCapabilityTransport,
} from "../../../packages/settings-platform/dist/src/index.js";

const HOST_CONNECTOR_ID_ENV = "LLMWIKI_HOST_CAPABILITY_CONNECTOR_ID";
const HOST_PROVIDER_ALIAS_ENV = "LLMWIKI_HOST_CAPABILITY_PROVIDER";
const HOST_TRANSPORT_ENV = "LLMWIKI_HOST_CAPABILITY_TRANSPORT";
const HOST_ENDPOINT_ENV = "LLMWIKI_HOST_CAPABILITY_ENDPOINT";
const HOST_SECRET_ENV = "LLMWIKI_HOST_CAPABILITY_KEY";
const TRANSPORTS = new Set<HostCapabilityTransport>([
  "stdio",
  "http",
  "oauth",
  "local-model",
  "cloud-model",
]);

/**
 * Compatibility is intentionally Host-specific. Project Tracker forge files
 * and provider tokens are never imported as Host Capability authority.
 */
export function legacyHostCapabilityCandidates(
  _vaultPath: string,
  _projectId: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): HostCapabilityCompatibilityCandidate[] {
  const provider = firstString(
    environment[HOST_CONNECTOR_ID_ENV],
    environment[HOST_PROVIDER_ALIAS_ENV],
  );
  const transport = supportedTransport(environment[HOST_TRANSPORT_ENV]);
  const endpoint = firstString(environment[HOST_ENDPOINT_ENV]);
  if (!provider || !transport || !endpoint) return [];
  const secretPresent = Boolean(environment[HOST_SECRET_ENV]?.trim());
  return [{
    source: "legacy-environment",
    priority: 100,
    detail: `generic Host compatibility environment ${HOST_CONNECTOR_ID_ENV}`,
    values: {
      enabled: true,
      provider,
      transport,
      endpoint,
      ...(secretPresent || transport === "oauth" || transport === "cloud-model"
        ? {
            credential: {
              secretRef: { provider: "environment", locator: HOST_SECRET_ENV },
              status: secretPresent ? "present" : "missing",
            },
          }
        : {}),
    },
  }];
}

function supportedTransport(value: unknown): HostCapabilityTransport | undefined {
  const normalized = firstString(value);
  return normalized && TRANSPORTS.has(normalized as HostCapabilityTransport)
    ? normalized as HostCapabilityTransport
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string =>
    typeof value === "string" && Boolean(value.trim())
  )?.trim();
}
