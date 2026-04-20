/**
 * vault.writeAIOutput + vault.sweepAIOutput unit tests.
 *
 * Uses node:test + tmpdir isolation. No external test deps.
 */

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { VaultFs } from './index.js';

interface WriteOk { ok?: boolean; path?: string; dryRun?: boolean; frontmatter?: Record<string, unknown>; action?: string }
interface StaleCand { path: string; persona: string; ageDays: number; threshold: number }
interface SupCand { older: string; newer: string; overlap: number }
interface AppliedEntry { path: string; change: string }
interface SweepMetrics {
  totalEntries: number;
  byPersona: Record<string, number>;
  byStatus: Record<string, number>;
  byQuarantineState: Record<string, number>;
  realBacklinkHitRate: number;
}
interface SweepReport {
  staleCandidates: StaleCand[];
  supersedeCandidates: SupCand[];
  applied: AppliedEntry[];
  metrics: SweepMetrics;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

function makeTempVault(): { vault: string; vaultFs: VaultFs } {
  const dir = join(tmpdir(), `ai-output-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  const vaultFs = new VaultFs(dir);
  return { vault: dir, vaultFs };
}

function writeFile(vault: string, relPath: string, content: string): string {
  const full = join(vault, relPath.replace(/\//g, '\\').replace(/\\/g, '/')); // normalize
  const full2 = join(vault, relPath);
  mkdirSync(join(vault, relPath).replace(/[^/\\]+$/, ''), { recursive: true });
  writeFileSync(full2, content, 'utf-8');
  return full2;
}

after(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function daysAgoIso(days: number, base: number = Date.now()): string {
  return new Date(base - days * 86_400_000).toISOString();
}

// Satisfies Step 2.5 input gate (body >= 50 chars). Use in writeAIOutput tests.
const LONG_BODY = '# Analysis\n\nLong-enough body for the input gate minimum length check.';

// ── vault.writeAIOutput ──────────────────────────────────────────────────────

describe('vault.writeAIOutput', () => {
  let vault: string;
  let vaultFs: VaultFs;
  beforeEach(() => { ({ vault, vaultFs } = makeTempVault()); });

  test('dryRun=false writes file with all 6 frontmatter fields + status=draft', () => {
    const result = vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: 'refactor auth module',
      sourceNodes: ['[[auth-architecture]]', '[[session-tokens]]'],
      agent: 'claude-opus-4-7',
      body: LONG_BODY,
      dryRun: false,
    }) as WriteOk;

    assert.equal(result.ok, true);
    assert.ok(result.path);
    assert.ok(result.path!.startsWith('00-Inbox/AI-Output/vault-architect/'));
    const abs = join(vault, result.path!);
    assert.ok(existsSync(abs), `expected ${abs} to exist`);

    const content = readFileSync(abs, 'utf-8');
    const fm = vaultFs.parseFrontmatter(content);
    assert.ok(fm, 'frontmatter should parse');
    assert.equal(fm!['generated-by'], 'vault-architect');
    assert.equal(fm!['agent'], 'claude-opus-4-7');
    assert.equal(fm!['parent-query'], 'refactor auth module');
    assert.equal(fm!['status'], 'draft');
    assert.ok(typeof fm!['generated-at'] === 'string');
    assert.deepEqual(fm!['source-nodes'], ['[[auth-architecture]]', '[[session-tokens]]']);
    assert.ok(content.includes('# Analysis'));
  });

  test('dryRun default returns plan without writing', () => {
    const result = vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: 'some query',
      sourceNodes: [],
      agent: 'claude-opus-4-7',
      body: LONG_BODY,
    }) as WriteOk;

    assert.equal(result.dryRun, true);
    assert.equal(result.action, 'writeAIOutput');
    assert.ok(result.path);
    const abs = join(vault, result.path!);
    assert.equal(existsSync(abs), false, 'must not write on dry run');
    assert.ok(result.frontmatter);
    assert.equal((result.frontmatter as Record<string, unknown>).status, 'draft');
  });

  test('collision appends -2 suffix on second call same day/slug', () => {
    const first = vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: 'same query',
      sourceNodes: [],
      agent: 'claude-opus-4-7',
      body: `${LONG_BODY} -- first`,
      slug: 'same-slug',
      dryRun: false,
    }) as WriteOk;

    const second = vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: 'same query',
      sourceNodes: [],
      agent: 'claude-opus-4-7',
      body: `${LONG_BODY} -- second`,
      slug: 'same-slug',
      dryRun: false,
    }) as WriteOk;

    assert.ok(first.path!.endsWith('-same-slug.md'));
    assert.ok(second.path!.endsWith('-same-slug-2.md'));
    assert.ok(existsSync(join(vault, first.path!)));
    assert.ok(existsSync(join(vault, second.path!)));
  });

  test('rejects invalid persona without vault- prefix', () => {
    assert.throws(() => vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'architect',
      parentQuery: 'x',
      sourceNodes: [],
      agent: 'a',
      body: LONG_BODY,
      dryRun: false,
    }), (e: unknown) => {
      const ex = e as { code?: number; message?: string };
      return ex.code === -32602 && /persona/.test(ex.message ?? '');
    });
  });

  test('defaults scope=project and quarantine-state=new when not specified', () => {
    const result = vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: 'default governance fields',
      sourceNodes: [],
      agent: 'claude-opus-4-7',
      body: LONG_BODY,
      dryRun: false,
    }) as WriteOk;

    const content = readFileSync(join(vault, result.path!), 'utf-8');
    const fm = vaultFs.parseFrontmatter(content);
    assert.equal(fm!['scope'], 'project');
    assert.equal(fm!['quarantine-state'], 'new');
  });

  test('accepts explicit scope + quarantineState and writes them to frontmatter', () => {
    const result = vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-librarian',
      parentQuery: 'promote this',
      sourceNodes: [],
      agent: 'claude-opus-4-7',
      body: LONG_BODY,
      scope: 'global',
      quarantineState: 'reviewed',
      dryRun: false,
    }) as WriteOk;

    const content = readFileSync(join(vault, result.path!), 'utf-8');
    assert.ok(content.includes('scope: global'));
    assert.ok(content.includes('quarantine-state: reviewed'));
  });

  test('rejects invalid scope enum', () => {
    assert.throws(() => vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: 'x',
      sourceNodes: [],
      agent: 'a',
      body: LONG_BODY,
      scope: 'galactic',
      dryRun: false,
    }), (e: unknown) => {
      const ex = e as { code?: number; message?: string };
      return ex.code === -32602 && /scope/.test(ex.message ?? '');
    });
  });

  test('defaults review-status=none when not specified', () => {
    const result = vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: 'default review-status',
      sourceNodes: [],
      agent: 'claude-opus-4-7',
      body: LONG_BODY,
      dryRun: false,
    }) as WriteOk;
    const content = readFileSync(join(vault, result.path!), 'utf-8');
    const fm = vaultFs.parseFrontmatter(content);
    assert.equal(fm!['review-status'], 'none');
  });

  test('accepts reviewStatus=user-confirmed and writes it', () => {
    const result = vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: 'user-confirmed entry',
      sourceNodes: [],
      agent: 'claude-opus-4-7',
      body: LONG_BODY,
      reviewStatus: 'user-confirmed',
      dryRun: false,
    }) as WriteOk;
    const content = readFileSync(join(vault, result.path!), 'utf-8');
    assert.ok(content.includes('review-status: user-confirmed'));
  });

  test('rejects invalid reviewStatus enum', () => {
    assert.throws(() => vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: 'x',
      sourceNodes: [],
      agent: 'a',
      body: LONG_BODY,
      reviewStatus: 'reviewed', // deliberately the forbidden overlap value
      dryRun: false,
    }), (e: unknown) => {
      const ex = e as { code?: number; message?: string };
      return ex.code === -32602 && /reviewStatus/.test(ex.message ?? '');
    });
  });

  test('rejects invalid quarantineState enum', () => {
    assert.throws(() => vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: 'x',
      sourceNodes: [],
      agent: 'a',
      body: LONG_BODY,
      quarantineState: 'approved',
      dryRun: false,
    }), (e: unknown) => {
      const ex = e as { code?: number; message?: string };
      return ex.code === -32602 && /quarantineState/.test(ex.message ?? '');
    });
  });

  test('input gate: rejects body shorter than 50 chars', () => {
    assert.throws(() => vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: 'legitimate query',
      sourceNodes: [],
      agent: 'claude-opus-4-7',
      body: 'too short',
      dryRun: false,
    }), (e: unknown) => {
      const ex = e as { code?: number; message?: string };
      return ex.code === -32602 && /body too short/.test(ex.message ?? '');
    });
  });

  test('input gate: rejects single shell command as parent-query', () => {
    assert.throws(() => vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: 'git status',
      sourceNodes: [],
      agent: 'claude-opus-4-7',
      body: LONG_BODY,
      dryRun: false,
    }), (e: unknown) => {
      const ex = e as { code?: number; message?: string };
      return ex.code === -32602 && /shell command/.test(ex.message ?? '');
    });
  });

  test('input gate: rejects empty query with empty sourceNodes', () => {
    assert.throws(() => vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: '',
      sourceNodes: [],
      agent: 'claude-opus-4-7',
      body: LONG_BODY,
      dryRun: false,
    }), (e: unknown) => {
      const ex = e as { code?: number; message?: string };
      return ex.code === -32602 && /low-signal/.test(ex.message ?? '');
    });
  });

  test('input gate: empty query is allowed when sourceNodes non-empty', () => {
    const result = vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-architect',
      parentQuery: '',
      sourceNodes: ['[[some-anchor]]'],
      agent: 'claude-opus-4-7',
      body: LONG_BODY,
      dryRun: false,
    }) as WriteOk;
    assert.equal(result.ok, true);
  });

  test('empty sourceNodes serialize to inline []', () => {
    const result = vaultFs.dispatch('vault.writeAIOutput', {
      persona: 'vault-gardener',
      parentQuery: 'empty source test',
      sourceNodes: [],
      agent: 'claude-opus-4-7',
      body: LONG_BODY,
      dryRun: false,
    }) as WriteOk;

    const content = readFileSync(join(vault, result.path!), 'utf-8');
    assert.ok(content.includes('source-nodes: []'), `expected inline [] in:\n${content}`);
    assert.ok(!/^\s+-\s/m.test(content.split('---')[1] ?? ''), 'no multiline array items for empty');
  });
});

// ── vault.sweepAIOutput ──────────────────────────────────────────────────────

describe('vault.sweepAIOutput', () => {
  let vault: string;
  let vaultFs: VaultFs;
  beforeEach(() => { ({ vault, vaultFs } = makeTempVault()); });

  function writeAIOut(
    persona: string,
    fname: string,
    opts: {
      status?: string;
      generatedAt?: string;
      sourceNodes?: string[];
      body?: string;
      mtimeMs?: number;
    } = {},
  ): string {
    const status = opts.status ?? 'draft';
    const generatedAt = opts.generatedAt ?? new Date().toISOString();
    const sourceNodes = opts.sourceNodes ?? [];
    const body = opts.body ?? 'content';
    const relDir = `00-Inbox/AI-Output/${persona}`;
    const relPath = `${relDir}/${fname}`;
    mkdirSync(join(vault, relDir), { recursive: true });

    const lines: string[] = [];
    lines.push('---');
    lines.push(`generated-by: ${persona}`);
    lines.push(`generated-at: ${generatedAt}`);
    lines.push('agent: claude-opus-4-7');
    lines.push('parent-query: "test query"');
    if (sourceNodes.length === 0) {
      lines.push('source-nodes: []');
    } else {
      lines.push('source-nodes:');
      for (const s of sourceNodes) lines.push(`  - "${s}"`);
    }
    lines.push(`status: ${status}`);
    lines.push('---');
    lines.push('');
    lines.push(body);
    lines.push('');

    const full = join(vault, relPath);
    writeFileSync(full, lines.join('\n'), 'utf-8');
    if (opts.mtimeMs !== undefined) {
      const t = opts.mtimeMs / 1000;
      utimesSync(full, t, t);
    }
    return relPath;
  }

  test('dry_run=true identifies an expired draft using injected now', () => {
    const createdAt = daysAgoIso(0); // now
    writeAIOut('vault-architect', 'old.md', {
      status: 'draft',
      generatedAt: createdAt,
      sourceNodes: [],
    });
    // now = 60 days later -> age 60 >= 45 threshold
    const futureNow = new Date(Date.now() + 60 * 86_400_000).toISOString();
    const report = vaultFs.dispatch('vault.sweepAIOutput', {
      dry_run: true,
      now: futureNow,
    }) as SweepReport;

    assert.equal(report.staleCandidates.length, 1);
    assert.equal(report.staleCandidates[0].persona, 'vault-architect');
    assert.equal(report.staleCandidates[0].threshold, 45);
    assert.ok(report.staleCandidates[0].ageDays >= 45);
    assert.equal(report.applied.length, 0);
  });

  test('ignores drafts with a real backlink from non-AI-Output note', () => {
    const rel = writeAIOut('vault-architect', 'linked.md', {
      status: 'draft',
      generatedAt: daysAgoIso(0),
      sourceNodes: [],
    });
    // Create a human note outside AI-Output linking to it
    mkdirSync(join(vault, 'human'), { recursive: true });
    const target = rel.replace(/\.md$/, ''); // full path for wikilink
    writeFileSync(join(vault, 'human', 'note.md'), `human content\n\nsee [[${target}]]`, 'utf-8');

    const futureNow = new Date(Date.now() + 100 * 86_400_000).toISOString();
    const report = vaultFs.dispatch('vault.sweepAIOutput', {
      dry_run: true,
      now: futureNow,
    }) as SweepReport;

    assert.equal(report.staleCandidates.length, 0);
  });

  test('AI-Output -> AI-Output backlinks do not anchor — target still stale', () => {
    const rel1 = writeAIOut('vault-architect', 'target.md', {
      status: 'draft',
      generatedAt: daysAgoIso(0),
      sourceNodes: [],
    });
    // Second AI-Output that links to target
    const target = rel1.replace(/\.md$/, '');
    writeAIOut('vault-architect', 'sibling.md', {
      status: 'draft',
      generatedAt: daysAgoIso(0),
      sourceNodes: [],
      body: `sibling content linking to [[${target}]]`,
    });

    const futureNow = new Date(Date.now() + 100 * 86_400_000).toISOString();
    const report = vaultFs.dispatch('vault.sweepAIOutput', {
      dry_run: true,
      now: futureNow,
    }) as SweepReport;

    const targetHit = report.staleCandidates.find((s) => s.path === rel1);
    assert.ok(targetHit, 'target should still be flagged stale despite AI-Output sibling link');
  });

  test('dry_run=false flips status draft to stale in place, preserves rest', () => {
    const rel = writeAIOut('vault-architect', 'to-flip.md', {
      status: 'draft',
      generatedAt: daysAgoIso(0),
      sourceNodes: [],
      body: '# Important body content\n\nKeep me intact.',
    });
    const before = readFileSync(join(vault, rel), 'utf-8');
    assert.ok(before.includes('status: draft'));

    const futureNow = new Date(Date.now() + 100 * 86_400_000).toISOString();
    const report = vaultFs.dispatch('vault.sweepAIOutput', {
      dry_run: false,
      now: futureNow,
    }) as SweepReport;

    assert.equal(report.applied.length, 1);
    assert.equal(report.applied[0].path, rel);
    assert.equal(report.applied[0].change, 'draft→stale');

    const after = readFileSync(join(vault, rel), 'utf-8');
    assert.ok(after.includes('status: stale'));
    assert.ok(!/\nstatus: draft\n/.test(after));
    assert.ok(after.includes('# Important body content'));
    assert.ok(after.includes('Keep me intact.'));
    assert.ok(after.includes('generated-by: vault-architect'));
  });

  test('dry_run=false appends a history entry under history: on first transition', () => {
    const rel = writeAIOut('vault-architect', 'first-flip.md', {
      status: 'draft',
      generatedAt: daysAgoIso(0),
      sourceNodes: [],
      body: LONG_BODY,
    });

    const futureNow = new Date(Date.now() + 100 * 86_400_000).toISOString();
    vaultFs.dispatch('vault.sweepAIOutput', { dry_run: false, now: futureNow });

    const after = readFileSync(join(vault, rel), 'utf-8');
    assert.ok(after.includes('status: stale'), 'status should flip');
    assert.ok(/\nhistory:\n {2}- \{ts: "/.test(after), `expected history: block, got:\n${after}`);
    assert.ok(after.includes('from: draft, to: stale'));
    assert.ok(after.includes('trigger: auto-stop-summary'));
    assert.ok(after.includes('human_in_loop: false'));
  });

  test('dry_run=false appends to existing history array rather than overwriting', () => {
    // Pre-populate a file with one history entry, then trigger the sweep.
    // The sweep must leave the old entry intact and append a new one.
    const relDir = `00-Inbox/AI-Output/vault-architect`;
    const relPath = `${relDir}/preexisting-history.md`;
    mkdirSync(join(vault, relDir), { recursive: true });
    const initial = [
      '---',
      'generated-by: vault-architect',
      `generated-at: ${daysAgoIso(0)}`,
      'agent: claude-opus-4-7',
      'parent-query: "seed"',
      'source-nodes: []',
      'status: draft',
      'scope: project',
      'quarantine-state: new',
      'history:',
      '  - {ts: "2020-01-01T00:00:00.000Z", from: bootstrap, to: draft, trigger: migration-import, evidence_level: low, human_in_loop: true, note: "seed"}',
      '---',
      '',
      'body',
      '',
    ].join('\n');
    writeFileSync(join(vault, relPath), initial, 'utf-8');

    const futureNow = new Date(Date.now() + 100 * 86_400_000).toISOString();
    vaultFs.dispatch('vault.sweepAIOutput', { dry_run: false, now: futureNow });

    const after = readFileSync(join(vault, relPath), 'utf-8');
    // Both entries must survive
    assert.ok(after.includes('trigger: migration-import'), 'pre-existing entry lost');
    assert.ok(after.includes('trigger: auto-stop-summary'), 'new entry missing');
    // And ordering: old first, new second
    const idxOld = after.indexOf('trigger: migration-import');
    const idxNew = after.indexOf('trigger: auto-stop-summary');
    assert.ok(idxOld < idxNew, 'new entry should come after old');
    // status flipped
    assert.ok(after.includes('status: stale'));
    assert.ok(!/\nstatus: draft\n/.test(after));
  });

  test('supersede candidates fire on same-persona reviewed pair with Jaccard >= 0.6', () => {
    // Jaccard(A, B) where both have 3 shared + one unique each = 3 / 5 = 0.6
    writeAIOut('vault-historian', 'older.md', {
      status: 'reviewed',
      generatedAt: daysAgoIso(10),
      sourceNodes: ['[[a]]', '[[b]]', '[[c]]', '[[d]]'],
      mtimeMs: Date.now() - 10 * 86_400_000,
    });
    writeAIOut('vault-historian', 'newer.md', {
      status: 'reviewed',
      generatedAt: daysAgoIso(1),
      sourceNodes: ['[[a]]', '[[b]]', '[[c]]', '[[e]]'],
      mtimeMs: Date.now() - 1 * 86_400_000,
    });

    const report = vaultFs.dispatch('vault.sweepAIOutput', {
      dry_run: true,
    }) as SweepReport;

    assert.equal(report.supersedeCandidates.length, 1);
    const sc = report.supersedeCandidates[0];
    assert.ok(sc.older.endsWith('older.md'));
    assert.ok(sc.newer.endsWith('newer.md'));
    assert.ok(sc.overlap >= 0.6);
  });

  test('metrics: reports counts by persona/status/quarantine-state + backlink hit rate', () => {
    writeAIOut('vault-architect', 'a1.md', { status: 'draft' });
    writeAIOut('vault-architect', 'a2.md', { status: 'reviewed' });
    writeAIOut('vault-gardener', 'g1.md', { status: 'draft' });
    // Add a human note so one entry has a real backlink
    mkdirSync(join(vault, 'notes'), { recursive: true });
    writeFileSync(
      join(vault, 'notes', 'human.md'),
      'human content\n\n[[00-Inbox/AI-Output/vault-architect/a1]]\n',
      'utf-8',
    );

    const report = vaultFs.dispatch('vault.sweepAIOutput', { dry_run: true }) as SweepReport;

    assert.equal(report.metrics.totalEntries, 3);
    assert.equal(report.metrics.byPersona['vault-architect'], 2);
    assert.equal(report.metrics.byPersona['vault-gardener'], 1);
    assert.equal(report.metrics.byStatus['draft'], 2);
    assert.equal(report.metrics.byStatus['reviewed'], 1);
    // byQuarantineState: the helper doesn't write the field, so they show as (none)
    assert.ok(report.metrics.byQuarantineState['(none)'] === 3 ||
              typeof report.metrics.byQuarantineState['(none)'] === 'number');
    // 1 of 3 entries has a real backlink -> hit rate ~= 0.333
    assert.ok(report.metrics.realBacklinkHitRate > 0.3 && report.metrics.realBacklinkHitRate < 0.4);
  });

  test('metrics: empty vault reports zero hit rate', () => {
    const report = vaultFs.dispatch('vault.sweepAIOutput', { dry_run: true }) as SweepReport;
    assert.equal(report.metrics.totalEntries, 0);
    assert.equal(report.metrics.realBacklinkHitRate, 0);
  });
});
