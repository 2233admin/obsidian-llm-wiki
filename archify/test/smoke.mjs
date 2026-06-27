import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-smoke-'));

const targets = [
  ['workflow', 'agent-tool-call.workflow.json'],
  ['sequence', 'cache-miss-request.sequence.json'],
  ['dataflow', 'product-analytics.dataflow.json'],
  ['lifecycle', 'agent-run.lifecycle.json'],
  ['architecture', 'web-app.architecture.json'],
];

for (const [mode, input] of targets) {
  const out = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', input),
    out,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const html = fs.readFileSync(out, 'utf8');
  if (!html.includes('<svg') || !html.includes('Built with Archify')) {
    throw new Error(`${mode} renderer did not produce an Archify HTML diagram`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('archify smoke render ok');
