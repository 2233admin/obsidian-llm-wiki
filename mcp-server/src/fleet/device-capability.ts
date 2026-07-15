import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export const DEVICE_CAPABILITY_SCHEMA_VERSION = 1 as const;
export const DEVICE_HEALTH_STATUSES = ['available', 'degraded', 'unavailable'] as const;

export type DeviceHealthStatus = (typeof DEVICE_HEALTH_STATUSES)[number];

export interface DeviceCapabilityAdvertisementInput {
  schemaVersion: typeof DEVICE_CAPABILITY_SCHEMA_VERSION;
  deviceId: string;
  issuedAt: string;
  expiresAt: string;
  health: {
    status: DeviceHealthStatus;
    observedAt: string;
    reasons: string[];
  };
  capabilities: string[];
  models: Array<{
    provider: string;
    model: string;
    mode: 'local' | 'cloud';
  }>;
  connectors: string[];
  resourceClasses: string[];
  provenance: string[];
}

interface StoredDeviceCapabilityAdvertisement extends DeviceCapabilityAdvertisementInput {
  revision: number;
  fingerprint: string;
}

export interface DeviceCapabilityAdvertisementRecord extends StoredDeviceCapabilityAdvertisement {
  path: string;
}

export class DeviceCapabilityValidationError extends Error {
  readonly code = 'device_capability_validation';
}

export class DeviceCapabilityConflictError extends Error {
  readonly code = 'device_capability_conflict';
}

const ROOT = '_llmwiki/fleet/device-advertisements';
const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'deviceId',
  'issuedAt',
  'expiresAt',
  'health',
  'capabilities',
  'models',
  'connectors',
  'resourceClasses',
  'provenance',
]);
const HEALTH_KEYS = new Set(['status', 'observedAt', 'reasons']);
const MODEL_KEYS = new Set(['provider', 'model', 'mode']);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function fail(message: string): never {
  throw new DeviceCapabilityValidationError(message);
}

function assertExactKeys(label: string, value: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} contains unsupported field ${key}`);
  }
}

function assertPortableString(label: string, value: unknown, max = 512): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\n') || value.includes('\r')) {
    fail(`${label} must be a non-empty portable string`);
  }
  if (
    /(?:lease|handoff)[-_ ]?token|credential|plaintext[_-]?secret|api[_-]?key|process[_-]?handle/i.test(value)
    || /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|opt|mnt|Users)\/|~[\\/]|\.{1,2}[\\/])/.test(value)
    || /(?:^|[\s:=])(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|opt|mnt|Users)\/|~[\\/]|\.{1,2}[\\/])/.test(value)
  ) {
    fail(`${label} contains machine-local or secret-bearing material`);
  }
}

function assertTimestamp(label: string, value: unknown): asserts value is string {
  assertPortableString(label, value, 40);
  if (!ISO_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) fail(`${label} must be an ISO UTC timestamp`);
}

function portableList(label: string, value: unknown, pattern: RegExp, max = 128): string[] {
  if (!Array.isArray(value) || value.length > max) fail(`${label} must be an array with at most ${max} entries`);
  const output = value.map((item, index) => {
    assertPortableString(`${label}[${index}]`, item);
    if (!pattern.test(item)) fail(`${label}[${index}] has an invalid identifier`);
    return item;
  });
  if (new Set(output).size !== output.length) fail(`${label} must not contain duplicates`);
  return [...output].sort();
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalValue(record[key])]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function cloneInput(input: DeviceCapabilityAdvertisementInput): DeviceCapabilityAdvertisementInput {
  return structuredClone(input);
}

export function validateDeviceCapabilityAdvertisement(value: unknown): DeviceCapabilityAdvertisementInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('advertisement must be an object');
  const input = value as Record<string, unknown>;
  assertExactKeys('advertisement', input, TOP_LEVEL_KEYS);
  if (input.schemaVersion !== DEVICE_CAPABILITY_SCHEMA_VERSION) fail('schemaVersion must be 1');
  assertPortableString('deviceId', input.deviceId);
  if (!/^device\/[a-z0-9][a-z0-9-]*$/.test(input.deviceId)) fail('deviceId must match device/<lowercase-kebab-id>');
  assertTimestamp('issuedAt', input.issuedAt);
  assertTimestamp('expiresAt', input.expiresAt);
  if (Date.parse(input.expiresAt) <= Date.parse(input.issuedAt)) fail('expiresAt must be later than issuedAt');

  if (!input.health || typeof input.health !== 'object' || Array.isArray(input.health)) fail('health must be an object');
  const health = input.health as Record<string, unknown>;
  assertExactKeys('health', health, HEALTH_KEYS);
  if (!DEVICE_HEALTH_STATUSES.includes(health.status as DeviceHealthStatus)) fail('health.status is invalid');
  assertTimestamp('health.observedAt', health.observedAt);
  const reasons = portableList('health.reasons', health.reasons, /^[a-z0-9][a-z0-9._:-]*$/);

  const capabilities = portableList('capabilities', input.capabilities, /^[a-z0-9][a-z0-9._:-]*$/);
  const connectors = portableList('connectors', input.connectors, /^connector\/[a-z0-9][a-z0-9-]*$/);
  const resourceClasses = portableList('resourceClasses', input.resourceClasses, /^[a-z0-9][a-z0-9._:/-]*$/);
  const provenance = portableList('provenance', input.provenance, /^[a-z][a-z0-9+.-]*:[A-Za-z0-9][A-Za-z0-9._:/-]*$/);

  if (!Array.isArray(input.models) || input.models.length > 64) fail('models must be an array with at most 64 entries');
  const models = input.models.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`models[${index}] must be an object`);
    const model = item as Record<string, unknown>;
    assertExactKeys(`models[${index}]`, model, MODEL_KEYS);
    assertPortableString(`models[${index}].provider`, model.provider);
    assertPortableString(`models[${index}].model`, model.model);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(model.provider) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model.model)) {
      fail(`models[${index}] contains an invalid provider or model identifier`);
    }
    if (model.mode !== 'local' && model.mode !== 'cloud') fail(`models[${index}].mode is invalid`);
    return { provider: model.provider, model: model.model, mode: model.mode } as DeviceCapabilityAdvertisementInput['models'][number];
  }).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));

  return {
    schemaVersion: DEVICE_CAPABILITY_SCHEMA_VERSION,
    deviceId: input.deviceId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    health: {
      status: health.status as DeviceHealthStatus,
      observedAt: health.observedAt,
      reasons,
    },
    capabilities,
    models,
    connectors,
    resourceClasses,
    provenance,
  };
}

export function deviceCapabilityFingerprint(input: DeviceCapabilityAdvertisementInput): string {
  const validated = validateDeviceCapabilityAdvertisement(input);
  return createHash('sha256').update(canonicalJson(validated), 'utf-8').digest('hex');
}

function relativePath(deviceId: string): string {
  return `${ROOT}/${deviceId.slice('device/'.length)}.json`;
}

function fullPath(root: string, path: string): string {
  return join(root, ...path.split('/'));
}

function parseStored(value: unknown, path: string): StoredDeviceCapabilityAdvertisement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must contain an object`);
  const record = value as Record<string, unknown>;
  const input = Object.fromEntries([...TOP_LEVEL_KEYS].map((key) => [key, record[key]]));
  const validated = validateDeviceCapabilityAdvertisement(input);
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) fail(`${path} revision is invalid`);
  if (typeof record.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(record.fingerprint)) fail(`${path} fingerprint is invalid`);
  const actual = deviceCapabilityFingerprint(validated);
  if (actual !== record.fingerprint) fail(`${path} fingerprint does not match its content`);
  return { ...validated, revision: record.revision as number, fingerprint: actual };
}

