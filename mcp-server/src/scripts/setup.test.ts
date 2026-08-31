import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { runSetup } from "./setup.js";

const originalHome = process.env.HOME;
const temporaryHomes: string[] = [];

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;

  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function useTemporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), "llmwiki-setup-test-"));
  temporaryHomes.push(home);
  process.env.HOME = home;
  return home;
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
      assert.deepEqual(checks.map(check => check.id), ["mcp-bundle", "recovery-cli", "setup-cli", "vault"]);
      assert.equal(checks.find(check => check.id === "mcp-bundle")?.state, "pass");
      assert.equal(checks.find(check => check.id === "vault")?.state, "pass");
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
});
