import {
  type CapabilityHealth,
  type ExpertDescriptor,
  type HostCapabilityConnector,
  type Sha256Digest,
  compareVersions,
  connectorKey,
  descriptorKey,
  fingerprintContract,
  isApprovedProvenance,
  normalizeExpertDescriptor,
  normalizeHostCapabilityConnector,
  validateCapabilityHealth,
} from "./contracts.js";

export interface SourceObservation {
  revision: {
    kind: "commit" | "version";
    value: string;
  };
  contentHash: Sha256Digest;
  observedAt: string;
}

export interface DescriptorRegistryEntry {
  descriptor: ExpertDescriptor;
  fingerprint: Sha256Digest;
  health?: CapabilityHealth;
  sourceObservation?: SourceObservation;
  assignable: boolean;
  reasonCodes: string[];
}

export interface ConnectorRegistryEntry {
  connector: HostCapabilityConnector;
  fingerprint: Sha256Digest;
  sourceObservation?: SourceObservation;
  assignable: boolean;
  reasonCodes: string[];
}

export interface HostCapabilityInvokeRequest {
  projectId: string;
  workItemId?: string;
  workRunId: string;
  agentId?: string;
  descriptorId: string;
  descriptorVersion: string;
  operation: string;
  input: unknown;
}

export interface HostCapabilityConnectorRuntime {
  invoke(request: HostCapabilityInvokeRequest): Promise<unknown>;
  close?(): Promise<void>;
}

export type HostCapabilityConnectorFactory = () => Promise<HostCapabilityConnectorRuntime>;

export class HostCapabilityRegistryError extends Error {
  constructor(
    readonly code:
      | "descriptor_not_found"
      | "connector_not_found"
      | "registry_conflict"
      | "connector_timeout",
    message: string,
  ) {
    super(message);
    this.name = "HostCapabilityRegistryError";
  }
}

function sortDescriptorEntries(
  left: DescriptorRegistryEntry,
  right: DescriptorRegistryEntry,
): number {
  const idCompared = left.descriptor.descriptorId.localeCompare(
    right.descriptor.descriptorId,
  );
  if (idCompared !== 0) return idCompared;
  return -compareVersions(
    left.descriptor.descriptorVersion,
    right.descriptor.descriptorVersion,
  );
}

function sortConnectorEntries(
  left: ConnectorRegistryEntry,
  right: ConnectorRegistryEntry,
): number {
  const idCompared = left.connector.connectorId.localeCompare(
    right.connector.connectorId,
  );
  if (idCompared !== 0) return idCompared;
  return -compareVersions(
    left.connector.connectorVersion,
    right.connector.connectorVersion,
  );
}

function evaluateProvenance(
  imported: ExpertDescriptor["importProvenance"] | HostCapabilityConnector["importProvenance"],
  observation?: SourceObservation,
): string[] {
  const reasons: string[] = [];
  if (imported.licenseReview.status !== "approved") {
    reasons.push("license_not_approved");
  }
  if (imported.approval.status !== "approved") {
    reasons.push(`import_${imported.approval.status}`);
  }
  if (observation) {
    if (
      observation.revision.kind !== imported.source.revision.kind ||
      observation.revision.value !== imported.source.revision.value
    ) {
      reasons.push("source_revision_drift");
    }
    if (observation.contentHash !== imported.source.contentHash) {
      reasons.push("source_content_drift");
    }
  }
  return reasons;
}

function validateSourceObservation(observation: SourceObservation): void {
  if (!(["commit", "version"] as const).includes(observation.revision.kind)) {
    throw new HostCapabilityRegistryError(
      "registry_conflict",
      "Source observation revision kind must be commit or version",
    );
  }
  if (!observation.revision.value.trim()) {
    throw new HostCapabilityRegistryError(
      "registry_conflict",
      "Source observation revision requires a value",
    );
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(observation.contentHash)) {
    throw new HostCapabilityRegistryError(
      "registry_conflict",
      "Source observation requires a sha256 content hash",
    );
  }
  if (!Number.isFinite(Date.parse(observation.observedAt))) {
    throw new HostCapabilityRegistryError(
      "registry_conflict",
      "Source observation requires a valid observedAt timestamp",
    );
  }
}

export class ExpertDescriptorRegistry {
  readonly #descriptors = new Map<string, ExpertDescriptor>();
  readonly #fingerprints = new Map<string, Sha256Digest>();
  readonly #health = new Map<string, CapabilityHealth>();
  readonly #observations = new Map<string, SourceObservation>();

