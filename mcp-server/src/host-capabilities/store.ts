import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import {
  type AssignmentPlan,
  type Sha256Digest,
  canonicalJson,
  connectorKey,
  descriptorKey,
  fingerprintContract,
  normalizeExpertDescriptor,
  normalizeHostCapabilityConnector,
  validateAssignmentPlan,
} from "./contracts.js";
import {
  type ExpertDescriptorRegistration,
  type HostCapabilityConnectorRegistration,
  validateConnectorRegistration,
  validateDescriptorRegistration,
} from "./operation-contracts.js";

export const HOST_CAPABILITY_RELATIVE_ROOT =
  "_llmwiki/host-capabilities/v1" as const;

export class HostCapabilityStoreError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "corrupt",
    message: string,
    readonly logicalId?: string,
  ) {
    super(message);
    this.name = "HostCapabilityStoreError";
  }
}

export interface StoreWriteResult<T> {
  value: T;
  fingerprint: Sha256Digest;
  storageKey: string;
  replayed: boolean;
}

export type HostCapabilityStoreKind =
  | "descriptors"
  | "connectors"
  | "assignments";

function storageName(logicalId: string): string {
  return fingerprintContract(logicalId).slice("sha256:".length);
}

function relativeFile(kind: HostCapabilityStoreKind, logicalId: string): string {
  return `${HOST_CAPABILITY_RELATIVE_ROOT}/${kind}/${storageName(logicalId)}.json`;
}

export function hostCapabilityStorageKey(
  kind: HostCapabilityStoreKind,
  logicalId: string,
): string {
  return relativeFile(kind, logicalId);
}

function normalizedDescriptorRegistration(
  value: ExpertDescriptorRegistration,
): ExpertDescriptorRegistration {
  return {
    ...value,
    descriptor: normalizeExpertDescriptor(value.descriptor),
    health: structuredClone(value.health),
    sourceObservation: value.sourceObservation
      ? structuredClone(value.sourceObservation)
      : undefined,
  };
}

function normalizedConnectorRegistration(
  value: HostCapabilityConnectorRegistration,
): HostCapabilityConnectorRegistration {
  return {
    ...value,
    connector: normalizeHostCapabilityConnector(value.connector),
    health: structuredClone(value.health),
    configuration: structuredClone(value.configuration),
    sourceObservation: value.sourceObservation
      ? structuredClone(value.sourceObservation)
      : undefined,
  };
}

export class HostCapabilityStore {
  constructor(readonly vaultPath: string) {}

  registerDescriptor(value: unknown): StoreWriteResult<ExpertDescriptorRegistration> {
    const registration = normalizedDescriptorRegistration(
      validateDescriptorRegistration(value),
    );
    const logicalId = descriptorKey(
      registration.descriptor.descriptorId,
      registration.descriptor.descriptorVersion,
    );
    return this.#create("descriptors", logicalId, registration);
  }

  registerConnector(value: unknown): StoreWriteResult<HostCapabilityConnectorRegistration> {
    const registration = normalizedConnectorRegistration(
      validateConnectorRegistration(value),
    );
    const logicalId = connectorKey(
      registration.connector.connectorId,
      registration.connector.connectorVersion,
    );
    return this.#create("connectors", logicalId, registration);
  }

  readDescriptor(
    descriptorId: string,
    descriptorVersion: string,
  ): ExpertDescriptorRegistration {
    const logicalId = descriptorKey(descriptorId, descriptorVersion);
    return validateDescriptorRegistration(
      this.#read("descriptors", logicalId),
    );
  }

  readConnector(
    connectorId: string,
    connectorVersion: string,
  ): HostCapabilityConnectorRegistration {
    const logicalId = connectorKey(connectorId, connectorVersion);
    return validateConnectorRegistration(
      this.#read("connectors", logicalId),
    );
  }

  listDescriptors(): ExpertDescriptorRegistration[] {
    return this.#list("descriptors")
      .map(validateDescriptorRegistration)
      .sort(
        (left, right) =>
          left.descriptor.descriptorId.localeCompare(
            right.descriptor.descriptorId,
          ) ||
          left.descriptor.descriptorVersion.localeCompare(
            right.descriptor.descriptorVersion,
          ),
      );
  }

  listConnectors(): HostCapabilityConnectorRegistration[] {
    return this.#list("connectors")
      .map(validateConnectorRegistration)
      .sort(
        (left, right) =>
          left.connector.connectorId.localeCompare(right.connector.connectorId) ||
          left.connector.connectorVersion.localeCompare(
            right.connector.connectorVersion,
          ),
      );
  }

  saveAssignmentPlan(plan: AssignmentPlan): StoreWriteResult<AssignmentPlan> {
    validateAssignmentPlan(plan);
    return this.#create("assignments", plan.planId, structuredClone(plan));
  }

  readAssignmentPlan(planId: string): AssignmentPlan {
    const value = this.#read("assignments", planId) as AssignmentPlan;
    validateAssignmentPlan(value);
    return structuredClone(value);
  }

  listAssignmentPlans(): AssignmentPlan[] {
    return this.#list("assignments")
      .map((value) => {
        validateAssignmentPlan(value as AssignmentPlan);
        return structuredClone(value as AssignmentPlan);
      })
      .sort((left, right) => left.planId.localeCompare(right.planId));
  }

