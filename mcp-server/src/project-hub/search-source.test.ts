import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectSearchSource } from './search-source.js';
import { fingerprintRecoveryValue } from './contract-support.js';

const digest = (value: unknown) => fingerprintRecoveryValue(value);

test('Project owner source keeps only safe current records and excludes foreign Projects before hashing', async () => {
  const source = createProjectSearchSource({
    'work-os': () => [
      { itemId: 'project/other/issue/secret', itemType: 'issue', label: 'foreign', projectId: 'project/other', text: 'recovery', citationTargets: ['other:issue'] },
      { itemId: 'project/alpha/issue/build', itemType: 'issue', label: 'Build recovery', projectId: 'project/alpha', text: 'recovery build', citationTargets: ['alpha:issue'] },
    ],
  });
  const [workOs] = await source.snapshot('project/alpha');
  assert.deepEqual(workOs?.items.map((item) => item.itemId), ['project/alpha/issue/build']);
  assert.equal(workOs?.items[0]?.projectId, 'project/alpha');
  assert.equal(workOs?.fingerprint, digest(workOs?.items));
});

test('owner failures are explicit and do not leak thrown material', async () => {
  const source = createProjectSearchSource({
    workflow: () => { throw new Error('C:\\private\\transcript-token'); },
    'project-memory': () => ({ state: 'stale', revision: 7, fingerprint: digest({ memory: 7 }), items: [], diagnostics: [] }),
  });
  const owners = await source.snapshot('project/alpha');
  const workflow = owners.find((owner) => owner.owner === 'workflow');
  const memory = owners.find((owner) => owner.owner === 'project-memory');
  assert.equal(workflow?.state, 'unavailable');
  assert.match(JSON.stringify(workflow), /owner_unavailable/u);
  assert.doesNotMatch(JSON.stringify(workflow), /private|transcript|token/u);
  assert.equal(memory?.state, 'stale');
  assert.equal(memory?.revision, 7);
});

test('invalid owner state is unavailable and its items never index as current', async () => {
  const source = createProjectSearchSource({
    'work-os': () => ({ state: 'corrupted' as never, items: [{ itemId: 'project/alpha/issue/build', itemType: 'issue', label: 'Build', text: 'build', citationTargets: ['issue:build'] }] }),
  });
  const [workOs] = await source.snapshot('project/alpha');
  assert.equal(workOs?.state, 'unavailable');
  assert.deepEqual(workOs?.items, []);
  assert.ok(workOs?.diagnostics.some((item) => item.code === 'owner_state_invalid'));
});