  register(descriptor: ExpertDescriptor): DescriptorRegistryEntry {
    const normalized = normalizeExpertDescriptor(descriptor);
    const key = descriptorKey(
      normalized.descriptorId,
      normalized.descriptorVersion,
    );
    const fingerprint = fingerprintContract(normalized);
    const previous = this.#fingerprints.get(key);
    if (previous && previous !== fingerprint) {
      throw new HostCapabilityRegistryError(
        "registry_conflict",
        `Descriptor ${key} is already registered with different content`,
      );
    }
    this.#descriptors.set(key, normalized);
    this.#fingerprints.set(key, fingerprint);
    return this.require(normalized.descriptorId, normalized.descriptorVersion);
  }

  replace(descriptor: ExpertDescriptor): DescriptorRegistryEntry {
    const normalized = normalizeExpertDescriptor(descriptor);
    const key = descriptorKey(
      normalized.descriptorId,
      normalized.descriptorVersion,
    );
    this.#descriptors.set(key, normalized);
    this.#fingerprints.set(key, fingerprintContract(normalized));
    return this.require(normalized.descriptorId, normalized.descriptorVersion);
  }

  setHealth(
    descriptorId: string,
    descriptorVersion: string,
    health: CapabilityHealth,
  ): DescriptorRegistryEntry {
    validateCapabilityHealth(health);
    const key = descriptorKey(descriptorId, descriptorVersion);
    if (!this.#descriptors.has(key)) {
      throw new HostCapabilityRegistryError(
        "descriptor_not_found",
        `Descriptor ${key} is not registered`,
      );
    }
    this.#health.set(key, structuredClone(health));
    return this.require(descriptorId, descriptorVersion);
  }

  observeSource(
    descriptorId: string,
    descriptorVersion: string,
    observation: SourceObservation,
  ): DescriptorRegistryEntry {
    const key = descriptorKey(descriptorId, descriptorVersion);
    if (!this.#descriptors.has(key)) {
      throw new HostCapabilityRegistryError(
        "descriptor_not_found",
        `Descriptor ${key} is not registered`,
      );
    }
    validateSourceObservation(observation);
    this.#observations.set(key, structuredClone(observation));
    return this.require(descriptorId, descriptorVersion);
  }

