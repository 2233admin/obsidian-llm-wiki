import {
  fingerprintRecoveryValue,
  hasUnsafeRecoveryMaterial,
  safeRecoveryText,
  type RecoveryFingerprint,
} from './contract-support.js';
import type { RecoveryCapabilityFactV2, RecoveryCompatibleBindingV2 } from './recovery-flow.js';

export interface RecoveryAgentSelectionSource {
  listCompatible(projectId: string, capabilities: RecoveryCapabilityFactV2[]): Promise<Array<{
    role: string;
    bindingId: string;
    bindingRevision: number;
    profileId: string;
    profileRevision: number;
  }>>;
}

const text = (value: unknown, label: string, max = 256): string => safeRecoveryText(value, label, { minBytes: 1, maxBytes: max });

function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Normalize the Agent Domain read into the exact revision tuple used by Flow. */
export function normalizeCompatibleBindings(
  projectId: string,
  capabilities: RecoveryCapabilityFactV2[],
  records: unknown,
): RecoveryCompatibleBindingV2[] {
  if (!Array.isArray(records)) return [];
  const required = new Set(capabilities.map((capability) => capability.capability));
  return records.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    try {
      if (record.enabled === false || record.projectId !== undefined && record.projectId !== projectId) return [];
      if (record.projectContextCurrent === false || record.profileCurrent === false || record.capabilityCompatible === false) return [];
      const claims = Array.isArray(record.capabilityClaims) ? record.capabilityClaims.filter((item): item is string => typeof item === 'string') : [];
      if (required.size > 0 && claims.length > 0 && ![...required].every((item) => claims.includes(item))) return [];
      const bindingId = text(record.bindingId, 'bindingId');
      const profileId = text(record.profileId, 'profileId');
      const role = text(record.role, 'role');
      if (!validRevision(record.bindingRevision) || !validRevision(record.profileRevision)) return [];
      if (hasUnsafeRecoveryMaterial({ bindingId, profileId, role })) return [];
      return [{ role, bindingId, bindingRevision: record.bindingRevision, profileId, profileRevision: record.profileRevision }];
    } catch {
      return [];
    }
  }).sort((left, right) => left.bindingId.localeCompare(right.bindingId) || left.bindingRevision - right.bindingRevision);
}

export function fingerprintCompatibleBindings(bindings: RecoveryCompatibleBindingV2[]): RecoveryFingerprint {
  return fingerprintRecoveryValue(bindings);
}

export function createAgentSelectionSource(
  read: (projectId: string, capabilities: RecoveryCapabilityFactV2[]) => Promise<unknown> | unknown,
): RecoveryAgentSelectionSource {
  return { async listCompatible(projectId, capabilities) {
    return normalizeCompatibleBindings(projectId, capabilities, await read(projectId, capabilities));
  } };
}
