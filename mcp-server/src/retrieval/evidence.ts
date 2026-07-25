import { createHash } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';

import type { SearchResult } from '../adapters/interface.js';

export const EVIDENCE_TIERS = ['compiled', 'raw-evidence', 'adapter-evidence'] as const;
export const FRESHNESS_STATES = ['fresh', 'stale', 'unknown', 'incompatible'] as const;

export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];
export type FreshnessState = (typeof FRESHNESS_STATES)[number];
export type RetrievalDetail = 'low' | 'medium' | 'high';

export interface EvidenceFreshness {
  state: FreshnessState;
  observedAt?: string;
  reason?: string;
}

export interface EvidenceProvenance {
  providerId: string;
  originalIdentifier: string;
  sourceId?: string;
  sourceRevision?: string;
  profileRevision?: string;
  authority: 'rebuildable-projection' | 'immutable-evidence' | 'external-read-only';
}

export interface EvidencePartialStatus {
  status: 'complete' | 'partial';
  missingCapabilities: string[];
  diagnosticCodes: string[];
}

export interface NormalizedEvidence {
  schemaVersion: 1;
  normalizedIdentifier: string;
  tier: EvidenceTier;
  freshness: EvidenceFreshness;
  provenance: EvidenceProvenance;
  scoreSemantics: 'literal-match' | 'provider-relevance' | 'graph-proximity' | 'relative-rank' | 'unknown';
  explanation?: string;
  partial: EvidencePartialStatus;
}

export interface NormalizedSearchResult extends SearchResult {
  evidence: NormalizedEvidence;
}

export interface RetrievalPlan {
  schemaVersion: 1;
  intent: string;
  detail: RetrievalDetail;
  tierOrder: EvidenceTier[];
  requireFreshness: boolean;
  requireProvenance: boolean;
  fallbacks: Array<{
    from: EvidenceTier;
    to: EvidenceTier;
    reason: 'stale-projection' | 'missing-provenance' | 'factual-support' | 'quotation' | 'high-detail';
  }>;
}

const EXTERNAL_ADAPTERS = new Set(['qmd', 'graphify', 'lightrag', 'raganything', 'rag-anything', 'hindsight']);
const SENSITIVE_KEY = /(?:token|api[_-]?key|secret|password|authorization|credential)/i;

export function normalizeSearchResult(result: SearchResult, adapterName = result.source): NormalizedSearchResult {
  if (result.evidence) return { ...result, evidence: sanitizeEvidence(result.evidence) };
  const metadata = result.metadata ?? {};
  const tier = inferEvidenceTier(adapterName, result.path, metadata.evidenceTier);
  const originalIdentifier = stringValue(metadata.uri)
    ?? stringValue(metadata.originalIdentifier)
    ?? result.path;
  const providerId = normalizeProviderId(adapterName);
  const profileRevision = stringValue(metadata.profileRevision);
  const sourceRevision = stringValue(metadata.sourceRevision);
  const sourceId = stringValue(metadata.sourceId);
  const freshness = inferFreshness(tier, metadata);
  const missingCapabilities = stringArray(metadata.missingCapabilities);
  const diagnosticCodes = normalizedDiagnosticCodes(metadata.diagnosticCodes);
  const partial = metadata.partial === true || missingCapabilities.length > 0 || diagnosticCodes.includes('PARTIAL_RESULT');
  const explanation = boundedText(metadata.explanation ?? metadata.context);
  return {
    ...result,
    evidence: {
      schemaVersion: 1,
      normalizedIdentifier: normalizedEvidenceIdentifier(providerId, result.path),
      tier,
      freshness,
      provenance: {
        providerId,
        originalIdentifier: redactIdentifier(originalIdentifier),
        ...(sourceId ? { sourceId } : {}),
        ...(sourceRevision ? { sourceRevision } : {}),
        ...(profileRevision ? { profileRevision } : {}),
        authority: tier === 'compiled'
          ? 'rebuildable-projection'
          : tier === 'raw-evidence'
            ? 'immutable-evidence'
            : 'external-read-only',
      },
      scoreSemantics: inferScoreSemantics(adapterName),
      ...(explanation ? { explanation } : {}),
      partial: {
        status: partial ? 'partial' : 'complete',
        missingCapabilities,
        diagnosticCodes,
      },
    },
  };
}

