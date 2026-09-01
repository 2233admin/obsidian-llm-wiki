#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, delimiter, isAbsolute, join, resolve } from "node:path";
import { CANONICAL_VAULT_ENV, readVaultEnvironment } from "../runtime-env.js";

const HOSTS = {
  claude: { skillRoot: "~/.claude/skills", config: "~/.mcp.json", instruction: "~/.claude/CLAUDE.md", format: "json", registration: true },
  codex: { skillRoot: "~/.codex/skills", config: "~/.codex/config.toml", format: "toml", registration: false },
  opencode: { skillRoot: "~/.config/opencode/skills", config: "~/.config/opencode/mcp.json", format: "json", registration: false },
  gemini: { skillRoot: "~/.gemini/skills", config: "~/.gemini/settings.json", format: "json", registration: false },
} as const;

type Host = keyof typeof HOSTS;
interface SetupOptions { host: Host; dryRun: boolean; doctor: boolean; list: boolean; json: boolean; vault?: string; }
interface DoctorCheck { id: string; state: "pass" | "fail" | "warn"; summary: string; }

const ROLE_BEGIN = "<!-- BEGIN LLM WIKI VAULT ROLES -->";
const ROLE_END = "<!-- END LLM WIKI VAULT ROLES -->";

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

function homePath(value: string, environment: NodeJS.ProcessEnv = process.env): string {
  let home = environment.HOME || environment.USERPROFILE || (environment.HOMEDRIVE && environment.HOMEPATH) || "";
  if (process.platform === "win32" && /^\/[A-Za-z]\//u.test(home)) home = `${home[1].toUpperCase()}:${home.slice(3)}`;
  return value.startsWith("~/") && home ? resolve(home, value.slice(2)) : value;
}
function hostDirectory(host: Host, environment: NodeJS.ProcessEnv = process.env): string {
  return join(homePath(HOSTS[host].skillRoot, environment), "vault-wiki");
}

function hostConfigPath(host: Host, environment: NodeJS.ProcessEnv = process.env): string {
  return homePath(HOSTS[host].config, environment);
}

function hostInstructionPath(host: Host, environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const definition = HOSTS[host];
  return "instruction" in definition && typeof definition.instruction === "string" ? homePath(definition.instruction, environment) : undefined;
}

function listOutput(): Record<string, unknown> {
  return { hosts: Object.entries(HOSTS).map(([id, value]) => ({ id, skillRoot: value.skillRoot, config: value.config, supported: true })) };
}

function commandOnPath(command: string, environment: NodeJS.ProcessEnv = process.env): boolean {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\"))
    return existsSync(resolve(command)) && statSync(resolve(command)).isFile();
  const suffixes = process.platform === "win32" ? (environment.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  const extensions = ["", ...suffixes];
  const pathSeparator = delimiter;
  return (environment.PATH || "").split(pathSeparator).some(directory =>
    extensions.some(extension => {
      const candidate = join(directory, `${command}${extension}`);
      return existsSync(candidate) && statSync(candidate).isFile();
    }),
  );
}

function validDirectory(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const candidate = resolve(value);
  return existsSync(candidate) && statSync(candidate).isDirectory() ? candidate : undefined;
}

function expectedVault(options: SetupOptions, environment: NodeJS.ProcessEnv = process.env): string | undefined {
  return validDirectory(options.vault || readVaultEnvironment(environment));
}

function normalizePath(value: string): string {
  const normalized = resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function recoverDisplaced(path: string): void {
  const displaced = `${path}.swap`;
  if (!existsSync(displaced)) return;
  if (existsSync(path)) rmSync(displaced, { force: true });
  else renameSync(displaced, path);
}

function atomicWrite(path: string, content: string): void {
  recoverDisplaced(path);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
  try {
    renameSync(temporary, path);
    return;
  } catch (error) {
    if (!existsSync(path)) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
  const displaced = `${path}.swap`;
  try {
    renameSync(path, displaced);
    renameSync(temporary, path);
    rmSync(displaced, { force: true });
  } catch (error) {
    if (!existsSync(path) && existsSync(displaced)) renameSync(displaced, path);
    rmSync(temporary, { force: true });
    throw error;
  }
}
function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error(`Invalid JSON in host configuration: ${path}`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Host configuration must be a JSON object: ${path}`);
  return parsed as Record<string, unknown>;
}

function rolesBlock(root: string): string {
  const roles = readdirSync(join(root, "skills"))
    .filter(name => name.startsWith("vault-") && name.endsWith(".md"))
    .map(name => `- /${name.slice(0, -3)}`)
    .sort();
  return `${ROLE_BEGIN}\n## Vault Roles\n${roles.join("\n")}\n${ROLE_END}`;
}

function markerIndexes(value: string, marker: string): number[] {
  const indexes: number[] = [];
  let offset = value.indexOf(marker);
  while (offset >= 0) {
    indexes.push(offset);
    offset = value.indexOf(marker, offset + marker.length);
  }
  return indexes;
}

function hasExactlyOneRoleBlock(value: string): boolean {
  const starts = markerIndexes(value, ROLE_BEGIN);
  const ends = markerIndexes(value, ROLE_END);
  return starts.length === 1 && ends.length === 1 && starts[0] < ends[0];
}

function mergeRoles(existing: string, block: string): string {
  const starts = markerIndexes(existing, ROLE_BEGIN);
  const ends = markerIndexes(existing, ROLE_END);
  if (starts.length > 1 || ends.length > 1 || (starts.length === 1 && (ends.length !== 1 || starts[0] >= ends[0])))
    throw new Error("Managed Vault Roles block must contain exactly one ordered marker pair.");
  if (starts.length === 1 && ends.length === 1) return `${existing.slice(0, starts[0])}${block}${existing.slice(ends[0] + ROLE_END.length)}`;
  return `${existing.trimEnd()}\n\n${block}\n`;
}

function writeRegistration(root: string, options: SetupOptions, destination: string, vault: string, environment: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const host = HOSTS[options.host];
  if (!host.registration || host.format !== "json") return { state: "unsupported", host: options.host };
  const configPath = hostConfigPath(options.host, environment);
  const instructionPath = hostInstructionPath(options.host, environment)!;
  recoverDisplaced(configPath);
  recoverDisplaced(instructionPath);
  const config = readJsonObject(configPath);
  const servers = config.mcpServers;
  if (servers !== undefined && (!servers || typeof servers !== "object" || Array.isArray(servers)))
    throw new Error(`Host configuration mcpServers must be an object: ${configPath}`);
  const nextServers = (servers ?? {}) as Record<string, unknown>;
  const bundle = resolve(destination, "mcp-server", "bundle.js");
  const nextRegistration = { type: "stdio", command: "node", args: [bundle], env: { [CANONICAL_VAULT_ENV]: vault } };
  nextServers["vault-mind"] = nextRegistration;
  const nextConfig = { ...config, mcpServers: nextServers };
  const nextConfigText = `${JSON.stringify(nextConfig, null, 2)}\n`;
  const currentConfigText = existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined;
  const currentRoles = existsSync(instructionPath) ? readFileSync(instructionPath, "utf8") : "";
  const nextRoles = mergeRoles(currentRoles, rolesBlock(root));
  if (currentConfigText !== nextConfigText) atomicWrite(configPath, nextConfigText);
  if (currentRoles !== nextRoles) atomicWrite(instructionPath, nextRoles);
  return { state: "pass", configPath, instructionPath, changed: currentConfigText !== nextConfigText || currentRoles !== nextRoles };
}

function hostRegistrationDoctor(root: string, options: SetupOptions, environment: NodeJS.ProcessEnv = process.env): DoctorCheck {
  const host = HOSTS[options.host];
  if (!host.registration || host.format !== "json") return { id: "host-registration", state: "warn", summary: `Host registration verification is not supported for ${options.host}.` };
  const configPath = hostConfigPath(options.host, environment);
  const vault = expectedVault(options, environment);
  if (!vault) return { id: "host-registration", state: "fail", summary: `A valid vault path is required for host registration (${CANONICAL_VAULT_ENV}).` };
  if (!existsSync(configPath)) return { id: "host-registration", state: "fail", summary: `Host configuration is missing: ${configPath}` };
  let config: Record<string, unknown>;
  try { config = readJsonObject(configPath); } catch (error) { return { id: "host-registration", state: "fail", summary: error instanceof Error ? error.message : "Host configuration is invalid." }; }
  const servers = config.mcpServers;
  const registration = servers && typeof servers === "object" && !Array.isArray(servers) ? (servers as Record<string, unknown>)["vault-mind"] : undefined;
  if (!registration || typeof registration !== "object" || Array.isArray(registration)) return { id: "host-registration", state: "fail", summary: "vault-mind is missing from the host MCP configuration." };
  const value = registration as Record<string, unknown>;
  const args = value.args;
  const env = value.env;
  const bundle = resolve(hostDirectory(options.host, environment), "mcp-server", "bundle.js");
  const envVault = env && typeof env === "object" && !Array.isArray(env) ? (env as Record<string, unknown>)[CANONICAL_VAULT_ENV] : undefined;
  if (value.command !== "node" || !Array.isArray(args) || args.length !== 1 || typeof args[0] !== "string" || normalizePath(args[0]) !== normalizePath(bundle) || !existsSync(bundle))
    return { id: "host-registration", state: "fail", summary: "Host MCP registration does not point to the installed bundle." };
  if (envVault !== vault) return { id: "host-registration", state: "fail", summary: `Host MCP registration has the wrong ${CANONICAL_VAULT_ENV} value.` };
  const instructionPath = hostInstructionPath(options.host, environment)!;
  if (!existsSync(instructionPath)) return { id: "host-registration", state: "fail", summary: "Managed Vault Roles block is missing." };
  const roles = readFileSync(instructionPath, "utf8");
  if (!hasExactlyOneRoleBlock(roles)) return { id: "host-registration", state: "fail", summary: "Managed Vault Roles block must contain exactly one ordered marker pair." };
  return { id: "host-registration", state: "pass", summary: "Host MCP registration and Vault Roles block are valid." };
}

function doctor(root: string, options: SetupOptions, environment: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const bundle = join(root, "mcp-server", "bundle.js");
  const recoveryCli = join(root, "mcp-server", "recovery-flow-cli.js");
  const setupCli = join(root, "mcp-server", "setup-cli.js");
  const vault = options.vault || readVaultEnvironment(environment);
  const vaultReady = Boolean(vault && validDirectory(vault));
  const checks: DoctorCheck[] = [
    { id: "mcp-bundle", state: existsSync(bundle) ? "pass" : "fail", summary: existsSync(bundle) ? "MCP bundle is present." : "Build mcp-server before setup." },
    { id: "recovery-cli", state: existsSync(recoveryCli) ? "pass" : "fail", summary: existsSync(recoveryCli) ? "Recovery CLI bundle is present." : "Build the Recovery CLI bundle before setup." },
    { id: "setup-cli", state: existsSync(setupCli) ? "pass" : "fail", summary: existsSync(setupCli) ? "Setup CLI bundle is present." : "Build the setup CLI bundle before setup." },
    { id: "vault", state: vault ? (vaultReady ? "pass" : "fail") : "warn", summary: vaultReady ? "Vault path is configured." : vault ? "Configured vault path is invalid." : "No vault path configured; setup can still install host skills." },
    hostRegistrationDoctor(root, options, environment),
  ];
  const filesystemReady = existsSync(join(root, "skills")) && existsSync(bundle);
  const python = environment.VAULT_MIND_PYTHON || environment.PYTHON;
  const pythonPathReady = Boolean(python && commandOnPath(python, environment));
  const setupBundlesReady = existsSync(bundle) && existsSync(recoveryCli) && existsSync(setupCli);
  const capabilities = [
    { id: "filesystem-baseline", state: filesystemReady ? "available" : "unavailable", remediation: filesystemReady ? "None." : "Build the MCP bundle and ensure the bundled skills directory is present." },
    { id: "python-worker", state: pythonPathReady ? "available" : "degraded", remediation: pythonPathReady ? "None." : "Optional: configure VAULT_MIND_PYTHON or PYTHON with a Python executable; Doctor does not invoke Python." },
    { id: "setup-bundles", state: setupBundlesReady ? "available" : "unavailable", remediation: setupBundlesReady ? "None." : "Build mcp-server bundles with npm run rebuild." },
  ];
  return { ok: checks.every(check => check.state !== "fail"), host: options.host, checks, capabilities, remediation: [...checks.filter(check => check.state !== "pass").map(check => check.summary), ...capabilities.filter(capability => capability.state !== "available").map(capability => capability.remediation)] };
}

function copy(source: string, destination: string, dryRun: boolean): void {
  if (dryRun) { process.stdout.write(`[dry-run] copy ${source} -> ${destination}\n`); return; }
  cpSync(source, destination, { recursive: true });
}

function install(root: string, options: SetupOptions, environment: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const destination = hostDirectory(options.host, environment);
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
  const configuredVault = options.vault || readVaultEnvironment(environment);
  const vault = configuredVault ? validDirectory(configuredVault) : undefined;
  if (configuredVault && !vault) throw new Error(`Configured vault path is invalid: ${configuredVault}`);
  const registration = options.dryRun ? { state: "skipped", reason: "dry-run" } : vault ? writeRegistration(root, options, destination, vault, environment) : { state: "skipped", reason: `No ${CANONICAL_VAULT_ENV} or --vault value provided` };
  return { ok: true, host: options.host, destination, dryRun: options.dryRun, installed, registration };
}

export function runSetup(argv: string[], environment: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const options = parseArgs(argv);
  const root = repoRoot();
  if (options.list) return listOutput();
  if (options.doctor) return doctor(root, options, environment);
  return install(root, options, environment);
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
