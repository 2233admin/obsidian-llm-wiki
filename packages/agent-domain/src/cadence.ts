import { canonicalDigest } from "./canonical.js";
import { DomainValidationError } from "./errors.js";
import type {
  AgentProfileId,
  DreamTimeOperation,
  MemoryProposalId,
  ProjectId,
} from "./types.js";
import { parseAgentProfileId, parseProjectId } from "./validation.js";

export const DREAM_TIME_CADENCES = ["daily", "weekly", "monthly"] as const;
export type DreamTimeCadence = (typeof DREAM_TIME_CADENCES)[number];

export interface DreamTimeCadenceWindow {
  cadence: DreamTimeCadence;
  operation: DreamTimeOperation;
  periodKey: string;
  startsAt: string;
  endsAt: string;
  dueAt: string;
}

export interface DreamTimeCadenceIdentity {
  invocationId: `dreamtime-cadence/${string}`;
  proposalId: MemoryProposalId;
  agentId: string;
  transitionToken: string;
}

const OPERATION_BY_CADENCE: Record<DreamTimeCadence, DreamTimeOperation> = {
  daily: "checkpoint",
  weekly: "learn",
  monthly: "review",
};

export function resolveDreamTimeCadenceWindow(
  cadence: DreamTimeCadence,
  asOf: string,
): DreamTimeCadenceWindow {
  if (!DREAM_TIME_CADENCES.includes(cadence)) {
    throw new DomainValidationError("Dream Time cadence must be daily, weekly, or monthly");
  }
  const instant = canonicalUtcInstant(asOf);
  let startsAt: Date;
  let endsAt: Date;
  let periodKey: string;

  if (cadence === "daily") {
    startsAt = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
    endsAt = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate() + 1));
    periodKey = startsAt.toISOString().slice(0, 10);
  } else if (cadence === "weekly") {
    const daysSinceMonday = (instant.getUTCDay() + 6) % 7;
    startsAt = new Date(Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate() - daysSinceMonday,
    ));
    endsAt = new Date(Date.UTC(
      startsAt.getUTCFullYear(),
      startsAt.getUTCMonth(),
      startsAt.getUTCDate() + 7,
    ));
    periodKey = startsAt.toISOString().slice(0, 10);
  } else {
    startsAt = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), 1));
    endsAt = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth() + 1, 1));
    periodKey = startsAt.toISOString().slice(0, 7);
  }

  return {
    cadence,
    operation: OPERATION_BY_CADENCE[cadence],
    periodKey,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    dueAt: startsAt.toISOString(),
  };
}

export function dreamTimeCadenceIdentity(
  projectId: ProjectId,
  profileId: AgentProfileId,
  window: DreamTimeCadenceWindow,
): DreamTimeCadenceIdentity {
  const project = parseProjectId(projectId);
  const profile = parseAgentProfileId(profileId);
  const checked = resolveDreamTimeCadenceWindow(window.cadence, window.startsAt);
  if (checked.periodKey !== window.periodKey
    || checked.startsAt !== window.startsAt
    || checked.endsAt !== window.endsAt
    || checked.dueAt !== window.dueAt
    || checked.operation !== window.operation) {
    throw new DomainValidationError("Dream Time cadence window does not match its deterministic UTC period");
  }
  const digest = canonicalDigest({
    schemaVersion: 1,
    projectId: project,
    profileId: profile,
    cadence: checked.cadence,
    operation: checked.operation,
    periodKey: checked.periodKey,
    startsAt: checked.startsAt,
    endsAt: checked.endsAt,
  }).slice("sha256:".length, "sha256:".length + 24);
  const suffix = `${checked.cadence}-${checked.periodKey}-${digest}`;
  const invocationId = `dreamtime-cadence/${suffix}` as const;
  return {
    invocationId,
    proposalId: `memory-proposal/cadence-${suffix}`,
    agentId: `dreamtime-${checked.cadence}-${digest}`,
    transitionToken: `dreamtime-cadence-${suffix}`,
  };
}

function canonicalUtcInstant(value: string): Date {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainValidationError("asOf must be a canonical UTC RFC3339 timestamp");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new DomainValidationError("asOf must be a canonical UTC RFC3339 timestamp");
  }
  return new Date(timestamp);
}