export function buildRetrievalPlan(intentValue?: string, detailValue?: string): RetrievalPlan {
  const intent = normalizeIntent(intentValue);
  const detail = normalizeDetail(detailValue);
  const quotation = /(?:quote|quotation|verbatim|citation|原文|引用)/i.test(intent);
  const factual = /(?:fact|support|verify|evidence|事实|证据|核实)/i.test(intent);
  const navigation = /(?:navigate|overview|concept|relationship|browse|导航|概览|概念)/i.test(intent);
  const rawFirst = quotation || factual || detail === 'high';
  const tierOrder: EvidenceTier[] = rawFirst
    ? ['raw-evidence', 'compiled', 'adapter-evidence']
    : navigation
      ? ['compiled', 'raw-evidence', 'adapter-evidence']
      : ['compiled', 'adapter-evidence', 'raw-evidence'];
  const fallbacks: RetrievalPlan['fallbacks'] = [
    { from: 'compiled', to: 'raw-evidence', reason: 'stale-projection' },
    { from: 'compiled', to: 'raw-evidence', reason: 'missing-provenance' },
  ];
  if (quotation) fallbacks.push({ from: 'compiled', to: 'raw-evidence', reason: 'quotation' });
  else if (factual) fallbacks.push({ from: 'compiled', to: 'raw-evidence', reason: 'factual-support' });
  else if (detail === 'high') fallbacks.push({ from: 'compiled', to: 'raw-evidence', reason: 'high-detail' });
  return {
    schemaVersion: 1,
    intent,
    detail,
    tierOrder,
    requireFreshness: rawFirst,
    requireProvenance: rawFirst,
    fallbacks,
  };
}

export function routeEvidence(results: readonly SearchResult[], plan: RetrievalPlan): NormalizedSearchResult[] {
  const normalized = results.map((result) => normalizeSearchResult(result));
  const needsRawFallback = normalized.some((result) => result.evidence.tier === 'compiled'
    && (
      (plan.requireFreshness && result.evidence.freshness.state !== 'fresh')
      || (plan.requireProvenance && !result.evidence.provenance.sourceRevision)
    ));
  const tierOrder = needsRawFallback
    ? uniqueTiers(['raw-evidence', ...plan.tierOrder])
    : plan.tierOrder;
  const priority = new Map(tierOrder.map((tier, index) => [tier, index]));
  return normalized.sort((left, right) =>
    (priority.get(left.evidence.tier) ?? 99) - (priority.get(right.evidence.tier) ?? 99)
    || right.score - left.score
    || left.evidence.normalizedIdentifier.localeCompare(right.evidence.normalizedIdentifier));
}

export function boundedDiagnosticCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/(?:timeout|timed out|etimedout|abort)/i.test(message)) return 'PROVIDER_TIMEOUT';
  if (/(?:parse|json|schema|invalid|malformed)/i.test(message)) return 'INCOMPATIBLE_OUTPUT';
  if (SENSITIVE_KEY.test(message) || /https?:\/\/[^\s]+/i.test(message)) return 'SENSITIVE_ERROR_REDACTED';
  return 'PROVIDER_UNAVAILABLE';
}

export function redactTraceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactTraceValue);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? redactIdentifier(value) : value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactTraceValue(item);
  }
  return output;
}

function sanitizeEvidence(value: NormalizedEvidence): NormalizedEvidence {
  return {
    ...value,
    normalizedIdentifier: normalizedEvidenceIdentifier(value.provenance.providerId, value.normalizedIdentifier),
    provenance: {
      ...value.provenance,
      providerId: normalizeProviderId(value.provenance.providerId),
      originalIdentifier: redactIdentifier(value.provenance.originalIdentifier),
    },
    explanation: boundedText(value.explanation),
    partial: {
      status: value.partial.status,
      missingCapabilities: stringArray(value.partial.missingCapabilities),
      diagnosticCodes: normalizedDiagnosticCodes(value.partial.diagnosticCodes),
    },
  };
}

