import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

import { rejectDangerousRegex, ValidationError } from './validate.js';

test('rejectDangerousRegex rejects nested quantifiers and overlapping alternation', () => {
  assert.throws(() => rejectDangerousRegex('(a+)+'), ValidationError);
  assert.throws(() => rejectDangerousRegex('(a|aa)+'), ValidationError);
  assert.doesNotThrow(() => rejectDangerousRegex('^(alpha|beta)$'));
});

test('rejectDangerousRegex scans malformed library input in linear time', () => {
  const malformed = '('.repeat(30_000);
  const startedAt = performance.now();
  rejectDangerousRegex(malformed);
  assert.ok(performance.now() - startedAt < 300, 'regex safety validation exceeded 300 ms');
});
