#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function readText(root, path) {
  return readFileSync(join(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requirePath(root, path, kind = "path") {
  let stat;
  try {
    stat = statSync(join(root, path));
  } catch {
    throw new Error(`Missing ${kind}: ${path}`);
  }

  if (kind === "file" && !stat.isFile()) {
    throw new Error(`Expected file: ${path}`);
  }
  if (kind === "directory" && !stat.isDirectory()) {
    throw new Error(`Expected directory: ${path}`);
  }
}

function requireJson(root, path) {
  readJson(root, path);
}

export function checkDistribution({ root = defaultRoot } = {}) {
  const manifest = readJson(root, "packaging/llmwiki-distribution.json");
  const optionalCopyDirs = new Set(manifest.install.optionalCopyDirs ?? ["smoke"]);

  for (const file of manifest.plugin.requiredFiles) {
    requirePath(root, file, "file");
    requireJson(root, file);
  }

  for (const file of manifest.install.mcpFiles) {
    requirePath(root, file, "file");
  }

  for (const dir of manifest.install.copyDirs) {
    if (!optionalCopyDirs.has(dir)) {
      requirePath(root, dir, "directory");
    }
  }

  for (const file of manifest.install.copyFiles) {
    requirePath(root, file, "file");
  }

  for (const skill of manifest.install.topLevelSkills) {
    requirePath(root, `skills/${skill}/SKILL.md`, "file");
  }

  requireJson(root, "mcp-server/package.json");
  requireJson(root, "archify/package.json");

  const plugin = readJson(root, ".claude-plugin/plugin.json");
  assert(plugin.name === manifest.publicName, "plugin.json name must match manifest publicName");

  const marketplace = readJson(root, ".claude-plugin/marketplace.json");
  const marketplacePlugin = marketplace.plugins?.[0];
  assert(
    marketplacePlugin?.name === manifest.publicName,
    "marketplace.json plugin name must match manifest publicName",
  );

  const mcp = readJson(root, ".claude-plugin/mcp.json");
  const mcpServer = mcp.mcpServers?.[manifest.mcpServerName];
  assert(mcpServer, `mcp.json must define ${manifest.mcpServerName}`);
  assert(
    mcpServer.args?.includes(manifest.plugin.mcpBundleArg),
    "mcp.json must point at the manifest plugin MCP bundle arg",
  );

  const readme = readText(root, "README.md");
  assert(
    readme.includes(manifest.pluginInstall.marketplace),
    "README must document the plugin marketplace add command",
  );
  assert(
    readme.includes(manifest.pluginInstall.install),
    "README must document the plugin install command",
  );

  const hosts = Object.keys(manifest.hosts);
  assert(hosts.length > 0, "manifest must define at least one host");
  for (const host of hosts) {
    const template = manifest.hosts[host].skillsDir;
    assert(template.includes("{home}"), `host ${host} skillsDir must include {home}`);
    assert(
      template.includes("{legacySkillBundle}"),
      `host ${host} skillsDir must include {legacySkillBundle}`,
    );
  }

  return {
    publicName: manifest.publicName,
    hosts: hosts.length,
    copyDirs: manifest.install.copyDirs.length,
  };
}

export function formatSummary(summary) {
  return `distribution ok: ${summary.publicName}, ${summary.hosts} hosts, ${summary.copyDirs} dirs`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(formatSummary(checkDistribution()));
}
