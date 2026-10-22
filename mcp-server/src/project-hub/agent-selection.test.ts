import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentSelectionSource, normalizeCompatibleBindings } from './agent-selection.js';

const capabilities = [{ capability: 'workflow.recovery.plan', state: 'available' as const }];

test('Agent Domain selection keeps only enabled exact Project/Profile/capability tuples', () => {
  const result = normalizeCompatibleBindings('project/alpha', capabilities, [
    { role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 2, profileId: 'agent/builder', profileRevision: 3, projectId: 'project/alpha', capabilityClaims: ['workflow.recovery.plan'] },
    { role: 'disabled', bindingId: 'binding/alpha/disabled', bindingRevision: 1, profileId: 'agent/disabled', profileRevision: 1, enabled: false },
    { role: 'foreign', bindingId: 'binding/beta/foreign', bindingRevision: 1, profileId: 'agent/foreign', profileRevision: 1, projectId: 'project/beta' },
    { role: 'stale', bindingId: 'binding/alpha/stale', bindingRevision: 1, profileId: 'agent/stale', profileRevision: 1, projectContextCurrent: false },
  ]);
  assert.deepEqual(result.map((item) => item.bindingId), ['binding/alpha/builder']);
});

test('selection source normalizes reader output before exposing it', async () => {
  const source = createAgentSelectionSource(async () => [{ role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 1, profileId: 'agent/builder', profileRevision: 1, projectId: 'project/alpha', capabilityClaims: ['workflow.recovery.plan'] }]);
  assert.deepEqual(await source.listCompatible('project/alpha', capabilities), [{ role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 1, profileId: 'agent/builder', profileRevision: 1 }]);
});

test('selection rejects missing Project and incomplete capability claims', () => {
  const result = normalizeCompatibleBindings('project/alpha', capabilities, [
    { role: 'missing-project', bindingId: 'binding/missing-project', bindingRevision: 1, profileId: 'agent/a', profileRevision: 1, capabilityClaims: ['workflow.recovery.plan'] },
    { role: 'missing-claim', bindingId: 'binding/missing-claim', bindingRevision: 1, profileId: 'agent/b', profileRevision: 1, projectId: 'project/alpha', capabilityClaims: [] },
  ]);
  assert.deepEqual(result, []);
});
