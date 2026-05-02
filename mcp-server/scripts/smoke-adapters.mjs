#!/usr/bin/env node
/**
 * smoke-adapters.mjs -- standalone health check for the obsidian-llm-wiki
 * MCP server's adapter registry.
 *
 * Spawns the built bundle.js as a stdio MCP server, calls `query.adapters`,
 * and asserts that every BASELINE adapter is registered AND not explicitly
 * marked isAvailable=false. OPTIONAL adapters (e.g. obsidian, requires
 * Desktop running) are reported but not enforced.
 *
 * Exit codes:
 *   0 = all baseline adapters live
 *   1 = at least one baseline adapter missing or unavailable
 *   2 = bundle.js missing or runner crashed before checks completed
 *
 * Use cases:
 *   - bootstrap.sh smoke gate after fresh-machine install
 *   - pre-restart sanity check before a Claude Code session
 *   - post-edit verification that an adapter init still passes
 *
 * Run:
 *   npm run smoke:adapters         (uses VAULT_MIND_VAULT_PATH from env)
 *   VAULT_MIND_VAULT_PATH=E:/knowledge node scripts/smoke-adapters.mjs
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = resolve(__dirname, "..", "bundle.js");

// Adapters that should always be live on a healthy machine.
const BASELINE = ["filesystem", "memu", "gitnexus", "vaultbrain", "memorix", "claudemem"];
// Adapters that depend on external state (e.g. Desktop running). Reported, not enforced.
const OPTIONAL = ["obsidian"];

if (!existsSync(BUNDLE_PATH)) {
  console.error(`[ERR ] bundle.js missing at ${BUNDLE_PATH}. Run "npm run rebuild" first.`);
  process.exit(2);
}

const vaultPath = process.env.VAULT_MIND_VAULT_PATH ?? "E:/knowledge";
if (!existsSync(vaultPath)) {
  console.error(`[ERR ] VAULT_MIND_VAULT_PATH does not exist: ${vaultPath}`);
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [BUNDLE_PATH],
  env: { ...process.env, VAULT_MIND_VAULT_PATH: vaultPath },
  stderr: "pipe",
});

const client = new Client(
  { name: "smoke-adapters", version: "0.1.0" },
  { capabilities: {} },
);

let exitCode = 0;
const start = Date.now();

try {
  await client.connect(transport);
  const result = await client.callTool({ name: "query.adapters", arguments: {} });
  const text = result?.content?.[0]?.text ?? "{}";
  const body = JSON.parse(text);
  const adapters = Array.isArray(body.adapters) ? body.adapters : [];

  const registered = new Set(adapters.map((a) => a.name));
  // isAvailable === false means explicitly disabled. Missing flag means
  // adapter doesn't expose health (treat as available -- e.g. filesystem).
  const available = new Set(
    adapters.filter((a) => a.isAvailable !== false).map((a) => a.name),
  );

  console.log(`registered: ${[...registered].sort().join(", ") || "(none)"}`);
  console.log("");

  for (const name of BASELINE) {
    if (!registered.has(name)) {
      console.error(`[FAIL] baseline adapter NOT REGISTERED: ${name}`);
      exitCode = 1;
    } else if (!available.has(name)) {
      console.error(`[FAIL] baseline adapter explicitly unavailable: ${name}`);
      exitCode = 1;
    } else {
      console.log(`[ OK ] ${name}`);
    }
  }

  for (const name of OPTIONAL) {
    if (available.has(name)) {
      console.log(`[ ok ] ${name} (optional, active)`);
    } else if (registered.has(name)) {
      console.log(`[ -- ] ${name} (optional, registered but unavailable)`);
    } else {
      console.log(`[ -- ] ${name} (optional, not registered -- expected when Desktop off / CLI not installed)`);
    }
  }

  console.log("");
  console.log(`elapsed: ${Date.now() - start}ms`);
  if (exitCode === 0) {
    console.log("[PASS] all baseline adapters live");
  } else {
    console.error("[FAIL] one or more baseline adapters missing");
  }
} catch (err) {
  console.error(`[ERR ] smoke runner crashed: ${err?.message ?? err}`);
  exitCode = 2;
} finally {
  try { await client.close(); } catch { /* best effort */ }
  try { await transport.close(); } catch { /* best effort */ }
}

process.exit(exitCode);
