import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkDistribution, formatSummary } from "../../scripts/check-distribution.mjs";

const manifest = {
  publicName: "llmwiki",
  displayName: "LLMwiki",
  repository: "2233admin/obsidian-llm-wiki",
  pluginInstall: {
    marketplace: "/plugin marketplace add 2233admin/obsidian-llm-wiki",
    install: "/plugin install llmwiki@obsidian-llm-wiki",
  },
  legacySkillBundle: "vault-wiki",
  mcpServerName: "vault-mind",
  vaultPathEnv: "VAULT_MIND_VAULT_PATH",
  hosts: {
    claude: {
      skillsDir: "{home}/.claude/skills/{legacySkillBundle}",
    },
  },
  install: {
    copyDirs: ["skills", "docs", "archify", "smoke"],
    copyFiles: ["README.md", "LICENSE"],
    mcpFiles: ["mcp-server/bundle.js", "mcp-server/package.json"],
    topLevelSkills: ["vault-diagram"],
  },
  plugin: {
    requiredFiles: [
      ".claude-plugin/plugin.json",
      ".claude-plugin/marketplace.json",
      ".claude-plugin/mcp.json",
    ],
    mcpBundleArg: "${CLAUDE_PLUGIN_ROOT}/mcp-server/bundle.js",
  },
  release: {
    onboardingFiles: [],
  },
};

async function writeJson(root, path, value) {
  await writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

async function makeFixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "llmwiki-distribution-"));
  const dirs = [
    ".claude-plugin",
    "packaging",
    "mcp-server",
    "skills/vault-diagram",
    "docs",
    "archify",
  ];
  for (const dir of dirs) {
    await mkdir(join(root, dir), { recursive: true });
  }

  await writeJson(root, "packaging/llmwiki-distribution.json", {
    ...manifest,
    ...overrides.manifest,
  });
  await writeJson(root, ".claude-plugin/plugin.json", {
    name: overrides.pluginName ?? "llmwiki",
  });
  await writeJson(root, ".claude-plugin/marketplace.json", {
    plugins: [{ name: overrides.marketplaceName ?? "llmwiki" }],
  });
  await writeJson(root, ".claude-plugin/mcp.json", {
    mcpServers: {
      "vault-mind": {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/mcp-server/bundle.js"],
      },
    },
  });
  await writeJson(root, "mcp-server/package.json", { type: "module" });
  await writeJson(root, "archify/package.json", { type: "module" });
  await writeFile(join(root, "mcp-server/bundle.js"), "");
  await writeFile(join(root, "skills/vault-diagram/SKILL.md"), "# Vault diagram\n");
  await writeFile(
    join(root, "README.md"),
    `${manifest.pluginInstall.marketplace}\n${manifest.pluginInstall.install}\n`,
  );
  await writeFile(join(root, "LICENSE"), "MIT\n");

  return root;
}

test("accepts a complete distribution fixture", async () => {
  const root = await makeFixture();
  try {
    const summary = checkDistribution({ root });

    assert.deepEqual(summary, {
      publicName: "llmwiki",
      hosts: 1,
      copyDirs: 4,
    });
    assert.equal(formatSummary(summary), "distribution ok: llmwiki, 1 hosts, 4 dirs");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails when a required plugin file is missing", async () => {
  const root = await makeFixture();
  try {
    await rm(join(root, ".claude-plugin/plugin.json"));

    assert.throws(
      () => checkDistribution({ root }),
      /Missing file: \.claude-plugin\/plugin\.json/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails when plugin metadata drifts from the manifest", async () => {
  const root = await makeFixture({ pluginName: "vault-wiki" });
  try {
    assert.throws(
      () => checkDistribution({ root }),
      /plugin\.json name must match manifest publicName/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails when host install paths lose required placeholders", async () => {
  const root = await makeFixture({
    manifest: {
      hosts: {
        claude: {
          skillsDir: "{home}/.claude/skills/llmwiki",
        },
      },
    },
  });
  try {
    assert.throws(
      () => checkDistribution({ root }),
      /host claude skillsDir must include \{legacySkillBundle\}/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