function readStored(root: string, path: string): StoredDeviceCapabilityAdvertisement | null {
  const target = fullPath(root, path);
  if (!existsSync(target)) return null;
  try {
    return parseStored(JSON.parse(readFileSync(target, 'utf-8')) as unknown, path);
  } catch (error) {
    if (error instanceof DeviceCapabilityValidationError) throw error;
    fail(`${path} is not valid JSON`);
  }
}

function asRecord(stored: StoredDeviceCapabilityAdvertisement, path: string): DeviceCapabilityAdvertisementRecord {
  return { ...cloneInput(stored), revision: stored.revision, fingerprint: stored.fingerprint, path };
}

export class DeviceCapabilityRegistry {
  constructor(private readonly root: string) {}

  publish(value: DeviceCapabilityAdvertisementInput, expectedRevision: number): DeviceCapabilityAdvertisementRecord {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new DeviceCapabilityConflictError('expected revision must be a non-negative integer');
    }
    const input = validateDeviceCapabilityAdvertisement(value);
    const path = relativePath(input.deviceId);
    const existing = readStored(this.root, path);
    if ((existing?.revision ?? 0) !== expectedRevision) {
      throw new DeviceCapabilityConflictError(
        `device advertisement revision conflict: expected ${expectedRevision}, actual ${existing?.revision ?? 0}`,
      );
    }
    const fingerprint = deviceCapabilityFingerprint(input);
    if (existing?.fingerprint === fingerprint) return asRecord(existing, path);
    const stored: StoredDeviceCapabilityAdvertisement = {
      ...cloneInput(input),
      revision: expectedRevision + 1,
      fingerprint,
    };
    const target = fullPath(this.root, path);
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${randomUUID()}`;
    writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf-8');
    try {
      renameSync(temporary, target);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    return asRecord(stored, path);
  }

  get(deviceId: string): DeviceCapabilityAdvertisementRecord | null {
    assertPortableString('deviceId', deviceId);
    if (!/^device\/[a-z0-9][a-z0-9-]*$/.test(deviceId)) fail('deviceId must match device/<lowercase-kebab-id>');
    const path = relativePath(deviceId);
    const stored = readStored(this.root, path);
    return stored ? asRecord(stored, path) : null;
  }

  list(): DeviceCapabilityAdvertisementRecord[] {
    const directory = fullPath(this.root, ROOT);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => `${ROOT}/${entry.name}`)
      .map((path) => readStored(this.root, path))
      .filter((item): item is StoredDeviceCapabilityAdvertisement => item !== null)
      .map((item) => asRecord(item, relativePath(item.deviceId)))
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  }

  listEligible(now: string = new Date().toISOString()): DeviceCapabilityAdvertisementRecord[] {
    assertTimestamp('now', now);
    const timestamp = Date.parse(now);
    return this.list().filter((item) => item.health.status !== 'unavailable' && Date.parse(item.expiresAt) > timestamp);
  }

  doctor(now: string = new Date().toISOString()): {
    ok: boolean;
    now: string;
    devices: Array<{ deviceId: string; status: DeviceHealthStatus | 'stale'; expiresAt: string; reasons: string[] }>;
  } {
    assertTimestamp('now', now);
    const timestamp = Date.parse(now);
    const devices = this.list().map((item) => ({
      deviceId: item.deviceId,
      status: Date.parse(item.expiresAt) <= timestamp ? 'stale' as const : item.health.status,
      expiresAt: item.expiresAt,
      reasons: [...item.health.reasons],
    }));
    return {
      ok: devices.some((item) => item.status === 'available' || item.status === 'degraded'),
      now,
      devices,
    };
  }
}
