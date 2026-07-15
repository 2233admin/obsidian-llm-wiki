import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DeviceCapabilityRegistry,
  DeviceCapabilityValidationError,
  type DeviceCapabilityAdvertisementInput,
} from './device-capability.js';

function input(overrides: Partial<DeviceCapabilityAdvertisementInput> = {}): DeviceCapabilityAdvertisementInput {
  return {
    schemaVersion: 1,
    deviceId: 'device/5090',
    issuedAt: '2026-07-15T10:00:00.000Z',
    expiresAt: '2026-07-15T10:10:00.000Z',
    health: {
      status: 'available',
      observedAt: '2026-07-15T10:00:00.000Z',
      reasons: [],
    },
    capabilities: ['model.inference', 'workflow.child-run'],
    models: [{ provider: 'ollama', model: 'qwen3-coder', mode: 'local' }],
    connectors: ['connector/git'],
    resourceClasses: ['gpu/nvidia-5090'],
    provenance: ['fleet:device-5090'],
    ...overrides,
  };
}

test('device advertisements persist with optimistic revisions and deterministic fingerprints', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-device-capability-'));
  try {
    const registry = new DeviceCapabilityRegistry(root);
    const first = registry.publish(input(), 0);
    assert.equal(first.revision, 1);
    assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(first.path, '_llmwiki/fleet/device-advertisements/5090.json');
    assert.equal(existsSync(join(root, ...first.path.split('/'))), true);

    const replay = registry.publish(input(), 1);
    assert.equal(replay.revision, 1, 'byte-identical publish is idempotent');
    assert.equal(replay.fingerprint, first.fingerprint);

    const updated = registry.publish(input({
      health: {
        status: 'degraded',
        observedAt: '2026-07-15T10:01:00.000Z',
        reasons: ['thermal-headroom-low'],
      },
    }), 1);
    assert.equal(updated.revision, 2);
    assert.notEqual(updated.fingerprint, first.fingerprint);
    assert.throws(() => registry.publish(input(), 1), /revision conflict/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('eligible projections fail closed for stale or unavailable devices', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-device-capability-'));
  try {
    const registry = new DeviceCapabilityRegistry(root);
    registry.publish(input(), 0);
    registry.publish(input({
      deviceId: 'device/offline',
      health: {
        status: 'unavailable',
        observedAt: '2026-07-15T10:00:00.000Z',
        reasons: ['connector-unreachable'],
      },
    }), 0);

    assert.deepEqual(
      registry.listEligible('2026-07-15T10:05:00.000Z').map((item) => item.deviceId),
      ['device/5090'],
    );
    assert.deepEqual(registry.listEligible('2026-07-15T10:11:00.000Z'), []);
    const doctor = registry.doctor('2026-07-15T10:11:00.000Z');
    assert.equal(doctor.ok, false);
    assert.deepEqual(doctor.devices.map((item) => [item.deviceId, item.status]), [
      ['device/5090', 'stale'],
      ['device/offline', 'stale'],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('advertisements reject machine-local, secret, process, and lease material', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-device-capability-'));
  try {
    const registry = new DeviceCapabilityRegistry(root);
    const forbidden: Array<[string, DeviceCapabilityAdvertisementInput]> = [
      ['machine path', input({ provenance: ['workspace:C:/private/5090'] })],
      ['lease token', { ...input(), leaseToken: 'must-not-persist' } as DeviceCapabilityAdvertisementInput],
      ['secret', { ...input(), secret: 'must-not-persist' } as DeviceCapabilityAdvertisementInput],
      ['process handle', { ...input(), processHandle: 1234 } as DeviceCapabilityAdvertisementInput],
      ['nested credential', input({ models: [{ provider: 'cloud', model: 'x', mode: 'cloud', credential: 'bad' } as never] })],
    ];
    for (const [label, advertisement] of forbidden) {
      assert.throws(() => registry.publish(advertisement, 0), DeviceCapabilityValidationError, label);
    }
    assert.equal(existsSync(join(root, '_llmwiki')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('serialized advertisements contain only portable non-secret capability facts', () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-device-capability-'));
  try {
    const registry = new DeviceCapabilityRegistry(root);
    const record = registry.publish(input(), 0);
    const serialized = readFileSync(join(root, ...record.path.split('/')), 'utf-8');
    assert.doesNotMatch(serialized, /lease[_-]?token|handoff[_-]?token|credential|secret|workspace|process/i);
    assert.doesNotMatch(serialized, /[A-Za-z]:[\\/]|(?:^|\s)\/(?:home|opt|mnt)\//m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
