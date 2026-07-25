import {
  parseProblemReport,
  type ProblemReport,
  type ProblemSeverity,
  type ProjectId,
} from '../../../packages/problem-intake/dist/src/index.js';
import {
  asRecord,
  canonicalProjectId,
  invalid,
  requiredString,
  stableId,
  timestamp,
} from './safety.js';

const OBC_CODES = new Set([
  'BROKEN_CERTAIN',
  'BROKEN_FRAGMENT_ONLY',
  'AMBIGUOUS_TARGET',
  'FUZZY_MATCH',
  'INTENTIONAL_DANGLING',
  'SEMANTIC_MATCH',
  'UNSUPPORTED_SYNTAX',
]);

const SEVERITY_MAP: Record<string, ProblemSeverity> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
};

function normalizeVaultPath(value: unknown, path: string): string {
  const source = requiredString(value, path, 2_048).replaceAll('\\', '/');
  if (/^[A-Za-z]:\//.test(source) || source.startsWith('/')) {
    invalid(`${path} must be vault-relative; OBC must strip the scan-root prefix`);
  }
  const normalized = source.replace(/^\.\/+/, '');
  if (!normalized || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    invalid(`${path} is not a canonical vault-relative path`);
  }
  return normalized;
}

export interface NormalizeObcDiagnosticInput {
  projectId: ProjectId;
  obcVersion: string;
  diagnostic: unknown;
  observedAt: string;
}

/**
 * Maps the checked-in OBC JSON diagnostic contract to the canonical
 * @obsidian-llm-wiki/problem-intake ProblemReport. Passing diagnostics are
 * ignored; verification of a prior observation uses the canonical verify API.
 */
export function normalizeObcDiagnostic(
  input: NormalizeObcDiagnosticInput,
): ProblemReport | undefined {
  const projectId = canonicalProjectId(input.projectId);
  const obcVersion = requiredString(input.obcVersion, 'obcVersion', 128);
  const observedAt = timestamp(input.observedAt, 'observedAt');
  const item = asRecord(input.diagnostic, 'diagnostic', [
    'id',
    'code',
    'severity',
    'source_file',
    'line',
    'raw_text',
    'target_raw',
    'message',
    'candidates',
    'fragment_exists',
    'fragment_type',
    'suggested_fix',
    'safety_level',
  ]);
  const code = requiredString(item.code, 'diagnostic.code', 64);
  if (!OBC_CODES.has(code)) return undefined;
  const sourcePath = normalizeVaultPath(item.source_file, 'diagnostic.source_file');
  const target = requiredString(item.target_raw, 'diagnostic.target_raw', 500);
  const severityValue = SEVERITY_MAP[requiredString(item.severity, 'diagnostic.severity', 16)];
  if (!severityValue) invalid('diagnostic.severity is unsupported');
  if (!Number.isInteger(item.line) || (item.line as number) < 1) {
    invalid('diagnostic.line must be a positive integer');
  }
  const candidates = item.candidates === undefined ? [] : item.candidates;
  if (!Array.isArray(candidates) || candidates.length > 20) {
    invalid('diagnostic.candidates must be a bounded array');
  }
  const evidenceRefs: ProblemReport['evidenceRefs'] = [
    {
      kind: 'vault_path',
      ref: sourcePath,
      summary: `Line ${item.line}: OBC ${code} for ${target}`,
    },
    {
      kind: 'provider_finding',
      ref: `obc/${stableId(String(item.id ?? `link_${item.line}`), 'diagnostic.id')}`,
      summary: requiredString(item.raw_text, 'diagnostic.raw_text', 500),
    },
    ...candidates.map((candidate, index) => ({
      kind: 'vault_path' as const,
      ref: normalizeVaultPath(candidate, `diagnostic.candidates[${index}]`),
      summary: 'OBC resolution candidate',
    })),
  ];
  const report: ProblemReport = {
    schemaVersion: 1,
    projectId,
    provider: { id: 'obc', version: obcVersion, kind: 'obc' },
    ruleId: code.toLowerCase().replaceAll('_', '-'),
    subject: { kind: 'vault_path', canonicalRef: sourcePath },
    severity: severityValue,
    summary: requiredString(item.message ?? `${code}: ${target}`, 'diagnostic.message', 1_000),
    evidenceRefs,
    observedAt,
    ...(typeof item.suggested_fix === 'string' && item.suggested_fix.trim()
      ? { suggestedAction: requiredString(item.suggested_fix, 'diagnostic.suggested_fix', 1_000) }
      : {}),
  };
  return parseProblemReport(report);
}