  approveAssignmentPlan(input: {
    planId: string;
    expectedFingerprint: Sha256Digest;
    approvedBy: string;
    approvedAt: string;
  }): StoreWriteResult<AssignmentPlan> {
    const relative = relativeFile("assignments", input.planId);
    const absolute = join(this.vaultPath, ...relative.split("/"));
    const lock = `${absolute}.lock`;
    mkdirSync(dirname(absolute), { recursive: true });
    let lockHandle: number;
    try {
      lockHandle = openSync(lock, "wx");
    } catch {
      throw new HostCapabilityStoreError(
        "conflict",
        `AssignmentPlan ${input.planId} is being updated`,
        input.planId,
      );
    }
    try {
      const current = this.readAssignmentPlan(input.planId);
      const currentFingerprint = fingerprintContract(current);
      if (current.approval.status === "approved") {
        if (current.approval.reviewedBy !== input.approvedBy) {
          throw new HostCapabilityStoreError(
            "conflict",
            `AssignmentPlan ${input.planId} is already approved by another actor`,
            input.planId,
          );
        }
        return {
          value: current,
          fingerprint: currentFingerprint,
          storageKey: relative,
          replayed: true,
        };
      }
      if (current.status !== "matched" || !current.selected) {
        throw new HostCapabilityStoreError(
          "conflict",
          `AssignmentPlan ${input.planId} has no eligible selection to approve`,
          input.planId,
        );
      }
      if (current.approval.status !== "pending") {
        throw new HostCapabilityStoreError(
          "conflict",
          `AssignmentPlan ${input.planId} is not pending approval`,
          input.planId,
        );
      }
      if (currentFingerprint !== input.expectedFingerprint) {
        throw new HostCapabilityStoreError(
          "conflict",
          `AssignmentPlan ${input.planId} changed before approval`,
          input.planId,
        );
      }
      if (!input.approvedBy.trim()) {
        throw new HostCapabilityStoreError(
          "conflict",
          "AssignmentPlan approval requires an approver identity",
          input.planId,
        );
      }
      if (!Number.isFinite(Date.parse(input.approvedAt))) {
        throw new HostCapabilityStoreError(
          "conflict",
          "AssignmentPlan approval requires a valid timestamp",
          input.planId,
        );
      }
      const approved: AssignmentPlan = {
        ...current,
        approval: {
          status: "approved",
          reviewedBy: input.approvedBy.trim(),
          reviewedAt: input.approvedAt,
        },
      };
      validateAssignmentPlan(approved);
      const temporary = `${absolute}.${randomUUID()}.tmp`;
      writeFileSync(temporary, `${canonicalJson(approved)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      renameSync(temporary, absolute);
      return {
        value: structuredClone(approved),
        fingerprint: fingerprintContract(approved),
        storageKey: relative,
        replayed: false,
      };
    } finally {
      closeSync(lockHandle);
      rmSync(lock, { force: true });
    }
  }

  #create<T>(
    kind: HostCapabilityStoreKind,
    logicalId: string,
    value: T,
  ): StoreWriteResult<T> {
    const relative = relativeFile(kind, logicalId);
    const absolute = join(this.vaultPath, ...relative.split("/"));
    const bytes = `${canonicalJson(value)}\n`;
    mkdirSync(dirname(absolute), { recursive: true });
    try {
      writeFileSync(absolute, bytes, { encoding: "utf8", flag: "wx" });
      return {
        value: structuredClone(value),
        fingerprint: fingerprintContract(value),
        storageKey: relative,
        replayed: false,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = this.#parseFile(absolute, logicalId) as T;
      if (canonicalJson(existing) !== canonicalJson(value)) {
        throw new HostCapabilityStoreError(
          "conflict",
          `${logicalId} already exists with different content`,
          logicalId,
        );
      }
      return {
        value: structuredClone(existing),
        fingerprint: fingerprintContract(existing),
        storageKey: relative,
        replayed: true,
      };
    }
  }

  #read(kind: HostCapabilityStoreKind, logicalId: string): unknown {
    const relative = relativeFile(kind, logicalId);
    const absolute = join(this.vaultPath, ...relative.split("/"));
    if (!existsSync(absolute)) {
      throw new HostCapabilityStoreError(
        "not_found",
        `${logicalId} is not registered`,
        logicalId,
      );
    }
    return this.#parseFile(absolute, logicalId);
  }

  #list(kind: HostCapabilityStoreKind): unknown[] {
    const relative = `${HOST_CAPABILITY_RELATIVE_ROOT}/${kind}`;
    const absolute = join(this.vaultPath, ...relative.split("/"));
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort()
      .map((name) => this.#parseFile(join(absolute, name), `${kind}/${name}`));
  }

  #parseFile(absolute: string, logicalId: string): unknown {
    try {
      return JSON.parse(readFileSync(absolute, "utf8"));
    } catch {
      throw new HostCapabilityStoreError(
        "corrupt",
        `${logicalId} contains invalid persisted JSON`,
        logicalId,
      );
    }
  }
}
