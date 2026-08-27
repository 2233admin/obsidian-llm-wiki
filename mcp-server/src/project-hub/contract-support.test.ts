import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertClosedRecoveryObject,
  canonicalRecoveryJson,
  fingerprintRecoveryValue,
  hasUnsafeRecoveryMaterial,
  safeRecoveryText,
  utf8JsonBytes,
} from './contract-support.js';

test('canonicalRecoveryJson sorts object keys but preserves array order', () => {
  assert.equal(
    canonicalRecoveryJson({ z: 1, a: { d: undefined, c: [2, 1] } }),
    '{"a":{"c":[2,1],"d":null},"z":1}',
  );
});

test('fingerprintRecoveryValue uses lowercase sha256 over canonical JSON', () => {
  assert.equal(
    fingerprintRecoveryValue({ b: 2, a: 1 }),
    'sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
  );
});

test('utf8JsonBytes measures canonical JSON UTF-8 bytes', () => {
  assert.equal(utf8JsonBytes({ value: '猫' }), Buffer.byteLength('{"value":"猫"}', 'utf8'));
});

test('assertClosedRecoveryObject enforces exact keys while allowing explicit null', () => {
  assert.deepEqual(
    assertClosedRecoveryObject({ value: null, count: 1 }, ['value', 'count'], 'sample'),
    { value: null, count: 1 },
  );
  assert.throws(() => assertClosedRecoveryObject({ value: null }, ['value', 'count'], 'sample'), /missing required key.*count/i);
  assert.throws(() => assertClosedRecoveryObject({ value: null, count: 1, extra: true }, ['value', 'count'], 'sample'), /unknown field.*extra/i);
});

test('safeRecoveryText applies NFKC whitespace normalization and byte bounds', () => {
  assert.equal(safeRecoveryText('  Ａ　  B  ', 'query', { minBytes: 3, maxBytes: 20 }), 'A B');
  assert.throws(() => safeRecoveryText('x\nsecret', 'query', { minBytes: 1, maxBytes: 20 }), /unsafe|control/i);
  assert.throws(() => safeRecoveryText('x', 'query', { minBytes: 2, maxBytes: 20 }), /minimum/i);
  assert.throws(() => safeRecoveryText('猫猫', 'query', { minBytes: 1, maxBytes: 2 }), /maximum|bytes/i);
});

test('hasUnsafeRecoveryMaterial detects unsafe values under suspicious and benign keys', () => {
  assert.equal(hasUnsafeRecoveryMaterial({ token: 'opaque-value' }), true);
  assert.equal(hasUnsafeRecoveryMaterial({ metadata: { transcript: 'raw assistant transcript' } }), true);
  assert.equal(hasUnsafeRecoveryMaterial({ path: 'C:\\Users\\Admin\\vault' }), true);
  assert.equal(hasUnsafeRecoveryMaterial({ path: '/Users/admin/vault' }), true);
  assert.equal(hasUnsafeRecoveryMaterial({ path: '\\\\server\\share\\vault' }), true);
  assert.equal(hasUnsafeRecoveryMaterial({ home: '~/vault' }), true);
  assert.equal(hasUnsafeRecoveryMaterial({ label: 'read C:\\Users\\Admin\\vault' }), true);
  assert.equal(hasUnsafeRecoveryMaterial({ label: 'raw_prompt' }), true);
  assert.equal(hasUnsafeRecoveryMaterial({ label: 'raw-transcript' }), true);
  assert.equal(hasUnsafeRecoveryMaterial({ label: 'normal project summary', count: 2 }), false);
});
