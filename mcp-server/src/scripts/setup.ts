#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HOSTS = {
  claude: { skillRoot: "~/.claude/skills", config: "~/.mcp.json" },
  codex: { skillRoot: "~/.codex/skills", config: "~/.codex/config.toml" },
  opencode: { skillRoot: "~/.config/opencode/skills", config: "~/.config/opencode/mcp.json" },
  gemini: { skillRoot: "~/.gemini/skills", config: "~/.gemini/settings.json" },
} as const;

type Host = keyof typeof HOSTS;
interface SetupOptions { host: Host; dryRun: boolean; doctor: boolean; list: boolean; json: boolean; vault?: string; }

function parseArgs(argv: string[]): SetupOptions {
  let host: Host = "claude";
  let dryRun = false;
  let doctor = false;
  let list = false;
  let json = false;
  let vault: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") host = requireHost(argv[++index], "--host");
    else if (arg.startsWith("--host=")) host = requireHost(arg.slice(7), "--host");
    else if (arg === "--vault") vault = requiredValue(argv[++index], "--vault");
    else if (arg.startsWith("--vault=")) vault = requiredValue(arg.slice(8), "--vault");
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--doctor") doctor = true;
    else if (arg === "--list") list = true;
    else if (arg === "--json") json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return { host, dryRun, doctor, list, json, ...(vault ? { vault } : {}) };
}

function requiredValue(value: string | undefined, option: string): string {
  if (!value?.trim() || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value.trim();
}

function requireHost(value: string | undefined, option: string): Host {
  const host = requiredValue(value, option);
  if (!(host in HOSTS)) throw new Error(`Unknown host '${host}'. Expected: ${Object.keys(HOSTS).join(", ")}`);
  return host as Host;
}

function repoRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(moduleDir, "../../.."), resolve(moduleDir, "..")];
  const root = candidates.find(candidate => existsSync(join(candidate, "mcp-server", "bundle.js")));
  if (!root) throw new Error("Could not locate the repository root containing mcp-server/bundle.js");
  return root;
}

function homePath(value: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || (process.env.HOMEDRIVE && process.env.HOMEPATH) || "";
  return value.startsWith("~/") && home ? join(home, value.slice(2)) : value;
}

function hostDirectory(host: Host): string {
  return join(homePath(HOSTS[host].skillRoot), "vault-wiki");
}

function listOutput(): Record<string, unknown> {
  return { hosts: Object.entries(HOSTS).map(([id, value]) => ({ id, skillRoot: value.skillRoot, config: value.config, supported: true })) };
}

function commandOnPath(command: string): boolean {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\"))
    return existsSync(resolve(command)) && statSync(resolve(command)).isFile();
  const suffixes = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  const extensions = ["", ...suffixes];
  const pathSeparator = process.platform === "win32" ? ";" : sep;
  return (process.env.PATH || "").split(pathSeparator).some(directory =>
    extensions.some(extension => {
      const candidate = join(directory, `${command}${extension}`);
      return existsSync(candidate) && statSync(candidate).isFile();
    }),
  );
}

