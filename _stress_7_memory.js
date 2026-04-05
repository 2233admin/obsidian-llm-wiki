/**
 * Stress Test 7: Memory Baseline Check
 * Check Obsidian memory before/after all tests via tasklist.
 * This script is called twice: once with --before, once with --after.
 */
const { execSync } = require('child_process');

function getObsidianMemory() {
  try {
    const out = execSync(
      'C:/Windows/System32/tasklist.exe /FI "IMAGENAME eq Obsidian.exe" /FO CSV',
      { encoding: 'utf8', timeout: 10000 }
    );
    const lines = out.trim().split('\n').slice(1).filter(Boolean);
    let totalKB = 0;
    const procs = [];
    for (const line of lines) {
      // Parse CSV: "Obsidian.exe","39008","Console","1","100,620 K"
      const m = line.match(/"([^"]+)","(\d+)","([^"]+)","(\d+)","([\d,]+) K"/);
      if (m) {
        const kb = parseInt(m[5].replace(/,/g, ''), 10);
        totalKB += kb;
        procs.push({ pid: m[2], memKB: kb });
      }
    }
    return { totalKB, procs };
  } catch(e) {
    return { totalKB: 0, procs: [], error: e.message };
  }
}

const phase = process.argv[2] || '--report';
const stateFile = require('path').join(__dirname, '_stress_memory_state.json');
const fs = require('fs');

if (phase === '--before') {
  const mem = getObsidianMemory();
  fs.writeFileSync(stateFile, JSON.stringify({ before: mem, ts: Date.now() }));
  console.log(`[SC7] BEFORE: Obsidian total memory = ${(mem.totalKB/1024).toFixed(1)} MB across ${mem.procs.length} processes`);
  mem.procs.forEach(p => console.log(`  PID ${p.pid}: ${(p.memKB/1024).toFixed(1)} MB`));
} else if (phase === '--after') {
  let before = null;
  if (fs.existsSync(stateFile)) {
    before = JSON.parse(fs.readFileSync(stateFile, 'utf8')).before;
  }
  const after = getObsidianMemory();
  console.log(`[SC7] AFTER: Obsidian total memory = ${(after.totalKB/1024).toFixed(1)} MB across ${after.procs.length} processes`);
  after.procs.forEach(p => console.log(`  PID ${p.pid}: ${(p.memKB/1024).toFixed(1)} MB`));

  if (before) {
    const diffKB = after.totalKB - before.totalKB;
    const diffPct = before.totalKB > 0 ? (diffKB / before.totalKB * 100) : 0;
    console.log(`\n[SC7] RESULTS:`);
    console.log(`  Before: ${(before.totalKB/1024).toFixed(1)} MB`);
    console.log(`  After:  ${(after.totalKB/1024).toFixed(1)} MB`);
    console.log(`  Delta:  ${diffKB > 0 ? '+' : ''}${(diffKB/1024).toFixed(1)} MB (${diffPct > 0 ? '+' : ''}${diffPct.toFixed(1)}%)`);

    const leaked = diffKB > 50 * 1024; // >50MB growth = significant
    console.log(`  Significant memory growth (>50MB): ${leaked}`);
    console.log(`  VERDICT: ${leaked ? 'WARN - possible memory leak' : 'PASS - no significant growth'}`);
  }

  // Cleanup state file
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
} else {
  console.log('Usage: node _stress_7_memory.js --before | --after');
}
