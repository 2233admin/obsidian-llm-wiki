import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { CANONICAL_VAULT_ENV } from "../runtime-env.js";
import { runSetup } from "./setup.js";

const originalHome = process.env.HOME;
const temporaryHomes: string[] = [];

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;

  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function useTemporaryHome(setEnvironment = true): string {
  const home = mkdtempSync(join(tmpdir(), "llmwiki-setup-test-"));
  temporaryHomes.push(home);
  if (setEnvironment) process.env.HOME = home;
  return home;
}

function environmentFor(home: string): NodeJS.ProcessEnv {
  return { ...process.env, HOME: home, USERPROFILE: home };
}

describe("TypeScript setup entrypoint", () => {
  test("lists the canonical host targets and paths", () => {
    assert.deepEqual(runSetup(["--list"]), {
      hosts: [
        { id: "claude", skillRoot: "~/.claude/skills", config: "~/.mcp.json", supported: true },
        { id: "codex", skillRoot: "~/.codex/skills", config: "~/.codex/config.toml", supported: true },
        { id: "opencode", skillRoot: "~/.config/opencode/skills", config: "~/.config/opencode/mcp.json", supported: true },
        { id: "gemini", skillRoot: "~/.gemini/skills", config: "~/.gemini/settings.json", supported: true },
      ],
    });
  });

  test("rejects an unknown host before resolving or writing any setup paths", () => {
    assert.throws(() => runSetup(["--host", "unknown-host"]), /Unknown host 'unknown-host'/u);
  });

  test("reports doctor readiness and capability states without invoking Python", () => {
    const vault = mkdtempSync(join(tmpdir(), "llmwiki-setup-vault-"));
    temporaryHomes.push(vault);
    const originalVaultPython = process.env.VAULT_MIND_PYTHON;
    const originalPython = process.env.PYTHON;
    delete process.env.VAULT_MIND_PYTHON;
    delete process.env.PYTHON;

    try {
      const result = runSetup(["--host", "codex", "--doctor", "--vault", vault]);
      const checks = result.checks as Array<{ id: string; state: string }>;
      const capabilities = result.capabilities as Array<{ id: string; state: string; remediation: string }>;

      assert.equal(result.host, "codex");
      assert.deepEqual(checks.map(check => check.id), ["mcp-bundle", "recovery-cli", "setup-cli", "vault", "host-registration"]);
      assert.equal(checks.find(check => check.id === "mcp-bundle")?.state, "pass");
      assert.equal(checks.find(check => check.id === "vault")?.state, "pass");
      assert.equal(checks.find(check => check.id === "host-registration")?.state, "warn");
      assert.deepEqual(capabilities.map(capability => capability.id), ["filesystem-baseline", "python-worker", "setup-bundles"]);
      assert.equal(capabilities.find(capability => capability.id === "filesystem-baseline")?.state, "available");
      assert.equal(capabilities.find(capability => capability.id === "python-worker")?.state, "degraded");
      assert.match(capabilities.find(capability => capability.id === "python-worker")?.remediation ?? "", /does not invoke Python/u);
      assert.equal(
        capabilities.find(capability => capability.id === "setup-bundles")?.state,
        checks.filter(check => ["mcp-bundle", "recovery-cli", "setup-cli"].includes(check.id)).every(check => check.state === "pass") ? "available" : "unavailable",
      );
      assert.equal(result.ok, checks.every(check => check.state !== "fail"));
      assert.ok(Array.isArray(result.remediation));
    } finally {
      if (originalVaultPython === undefined) delete process.env.VAULT_MIND_PYTHON;
      else process.env.VAULT_MIND_PYTHON = originalVaultPython;
      if (originalPython === undefined) delete process.env.PYTHON;
      else process.env.PYTHON = originalPython;
    }
  });

  test("marks an explicitly invalid vault as a doctor failure", () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), "llmwiki-invalid-vault-"));
    const invalidVault = join(vaultRoot, "missing");
    temporaryHomes.push(vaultRoot);

    const result = runSetup(["--doctor", "--vault", invalidVault]);
    const check = (result.checks as Array<{ id: string; state: string; summary: string }>).find(item => item.id === "vault");

    assert.equal(check?.state, "fail");
    assert.match(check?.summary ?? "", /invalid/u);
    assert.equal(result.ok, false);
  });

  test("recognizes a PATH-resolved Python command without invoking it", () => {
    const bin = mkdtempSync(join(tmpdir(), "llmwiki-python-path-"));
    const originalPath = process.env.PATH;
    const originalPython = process.env.PYTHON;
    const originalVaultPython = process.env.VAULT_MIND_PYTHON;
    const originalPathext = process.env.PATHEXT;
    writeFileSync(join(bin, "python.exe"), "");
    writeFileSync(join(bin, "py.cmd"), "");
    process.env.PATH = bin;
    process.env.VAULT_MIND_PYTHON = "";
    process.env.PATHEXT = ".EXE;.CMD;.BAT";

    try {
      for (const command of ["python", "python.exe", "py.cmd"]) {
        process.env.PYTHON = command;
        const result = runSetup(["--doctor"]);
        const capability = (result.capabilities as Array<{ id: string; state: string; remediation: string }>).find(item => item.id === "python-worker");
        assert.equal(capability?.state, "available");
        assert.equal(capability?.remediation, "None.");
      }
      const result = runSetup(["--doctor"]);
      const vaultCheck = (result.checks as Array<{ id: string; state: string }>).find(item => item.id === "vault");
      assert.equal(vaultCheck?.state, "warn");
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      if (originalPython === undefined) delete process.env.PYTHON;
      else process.env.PYTHON = originalPython;
      if (originalVaultPython === undefined) delete process.env.VAULT_MIND_PYTHON;
      else process.env.VAULT_MIND_PYTHON = originalVaultPython;
      if (originalPathext === undefined) delete process.env.PATHEXT;
      else process.env.PATHEXT = originalPathext;
    }
  });

  test("dry-run previews installation without creating files in the host directory", () => {
    const home = useTemporaryHome();
    const hostSkills = join(home, ".codex", "skills");
    mkdirSync(hostSkills, { recursive: true });
    const before = readdirSync(hostSkills);

    const result = runSetup(["--host", "codex", "--dry-run"]);

    assert.equal(result.dryRun, true);
    assert.equal(result.destination, join(hostSkills, "vault-wiki"));
    assert.deepEqual(readdirSync(hostSkills), before);
    assert.equal(existsSync(result.destination as string), false);
  });

  test("writes a merged registration with the canonical vault environment", () => {
    const home = useTemporaryHome(false);
    const claudeDir = join(home, ".claude");
    mkdirSync(join(claudeDir, "skills"), { recursive: true });
    const configPath = join(home, ".mcp.json");
    writeFileSync(configPath, JSON.stringify({ mcpServers: { unrelated: { command: "keep-me", args: [] } } }), "utf8");
    const vault = mkdtempSync(join(tmpdir(), "llmwiki-registration-vault-"));
    temporaryHomes.push(vault);

    runSetup(["--host", "claude", "--vault", vault], environmentFor(home));

    const config = JSON.parse(readFileSync(configPath, "utf8")) as { mcpServers: Record<string, { args?: string[]; env?: Record<string, string> }> };
    assert.deepEqual(config.mcpServers.unrelated, { command: "keep-me", args: [] });
    const registration = config.mcpServers["vault-mind"];
    assert.equal(registration.env?.[CANONICAL_VAULT_ENV], vault);
    assert.deepEqual(registration.env, { VAULT_MIND_VAULT_PATH: vault });
    assert.equal(Object.prototype.hasOwnProperty.call(registration.env, "VAULT_PATH"), false);
    assert.equal(registration.args?.[0], join(home, ".claude", "skills", "vault-wiki", "mcp-server", "bundle.js"));
    const roles = readFileSync(join(claudeDir, "CLAUDE.md"), "utf8");
    assert.match(roles, /BEGIN LLM WIKI VAULT ROLES/u);
    assert.match(roles, /END LLM WIKI VAULT ROLES/u);
  });

  test("does not rewrite an unchanged registration or create backup churn", () => {
    const home = useTemporaryHome(false);
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    const vault = mkdtempSync(join(tmpdir(), "llmwiki-registration-idempotent-"));
    temporaryHomes.push(vault);

    runSetup(["--host", "claude", "--vault", vault], environmentFor(home));
    const configPath = join(home, ".mcp.json");
    const firstConfig = readFileSync(configPath, "utf8");
    const firstEntries = readdirSync(home).sort();
    runSetup(["--host", "claude", "--vault", vault], environmentFor(home));

    assert.equal(readFileSync(configPath, "utf8"), firstConfig);
    assert.deepEqual(readdirSync(home).sort(), firstEntries);
  });

  test("rejects malformed host configuration without overwriting it", () => {
    const home = useTemporaryHome(false);
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    const configPath = join(home, ".mcp.json");
    const malformed = "{ not-json";
    writeFileSync(configPath, malformed, "utf8");

    assert.throws(() => runSetup(["--host", "claude", "--vault", home], environmentFor(home)), /Invalid JSON/u);
    assert.equal(readFileSync(configPath, "utf8"), malformed);
  });

  test("rejects duplicate managed role blocks without overwriting host files", () => {
    const home = useTemporaryHome(false);
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    const rolesPath = join(home, ".claude", "CLAUDE.md");
    const duplicate = "<!-- BEGIN LLM WIKI VAULT ROLES -->\nold\n<!-- END LLM WIKI VAULT ROLES -->\n<!-- BEGIN LLM WIKI VAULT ROLES -->\nold\n<!-- END LLM WIKI VAULT ROLES -->\n";
    writeFileSync(rolesPath, duplicate, "utf8");
    const vault = mkdtempSync(join(tmpdir(), "llmwiki-duplicate-roles-"));
    temporaryHomes.push(vault);

    assert.throws(() => runSetup(["--host", "claude", "--vault", vault], environmentFor(home)), /exactly one ordered marker pair/u);
    assert.equal(readFileSync(rolesPath, "utf8"), duplicate);
  });

  test("doctor fails when host registration is missing", () => {
    const home = useTemporaryHome(false);
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    const vault = mkdtempSync(join(tmpdir(), "llmwiki-doctor-missing-"));
    temporaryHomes.push(vault);

    const result = runSetup(["--host", "claude", "--doctor", "--vault", vault], environmentFor(home)) as { ok: boolean; checks: Array<{ id: string; state: string }> };
    assert.equal(result.checks.find(check => check.id === "host-registration")?.state, "fail");
    assert.equal(result.ok, false);
  });

  test("doctor fails for a mismatched registration and passes a valid one", () => {
    const home = useTemporaryHome(false);
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    const vault = mkdtempSync(join(tmpdir(), "llmwiki-doctor-valid-"));
    const wrongVault = mkdtempSync(join(tmpdir(), "llmwiki-doctor-wrong-"));
    temporaryHomes.push(vault, wrongVault);

    runSetup(["--host", "claude", "--vault", vault], environmentFor(home));
    const configPath = join(home, ".mcp.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { mcpServers: { "vault-mind": { env: Record<string, string> } } };
    config.mcpServers["vault-mind"].env[CANONICAL_VAULT_ENV] = wrongVault;
    writeFileSync(configPath, JSON.stringify(config), "utf8");

    const mismatch = runSetup(["--host", "claude", "--doctor", "--vault", vault], environmentFor(home)) as { ok: boolean; checks: Array<{ id: string; state: string }> };
    assert.equal(mismatch.checks.find(check => check.id === "host-registration")?.state, "fail");
    assert.equal(mismatch.ok, false);

    runSetup(["--host", "claude", "--vault", vault], environmentFor(home));
    const valid = runSetup(["--host", "claude", "--doctor", "--vault", vault], environmentFor(home)) as { ok: boolean; checks: Array<{ id: string; state: string }> };
    assert.equal(valid.checks.find(check => check.id === "host-registration")?.state, "pass");
    assert.equal(valid.ok, true);
  });

  test("recovers a displaced host config before writing", () => {
    const home = useTemporaryHome(false);
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    const configPath = join(home, ".mcp.json");
    const displaced = JSON.stringify({ mcpServers: { unrelated: { command: "keep-me" } } });
    writeFileSync(`${configPath}.swap`, displaced, "utf8");
    const vault = mkdtempSync(join(tmpdir(), "llmwiki-recovery-"));
    temporaryHomes.push(vault);

    runSetup(["--host", "claude", "--vault", vault], environmentFor(home));
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { mcpServers: Record<string, unknown> };
    assert.ok(config.mcpServers.unrelated);
    assert.ok(config.mcpServers["vault-mind"]);
    assert.equal(existsSync(`${configPath}.swap`), false);
  });
});