function doctor(root: string, options: SetupOptions): Record<string, unknown> {
  const bundle = join(root, "mcp-server", "bundle.js");
  const recoveryCli = join(root, "mcp-server", "recovery-flow-cli.js");
  const setupCli = join(root, "mcp-server", "setup-cli.js");
  const vault = options.vault || process.env.VAULT_MIND_VAULT_PATH || process.env.VAULT_PATH;
  const vaultReady = Boolean(vault && existsSync(resolve(vault)) && statSync(resolve(vault)).isDirectory());
  const checks = [
    { id: "mcp-bundle", state: existsSync(bundle) ? "pass" : "fail", summary: existsSync(bundle) ? "MCP bundle is present." : "Build mcp-server before setup." },
    { id: "recovery-cli", state: existsSync(recoveryCli) ? "pass" : "fail", summary: existsSync(recoveryCli) ? "Recovery CLI bundle is present." : "Build the Recovery CLI bundle before setup." },
    { id: "setup-cli", state: existsSync(setupCli) ? "pass" : "fail", summary: existsSync(setupCli) ? "Setup CLI bundle is present." : "Build the setup CLI bundle before setup." },
    { id: "vault", state: vault ? (vaultReady ? "pass" : "fail") : "warn", summary: vaultReady ? "Vault path is configured." : vault ? "Configured vault path is invalid." : "No vault path configured; setup can still install host skills." },
  ];
  const filesystemReady = existsSync(join(root, "skills")) && existsSync(bundle);
  const python = process.env.VAULT_MIND_PYTHON || process.env.PYTHON;
  const pythonPathReady = Boolean(python && commandOnPath(python));
  const setupBundlesReady = existsSync(bundle) && existsSync(recoveryCli) && existsSync(setupCli);
  const capabilities = [
    {
      id: "filesystem-baseline",
      state: filesystemReady ? "available" : "unavailable",
      remediation: filesystemReady ? "None." : "Build the MCP bundle and ensure the bundled skills directory is present.",
    },
    {
      id: "python-worker",
      state: pythonPathReady ? "available" : "degraded",
      remediation: pythonPathReady ? "None." : "Optional: configure VAULT_MIND_PYTHON or PYTHON with a Python executable; Doctor does not invoke Python.",
    },
    {
      id: "setup-bundles",
      state: setupBundlesReady ? "available" : "unavailable",
      remediation: setupBundlesReady ? "None." : "Build mcp-server bundles with npm run rebuild.",
    },
  ];
  return { ok: checks.every(check => check.state !== "fail"), host: options.host, checks, capabilities, remediation: [...checks.filter(check => check.state !== "pass").map(check => check.summary), ...capabilities.filter(capability => capability.state !== "available").map(capability => capability.remediation)] };
}

function copy(source: string, destination: string, dryRun: boolean): void {
  if (dryRun) { process.stdout.write(`[dry-run] copy ${source} -> ${destination}\n`); return; }
  cpSync(source, destination, { recursive: true });
}

function install(root: string, options: SetupOptions): Record<string, unknown> {
  const destination = hostDirectory(options.host);
  const parent = dirname(destination);
  if (!existsSync(parent)) throw new Error(`Host directory not found: ${parent}`);
  if (!options.dryRun) mkdirSync(destination, { recursive: true });
  const installed: string[] = [];
  for (const directory of ["skills", "examples", "docs", "terrariums", "viewer", "smoke"]) {
    const source = join(root, directory);
    if (existsSync(source)) { copy(source, join(destination, directory), options.dryRun); installed.push(directory); }
  }
  for (const file of ["README.md", "CHANGELOG.md", "RELEASE_NOTES.md", "vercel.json"]) {
    const source = join(root, file);
    if (existsSync(source)) { copy(source, join(destination, file), options.dryRun); installed.push(file); }
  }
  const mcpDestination = join(destination, "mcp-server");
  if (!options.dryRun) mkdirSync(mcpDestination, { recursive: true });
  for (const file of ["bundle.js", "recovery-flow-cli.js", "setup-cli.js", "package.json"]) {
    copy(join(root, "mcp-server", file), join(mcpDestination, file), options.dryRun);
    installed.push(`mcp-server/${file}`);
  }
  const skillRoot = join(root, "skills");
  if (existsSync(skillRoot)) {
    for (const name of readdirSync(skillRoot)) {
      const source = join(skillRoot, name);
      if (!statSync(source).isDirectory() || !existsSync(join(source, "SKILL.md"))) continue;
      const target = join(dirname(destination), name);
      if (!options.dryRun) mkdirSync(target, { recursive: true });
      copy(source, target, options.dryRun);
    }
  }
  return { ok: true, host: options.host, destination, dryRun: options.dryRun, installed };
}

export function runSetup(argv: string[]): Record<string, unknown> {
  const options = parseArgs(argv);
  const root = repoRoot();
  if (options.list) return listOutput();
  if (options.doctor) return doctor(root, options);
  return install(root, options);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.doctor ? doctor(repoRoot(), options) : options.list ? listOutput() : install(repoRoot(), options);
    process.stdout.write(`${options.json ? JSON.stringify(result, null, 2) : JSON.stringify(result)}\n`);
    process.exitCode = options.doctor && result.ok !== true ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, message: error instanceof Error ? error.message : "Setup failed" })}\n`);
    process.exitCode = 1;
  }
}
