import { execFile } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type {
  ProblemObservation,
  ProjectId,
} from '../../../packages/problem-intake/dist/src/index.js';
import { ProblemIntakeExecutionError } from './contracts.js';
import type { ProblemIntakeExecutor } from './executor.js';
import { normalizeObcDiagnostic } from './obc-adapter.js';
import { asRecord, invalid, requiredString } from './safety.js';

const execFileAsync = promisify(execFile);
const MAX_DIAGNOSTICS = 10_000;

export interface ObcCheckReport {
  version: string;
  diagnostics: unknown[];
  summary?: Record<string, unknown>;
}

export interface ObcRunner {
  check(vaultPath: string): Promise<ObcCheckReport>;
}

export interface ExecFileObcRunnerOptions {
  pythonCommand?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
  cwd?: string;
}

function parseReport(value: unknown): ObcCheckReport {
  const item = asRecord(value, 'obcReport', ['version', 'vault', 'summary', 'diagnostics']);
  const version = requiredString(item.version, 'obcReport.version', 64);
  if (!Array.isArray(item.diagnostics)) invalid('obcReport.diagnostics must be an array');
  if (item.diagnostics.length > MAX_DIAGNOSTICS) {
    invalid(`obcReport.diagnostics exceeds ${MAX_DIAGNOSTICS} entries`);
  }
  const summary = item.summary === undefined
    ? undefined
    : asRecord(item.summary, 'obcReport.summary');
  return { version, diagnostics: item.diagnostics, summary };
}

/**
 * Runs the checked-in OBC CLI without a shell. Command, cwd, timeout and output
 * bounds are explicit so vault paths can never become shell syntax.
 */
export function createExecFileObcRunner(
  options: ExecFileObcRunnerOptions = {},
): ObcRunner {
  const pythonCommand = options.pythonCommand ?? 'python';
  const timeout = options.timeoutMs ?? 30_000;
  const maxBuffer = options.maxBufferBytes ?? 8 * 1024 * 1024;
  return {
    async check(vaultPath: string): Promise<ObcCheckReport> {
      let stdout: string;
      try {
        const result = await execFileAsync(
          pythonCommand,
          ['-m', 'obc.cli', 'check', vaultPath, '--format', 'json'],
          {
            cwd: options.cwd,
            timeout,
            maxBuffer,
            windowsHide: true,
            encoding: 'utf8',
          },
        );
        stdout = result.stdout;
      } catch (error) {
        throw new ProblemIntakeExecutionError(
          'UNAVAILABLE',
          'OBC diagnostic scan failed without producing a trusted report',
          { cause: error instanceof Error ? error.message : 'unknown OBC failure' },
        );
      }
      try {
        return parseReport(JSON.parse(stdout));
      } catch (error) {
        if (error instanceof ProblemIntakeExecutionError) throw error;
        throw new ProblemIntakeExecutionError(
          'INVALID_INPUT',
          'OBC returned invalid JSON; no diagnostics were persisted',
        );
      }
    },
  };
}

function vaultRelativeEvidencePath(vaultPath: string, candidate: unknown): unknown {
  if (typeof candidate !== 'string' || !candidate.trim()) return candidate;
  const normalizedVault = resolve(vaultPath);
  const normalizedCandidate = resolve(candidate);
  if (!isAbsolute(candidate)) return candidate.replaceAll('\\', '/');
  const rel = relative(normalizedVault, normalizedCandidate);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new ProblemIntakeExecutionError(
      'INVALID_INPUT',
      'OBC returned diagnostic evidence outside the configured vault',
    );
  }
  return rel.replaceAll('\\', '/');
}

function removeMachinePath(vaultPath: string, diagnostic: unknown): unknown {
  const item = asRecord(diagnostic, 'diagnostic');
  return {
    ...item,
    source_file: vaultRelativeEvidencePath(vaultPath, item.source_file),
    candidates: Array.isArray(item.candidates)
      ? item.candidates.map((candidate) => vaultRelativeEvidencePath(vaultPath, candidate))
      : item.candidates,
  };
}

export interface RunObcScanInput {
  projectId: ProjectId;
  vaultPath: string;
  runner: ObcRunner;
  executor: ProblemIntakeExecutor;
  observedAt?: string;
}

/** Shared read-only compatibility surface for the deprecated vault.lint tool. */
export async function runObcReadOnlyLint(input: {
  vaultPath: string;
  runner: ObcRunner;
}): Promise<{
  provider: 'obc';
  providerVersion: string;
  diagnostics: unknown[];
  summary?: Record<string, unknown>;
  deprecatedTool: 'vault.lint';
  replacement: 'problem.intake.scan';
}> {
  const report = await input.runner.check(input.vaultPath);
  return {
    provider: 'obc',
    providerVersion: report.version,
    diagnostics: report.diagnostics.map((diagnostic) =>
      removeMachinePath(input.vaultPath, diagnostic)),
    summary: report.summary,
    deprecatedTool: 'vault.lint',
    replacement: 'problem.intake.scan',
  };
}

export async function runObcProblemScan(input: RunObcScanInput): Promise<{
  provider: 'obc';
  providerVersion: string;
  projectId: ProjectId;
  diagnosticCount: number;
  ignoredPassingCount: number;
  createdCount: number;
  deduplicatedCount: number;
  observations: ProblemObservation[];
  summary?: Record<string, unknown>;
}> {
  const report = await input.runner.check(input.vaultPath);
  const observedAt = input.observedAt ?? new Date().toISOString();
  const observations: ProblemObservation[] = [];
  let ignoredPassingCount = 0;
  let createdCount = 0;
  let deduplicatedCount = 0;
  for (const rawDiagnostic of report.diagnostics) {
    const normalized = normalizeObcDiagnostic({
      projectId: input.projectId,
      obcVersion: report.version,
      diagnostic: removeMachinePath(input.vaultPath, rawDiagnostic),
      observedAt,
    });
    if (!normalized) {
      ignoredPassingCount += 1;
      continue;
    }
    const result = await input.executor.observe(normalized);
    observations.push(result.observation);
    if (result.deduplicated) deduplicatedCount += 1;
    else createdCount += 1;
  }
  return {
    provider: 'obc',
    providerVersion: report.version,
    projectId: input.projectId,
    diagnosticCount: report.diagnostics.length,
    ignoredPassingCount,
    createdCount,
    deduplicatedCount,
    observations,
    summary: report.summary,
  };
}
