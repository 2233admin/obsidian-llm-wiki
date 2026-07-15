import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { createUsageEvent, known, unknown } from './contracts.js';
import { runUsageCli } from './cli.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-usage-cli-'));
  roots.push(root);
  mkdirSync(join(root, 'Projects'), { recursive: true });
  writeFileSync(join(root, 'Projects', 'alpha.md'), [
    '---', 'type: project', 'entity: project/alpha', 'lifecycle: active', '---', '# Alpha', '',
  ].join('\n'));
  const event = createUsageEvent({
    idempotencyKey: 'provider-call:usage-cli-alpha-one',
    kind: 'model',
    occurredAt: '2026-07-15T00:00:00.000Z',
    dimensions: {
      project: known('project/alpha'), agent: known('agent-profile/codex'),
      thread: unknown('not-applicable'), workRun: unknown('not-reported'),
      provider: known('provider/local'), model: known('model/qwen'), device: known('device/local'),
      operation: known('model.invoke'),
    },
    providerFacts: {
      inputTokens: known(100), outputTokens: known(20),
      providerReportedCost: unknown('not-reported'), currency: unknown('not-reported'),
    },
    provenance: ['provider-call:usage-cli-alpha-one'],
  });
  const eventFile = join(root, 'event.json');
  writeFileSync(eventFile, JSON.stringify(event));
  return { root, eventFile };
}

describe('Usage CLI', () => {
  test('reuses the governed MCP operation layer for append and Project projection', async () => {
    const { root, eventFile } = fixture();
    const appended = await runUsageCli([
      'append', '--vault', root, '--project', 'project/alpha', '--event-file', eventFile,
    ]);
    assert.equal((appended.result as Record<string, unknown>).status, 'created');
    const replay = await runUsageCli([
      'append', '--vault', root, '--project', 'project/alpha', '--event-file', eventFile,
    ]);
    assert.equal((replay.result as Record<string, unknown>).status, 'replayed');

    const projected = await runUsageCli([
      'project', '--vault', root, '--project', 'project/alpha', '--group-by', 'agent,model',
    ]);
    const projection = (projected.result as { projection: { sourceEventCount: number } }).projection;
    assert.equal(projection.sourceEventCount, 1);
  });

  test('fails closed for an unregistered Project before appending', async () => {
    const { root, eventFile } = fixture();
    await assert.rejects(
      runUsageCli(['append', '--vault', root, '--project', 'project/missing', '--event-file', eventFile]),
      /Project not found/i,
    );
  });
});
