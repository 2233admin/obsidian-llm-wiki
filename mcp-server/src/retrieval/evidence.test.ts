import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { SearchResult } from '../adapters/interface.js';
import {
  boundedDiagnosticCode,
  buildRetrievalPlan,
  normalizeSearchResult,
  redactTraceValue,
  routeEvidence,
} from './evidence.js';

interface EvaluationCase {
  name: string;
  intent?: string;
  detail?: string;
  compiledFreshness?: string;
  expectedFirstTier?: string;
  explanation?: string;
  expectedExplanation?: boolean;
  error?: string;
  expectedDiagnostic?: string;
}

const evaluations = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/evaluation-cases.json', import.meta.url)),
  'utf8',
)) as EvaluationCase[];

describe('normalized retrieval evidence', () => {
  test('normalizes provider identifiers, tiers, freshness, provenance, score semantics, and explanation', () => {
    const result = normalizeSearchResult({
      source: 'qmd',
      path: 'Notes/alpha.md',
      content: 'alpha',
      score: 0.9,
      metadata: {
        uri: 'qmd://vault/Notes/alpha.md?token=secret',
        profileRevision: 'qmd/2.5',
        sourceId: 'source/alpha',
        sourceRevision: 'sha256:abc',
        freshness: 'fresh',
        explanation: 'semantic match',
      },
    });
    assert.equal(result.evidence.tier, 'adapter-evidence');
    assert.equal(result.evidence.freshness.state, 'fresh');
    assert.equal(result.evidence.provenance.providerId, 'qmd');
    assert.equal(result.evidence.provenance.profileRevision, 'qmd/2.5');
    assert.equal(result.evidence.provenance.originalIdentifier.includes('secret'), false);
    assert.match(result.evidence.normalizedIdentifier, /^llmwiki:\/\/evidence\/qmd\//);
    assert.equal(result.evidence.scoreSemantics, 'provider-relevance');
    assert.equal(result.evidence.explanation, 'semantic match');
  });

  test('marks compiled projection stale when its active Source revision differs', () => {
    const result = normalizeSearchResult({
      source: 'filesystem',
      path: 'topic/wiki/concepts/alpha.md',
      content: 'alpha',
      score: 1,
      metadata: { projectionRevision: 'rev/1', activeSourceRevision: 'rev/2', sourceRevision: 'rev/1' },
    });
    assert.equal(result.evidence.tier, 'compiled');
    assert.equal(result.evidence.freshness.state, 'stale');
    assert.equal(result.evidence.provenance.authority, 'rebuildable-projection');
  });

  test('routes raw Evidence ahead of stale or missing-provenance compilation for high-detail factual queries', () => {
    const plan = buildRetrievalPlan('factual support', 'high');
    const results: SearchResult[] = [
      {
        source: 'filesystem', path: 'topic/wiki/concepts/alpha.md', content: 'compiled', score: 1,
        metadata: { freshness: 'stale' },
      },
      {
        source: 'filesystem', path: '00-Inbox/Evidence/alpha.md', content: 'raw', score: 0.5,
        metadata: { sourceId: 'source/alpha', sourceRevision: 'rev/2', freshness: 'fresh' },
      },
    ];
    const routed = routeEvidence(results, plan);
    assert.equal(routed[0]?.evidence.tier, 'raw-evidence');
    assert.equal(plan.requireFreshness, true);
    assert.equal(plan.requireProvenance, true);
  });

  test('maps adapter partial capability without failing the host', () => {
    const result = normalizeSearchResult({
      source: 'lightrag',
      path: 'lightrag:/chunk/1',
      content: 'partial',
      score: 0.5,
      metadata: { partial: true, missingCapabilities: ['query.explain'], diagnosticCodes: ['partial_result'] },
    });
    assert.equal(result.evidence.partial.status, 'partial');
    assert.deepEqual(result.evidence.partial.missingCapabilities, ['query.explain']);
    assert.deepEqual(result.evidence.partial.diagnosticCodes, ['PARTIAL_RESULT']);
  });

  test('evaluation fixtures cover navigation, support, freshness, provenance, explanation, timeout, and secret reflection', () => {
    assert.deepEqual(evaluations.map((item) => item.name), [
      'navigation',
      'factual-support',
      'stale-compilation',
      'missing-provenance',
      'provider-explanation',
      'adapter-timeout',
      'sensitive-error-reflection',
    ]);
    for (const item of evaluations) {
      if (item.expectedFirstTier) {
        assert.equal(buildRetrievalPlan(item.intent, item.detail).tierOrder[0], item.expectedFirstTier);
      }
      if (item.error) assert.equal(boundedDiagnosticCode(new Error(item.error)), item.expectedDiagnostic);
      if (item.expectedExplanation) {
        const normalized = normalizeSearchResult({
          source: 'qmd', path: 'a.md', content: 'a', score: 1, metadata: { explanation: item.explanation },
        });
        assert.equal(Boolean(normalized.evidence.explanation), true);
      }
    }
  });

  test('redacts nested secrets, credential URLs, and local paths from trace payloads', () => {
    const redacted = redactTraceValue({
      apiKey: 'secret',
      endpoint: 'https://user:pass@example.test/api?token=secret',
      local: 'C:\\Users\\Administrator\\vault\\secret.md',
    });
    const text = JSON.stringify(redacted);
    assert.equal(text.includes('pass'), false);
    assert.equal(text.includes('token=secret'), false);
    assert.equal(text.includes('Administrator'), false);
    assert.match(text, /\[redacted/);
  });
});
