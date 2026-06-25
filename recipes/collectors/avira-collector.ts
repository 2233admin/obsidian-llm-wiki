#!/usr/bin/env node
/**
 * avira-collector.ts -- local Avira / 小红伞 scan report collector.
 *
 * Environment:
 * AVIRA_SCAN_CMD        Required command template. Use {target} placeholder.
 * AVIRA_SCAN_TARGET     Optional explicit path to scan.
 * AVIRA_SCAN_TIMEOUT_MS Optional timeout, default 600000.
 * VAULT_MIND_VAULT_PATH / VAULT_PATH / VAULT_DIR optional vault output root.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { spawnSync } from 'node:child_process';

const RECIPE_ID = 'avira-to-vault';
const STATE_DIR = join(homedir(), '.vault-mind', 'recipes', RECIPE_ID);
const HEARTBEAT_FILE = join(STATE_DIR, 'heartbeat.jsonl');

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function appendHeartbeat(event: string, data: Record<string, unknown>): void {
  ensureDir(STATE_DIR);
  appendFileSync(HEARTBEAT_FILE, JSON.stringify({ ts: new Date().toISOString(), event, data }) + '\n', 'utf8');
}

function shellQuote(value: string): string {
  if (platform() === 'win32') return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function slugTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:]/g, '-');
}

function fenced(label: string, value: string): string {
  return [`### ${label}`, '', '```text', value.trim() || '(empty)', '```', ''].join('\n');
}

const commandTemplate = process.env.AVIRA_SCAN_CMD?.trim();
if (!commandTemplate) {
  process.stderr.write('[avira-collector] ERROR: AVIRA_SCAN_CMD is required\n');
  process.exit(2);
}

const vaultRoot = process.env.VAULT_MIND_VAULT_PATH || process.env.VAULT_PATH || process.env.VAULT_DIR;
const target = resolve(
  process.env.AVIRA_SCAN_TARGET ||
    process.env.VAULT_MIND_VAULT_PATH ||
    process.env.VAULT_PATH ||
    process.env.VAULT_DIR ||
    process.cwd(),
);
const timeoutMs = Number(process.env.AVIRA_SCAN_TIMEOUT_MS || 600_000);
const scanCommand = commandTemplate.includes('{target}')
  ? commandTemplate.replaceAll('{target}', shellQuote(target))
  : `${commandTemplate} ${shellQuote(target)}`;

const startedAt = new Date();
process.stderr.write(`[avira-collector] scanning target=${target}\n`);
const result = spawnSync(scanCommand, {
  shell: true,
  encoding: 'utf8',
  timeout: timeoutMs,
  maxBuffer: 10 * 1024 * 1024,
});
const finishedAt = new Date();
const exitCode = typeof result.status === 'number' ? result.status : result.error ? 124 : 1;
const stdout = result.stdout ?? '';
const stderr = result.stderr ?? (result.error ? String(result.error) : '');
const ok = exitCode === 0;

const outputDir = vaultRoot ? join(vaultRoot, '00-Inbox', 'Security', 'avira') : join(STATE_DIR, 'reports');
ensureDir(outputDir);
const reportPath = join(outputDir, `${slugTimestamp(startedAt)}-avira-scan.md`);
const report = [
  '---',
  'llmwiki-security-scan: true',
  'scanner: avira',
  `target: ${JSON.stringify(target)}`,
  `started-at: ${JSON.stringify(startedAt.toISOString())}`,
  `finished-at: ${JSON.stringify(finishedAt.toISOString())}`,
  `exit-code: ${exitCode}`,
  `status: ${ok ? 'clean-or-no-error' : 'attention-required'}`,
  '---',
  '',
  `# Avira / 小红伞 Scan -- ${startedAt.toISOString()}`,
  '',
  '## Summary',
  '',
  ok
    ? '- Scanner exited with code 0. Treat as clean only if your configured Avira command uses 0 for no detections.'
    : '- Scanner returned a non-zero exit code, timed out, or errored. Review stdout/stderr before taking action.',
  `- Target: \`${target}\``,
  `- Exit code: \`${exitCode}\``,
  '',
  '## Command Template',
  '',
  '```text',
  commandTemplate,
  '```',
  '',
  fenced('Stdout', stdout),
  fenced('Stderr', stderr),
].join('\n');

writeFileSync(reportPath, report, 'utf8');
appendHeartbeat('scan', { ok, exit_code: exitCode, target, report: reportPath });

process.stdout.write(`${reportPath}\n`);
process.stderr.write(`[avira-collector] report=${reportPath} exit_code=${exitCode}\n`);
process.exit(exitCode);