  get(
    descriptorId: string,
    descriptorVersion?: string,
  ): DescriptorRegistryEntry | undefined {
    if (descriptorVersion) {
      const descriptor = this.#descriptors.get(
        descriptorKey(descriptorId, descriptorVersion),
      );
      return descriptor ? this.#entry(descriptor) : undefined;
    }
    return this.list()
      .filter((entry) => entry.descriptor.descriptorId === descriptorId)
      .at(0);
  }

  require(
    descriptorId: string,
    descriptorVersion?: string,
  ): DescriptorRegistryEntry {
    const entry = this.get(descriptorId, descriptorVersion);
    if (!entry) {
      throw new HostCapabilityRegistryError(
        "descriptor_not_found",
        `Descriptor ${descriptorVersion ? descriptorKey(descriptorId, descriptorVersion) : descriptorId} is not registered`,
      );
    }
    return entry;
  }

  list(): DescriptorRegistryEntry[] {
    return [...this.#descriptors.values()]
      .map((descriptor) => this.#entry(descriptor))
      .sort(sortDescriptorEntries);
  }

  #entry(descriptor: ExpertDescriptor): DescriptorRegistryEntry {
    const key = descriptorKey(
      descriptor.descriptorId,
      descriptor.descriptorVersion,
    );
    const observation = this.#observations.get(key);
    const reasonCodes = evaluateProvenance(
      descriptor.importProvenance,
      observation,
    );
    return {
      descriptor: structuredClone(descriptor),
      fingerprint: this.#fingerprints.get(key)!,
      health: this.#health.has(key)
        ? structuredClone(this.#health.get(key)!)
        : undefined,
      sourceObservation: observation ? structuredClone(observation) : undefined,
      assignable:
        isApprovedProvenance(descriptor.importProvenance) &&
        reasonCodes.length === 0,
      reasonCodes,
    };
  }
}

interface ConnectorRecord {
  connector: HostCapabilityConnector;
  fingerprint: Sha256Digest;
  factory: HostCapabilityConnectorFactory;
  connection?: Promise<HostCapabilityConnectorRuntime>;
}

export class HostCapabilityConnectorRegistry {
  readonly #connectors = new Map<string, ConnectorRecord>();
  readonly #observations = new Map<string, SourceObservation>();

  register(
    connector: HostCapabilityConnector,
    factory: HostCapabilityConnectorFactory,
  ): ConnectorRegistryEntry {
    const normalized = normalizeHostCapabilityConnector(connector);
    const key = connectorKey(
      normalized.connectorId,
      normalized.connectorVersion,
    );
    const fingerprint = fingerprintContract(normalized);
    const previous = this.#connectors.get(key);
    if (previous && previous.fingerprint !== fingerprint) {
      throw new HostCapabilityRegistryError(
        "registry_conflict",
        `Connector ${key} is already registered with different content`,
      );
    }
    if (!previous) {
      this.#connectors.set(key, {
        connector: normalized,
        fingerprint,
        factory,
      });
    }
    return this.require(normalized.connectorId, normalized.connectorVersion);
  }

  replace(
    connector: HostCapabilityConnector,
    factory: HostCapabilityConnectorFactory,
  ): ConnectorRegistryEntry {
    const normalized = normalizeHostCapabilityConnector(connector);
    const key = connectorKey(
      normalized.connectorId,
      normalized.connectorVersion,
    );
    this.#connectors.set(key, {
      connector: normalized,
      fingerprint: fingerprintContract(normalized),
      factory,
    });
    return this.require(normalized.connectorId, normalized.connectorVersion);
  }

  get(
    connectorId: string,
    connectorVersion?: string,
  ): ConnectorRegistryEntry | undefined {
    let record: ConnectorRecord | undefined;
    if (connectorVersion) {
      record = this.#connectors.get(connectorKey(connectorId, connectorVersion));
    } else {
      record = [...this.#connectors.values()]
        .filter((candidate) => candidate.connector.connectorId === connectorId)
        .sort((left, right) =>
          -compareVersions(
            left.connector.connectorVersion,
            right.connector.connectorVersion,
          ),
        )
        .at(0);
    }
    return record ? this.#entry(record) : undefined;
  }

  require(
    connectorId: string,
    connectorVersion?: string,
  ): ConnectorRegistryEntry {
    const entry = this.get(connectorId, connectorVersion);
    if (!entry) {
      throw new HostCapabilityRegistryError(
        "connector_not_found",
        `Connector ${connectorVersion ? connectorKey(connectorId, connectorVersion) : connectorId} is not registered`,
      );
    }
    return entry;
  }

  list(): ConnectorRegistryEntry[] {
    return [...this.#connectors.values()]
      .map((record) => this.#entry(record))
      .sort(sortConnectorEntries);
  }

  observeSource(
    connectorId: string,
    connectorVersion: string,
    observation: SourceObservation,
  ): ConnectorRegistryEntry {
    const key = connectorKey(connectorId, connectorVersion);
    if (!this.#connectors.has(key)) {
      throw new HostCapabilityRegistryError(
        "connector_not_found",
        `Connector ${key} is not registered`,
      );
    }
    validateSourceObservation(observation);
    this.#observations.set(key, structuredClone(observation));
    return this.require(connectorId, connectorVersion);
  }

  async connect(
    connectorId: string,
    connectorVersion: string,
    timeoutMs: number,
  ): Promise<HostCapabilityConnectorRuntime> {
    const key = connectorKey(connectorId, connectorVersion);
    const record = this.#connectors.get(key);
    if (!record) {
      throw new HostCapabilityRegistryError(
        "connector_not_found",
        `Connector ${key} is not registered`,
      );
    }
    if (!record.connection) {
      record.connection = record.factory().catch((error) => {
        record.connection = undefined;
        throw error;
      });
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        record.connection,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new HostCapabilityRegistryError(
                  "connector_timeout",
                  `Connector ${key} did not connect within ${timeoutMs}ms`,
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async closeAll(): Promise<void> {
    const connections = [...this.#connectors.values()]
      .map((record) => record.connection)
      .filter(
        (connection): connection is Promise<HostCapabilityConnectorRuntime> =>
          Boolean(connection),
      );
    await Promise.all(
      connections.map(async (connection) => {
        const runtime = await connection.catch(() => undefined);
        await runtime?.close?.();
      }),
    );
    for (const record of this.#connectors.values()) {
      record.connection = undefined;
    }
  }

  #entry(record: ConnectorRecord): ConnectorRegistryEntry {
    const key = connectorKey(
      record.connector.connectorId,
      record.connector.connectorVersion,
    );
    const observation = this.#observations.get(key);
    const reasonCodes = evaluateProvenance(
      record.connector.importProvenance,
      observation,
    );
    return {
      connector: structuredClone(record.connector),
      fingerprint: record.fingerprint,
      sourceObservation: observation ? structuredClone(observation) : undefined,
      assignable:
        isApprovedProvenance(record.connector.importProvenance) &&
        reasonCodes.length === 0,
      reasonCodes,
    };
  }
}
