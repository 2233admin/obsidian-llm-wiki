import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { makeCausalOperations } from '../src/operations/causal.js';
import { makeHolonOperations } from '../src/operations/holon.js';
import { makeProvenanceOperations } from '../src/operations/provenance.js';

function makeVaultFixture(): { vaultPath: string; contextCorePath: string } {
  const vaultPath = mkdtempSync(join(tmpdir(), 'llmwiki-vault-'));
  const contextCorePath = join(vaultPath, 'KB', 'context-core');
  mkdirSync(join(contextCorePath, 'holons'), { recursive: true });
  writeJson(join(contextCorePath, 'manifest.json'), {
    version: '20260703-1200',
    domain: 'personal-knowledge',
  });
  writeJson(join(contextCorePath, 'holons', 'macro-fed.json'), {
    id: 'macro/fed-policy',
    domain: 'personal-knowledge',
    title: 'Fed policy',
    summary: 'Rates policy',
    facts: [
      {
        id: 'claim/rates-bonds',
        claim: 'Rate hikes push bond prices down',
        relation: 'causes',
        target: 'macro/bond-prices',
        confidence: 0.9,
        source_note: '04-Research/macro.md',
        paragraph_index: 2,
        extracted_by: 'human',
      },
    ],
    relations: [
      { predicate: 'causes', target: 'macro/bond-prices', confidence: 0.9, provenance_id: 'claim/rates-bonds' },
      { predicate: 'prevents', target: 'strategy/long-duration', confidence: 0.8 },
    ],
    provenance: { source_note: '04-Research/macro.md' },
  });
  writeJson(join(contextCorePath, 'holons', 'bond-prices.json'), {
    id: 'macro/bond-prices',
    domain: 'personal-knowledge',
    title: 'Bond prices',
    summary: 'Treasury price levels',
    relations: [
      { predicate: 'causes', target: 'strategy/short-duration', confidence: 0.5 },
    ],
  });
  writeJson(join(contextCorePath, 'holons', 'strategies.json'), [
    { id: 'strategy/short-duration', domain: 'personal-knowledge', title: 'Short duration', summary: '' },
    { id: 'strategy/long-duration', domain: 'personal-knowledge', title: 'Long duration', summary: '' },
  ]);
  writeJson(join(contextCorePath, 'causal-graph.json'), {
    edges: [
      { id: 'edge/fed-bonds', from: 'macro/fed-policy', to: 'macro/bond-prices', relation: 'causes', confidence: 0.9 },
      { id: 'edge/bonds-short', from: 'macro/bond-prices', to: 'strategy/short-duration', relation: 'causes', confidence: 0.5 },
      { id: 'edge/fed-long-prevents', from: 'macro/fed-policy', to: 'strategy/long-duration', relation: 'prevents', confidence: 0.8 },
    ],
    contradictions: [
      { topic: 'duration', claim_a: 'Duration works', claim_b: 'Duration does not work' },
    ],
  });
  writeJson(join(contextCorePath, 'provenance.json'), {
    'claim/rates-bonds': {
      source_note: '04-Research/macro.md',
      paragraph_index: 2,
      extracted_by: 'human',
    },
  });
  return { vaultPath, contextCorePath };
}

describe('Context Core MCP operations', () => {
  test('vault.holon returns a compiled holon by id', async () => {
    const fixture = makeVaultFixture();
    const op = makeHolonOperations(fixture.vaultPath).find((item) => item.name === 'vault.holon')!;
    const result = await op.handler({}, { id: 'macro/fed-policy' }) as Record<string, unknown>;
    assert.equal(result.id, 'macro/fed-policy');
    assert.equal(result.title, 'Fed policy');
  });

  test('graph.causes and graph.caused_by traverse Context Core edges', async () => {
    const fixture = makeVaultFixture();
    const ops = makeCausalOperations(fixture.vaultPath);
    const causes = ops.find((item) => item.name === 'graph.causes')!;
    const causedBy = ops.find((item) => item.name === 'graph.caused_by')!;
    const outbound = await causes.handler({}, { concept: 'macro/fed-policy', depth: 2 }) as { results: Array<{ id: string }> };
    const inbound = await causedBy.handler({}, { concept: 'macro/bond-prices', depth: 1 }) as { results: Array<{ id: string }> };
    assert.ok(outbound.results.some((item) => item.id === 'strategy/short-duration'));
    assert.ok(inbound.results.some((item) => item.id === 'macro/fed-policy'));
  });

  test('graph.causal_chain finds a confidence-pruned path', async () => {
    const fixture = makeVaultFixture();
    const chain = makeCausalOperations(fixture.vaultPath).find((item) => item.name === 'graph.causal_chain')!;
    const result = await chain.handler({}, {
      from: 'macro/fed-policy',
      to: 'strategy/short-duration',
      max_depth: 5,
      min_confidence: 0.3,
    }) as { status: string; cumulative_confidence: number; path: unknown[] };
    assert.equal(result.status, 'complete');
    assert.equal(result.path.length, 2);
    assert.equal(result.cumulative_confidence, 0.45);
  });

  test('graph.contradict_check returns explicit contradiction records', async () => {
    const fixture = makeVaultFixture();
    const op = makeCausalOperations(fixture.vaultPath).find((item) => item.name === 'graph.contradict_check')!;
    const result = await op.handler({}, { topic: 'duration' }) as { count: number };
    assert.equal(result.count, 1);
  });

  test('fact.provenance and context.export expose provenance and Context Core JSON', async () => {
    const fixture = makeVaultFixture();
    const ops = makeProvenanceOperations(fixture.vaultPath);
    const provenance = ops.find((item) => item.name === 'fact.provenance')!;
    const contextExport = ops.find((item) => item.name === 'context.export')!;
    const fact = await provenance.handler({}, { claim_id: 'claim/rates-bonds' }) as Record<string, unknown>;
    const exported = await contextExport.handler({}, { domain: 'personal-knowledge' }) as { holons: unknown[] };
    assert.equal(fact.source_note, '04-Research/macro.md');
    assert.equal(exported.holons.length, 4);
  });
});

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}