function inferEvidenceTier(adapterName: string, path: string, configured: unknown): EvidenceTier {
  if (typeof configured === 'string' && EVIDENCE_TIERS.includes(configured as EvidenceTier)) return configured as EvidenceTier;
  if (EXTERNAL_ADAPTERS.has(adapterName.toLowerCase())) return 'adapter-evidence';
  const portable = path.replace(/\\/g, '/').toLowerCase();
  if (/(?:^|\/)(?:wiki|concepts|summaries)(?:\/|$)/.test(portable) || portable.includes('_knowledge_base/')) return 'compiled';
  if (portable.includes('00-inbox/evidence/') || portable.includes('/raw/') || portable.startsWith('raw/')) return 'raw-evidence';
  return adapterName === 'filesystem' ? 'raw-evidence' : 'adapter-evidence';
}

function inferFreshness(tier: EvidenceTier, metadata: Record<string, unknown>): EvidenceFreshness {
  const configured = stringValue(metadata.freshness);
  if (configured && FRESHNESS_STATES.includes(configured as FreshnessState)) {
    return { state: configured as FreshnessState, ...(stringValue(metadata.observedAt) ? { observedAt: stringValue(metadata.observedAt) } : {}) };
  }
  const projectionRevision = stringValue(metadata.projectionRevision);
  const activeSourceRevision = stringValue(metadata.activeSourceRevision);
  if (tier === 'compiled' && projectionRevision && activeSourceRevision) {
    return projectionRevision === activeSourceRevision
      ? { state: 'fresh', reason: 'projection-matches-active-source' }
      : { state: 'stale', reason: 'active-source-newer-than-projection' };
  }
  return { state: 'unknown', reason: tier === 'compiled' ? 'projection-freshness-not-proven' : 'provider-did-not-report-freshness' };
}

function inferScoreSemantics(adapterName: string): NormalizedEvidence['scoreSemantics'] {
  switch (adapterName.toLowerCase()) {
    case 'filesystem': return 'literal-match';
    case 'graphify': return 'graph-proximity';
    case 'qmd': return 'provider-relevance';
    case 'lightrag':
    case 'raganything':
    case 'rag-anything':
    case 'hindsight': return 'relative-rank';
    default: return 'unknown';
  }
}

function normalizedEvidenceIdentifier(providerId: string, value: string): string {
  if (/^llmwiki:\/\/evidence\//.test(value)) return value;
  const portable = value.replace(/\\/g, '/').replace(/^\/+/, '');
  const safe = portable.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment)).join('/');
  if (safe && !isAbsolute(value) && !/^[a-z]:[\\/]/i.test(value)) return `llmwiki://evidence/${providerId}/${safe}`;
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 20);
  return `llmwiki://evidence/${providerId}/redacted-${digest}`;
}

function redactIdentifier(value: string): string {
  if (isAbsolute(value) || /^[a-z]:[\\/]/i.test(value)) {
    return `[redacted-local-path]/${basename(value.replace(/\\/g, '/'))}`;
  }
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, '[redacted]');
    return url.toString();
  } catch {
    return value
      .replace(/(bearer\s+)[^\s]+/gi, '$1[redacted]')
      .replace(/((?:token|api[_-]?key|secret|password)=)[^&\s]+/gi, '$1[redacted]');
  }
}

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function normalizeIntent(value?: string): string {
  return value?.replace(/\s+/g, ' ').trim().slice(0, 120) || 'general';
}

function normalizeDetail(value?: string): RetrievalDetail {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const safe = redactIdentifier(value).replace(/\s+/g, ' ').trim();
  return safe ? safe.slice(0, 500) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].sort()
    : [];
}

function normalizedDiagnosticCodes(value: unknown): string[] {
  return stringArray(value).map((code) => code.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80));
}

function uniqueTiers(values: EvidenceTier[]): EvidenceTier[] {
  return [...new Set(values)];
}
