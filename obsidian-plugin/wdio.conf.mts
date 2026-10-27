import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Obsidian inherits this HOME. It holds a Claude Code plugin install record
// pointing at this checkout, as `/plugin install` would leave it, so the
// plugin's runtime detection finds compiler/kb_meta.py like it would for a
// user. It also keeps user-device settings out of the developer's real home.
const home = mkdtempSync(path.join(os.tmpdir(), "llmwiki-e2e-home-"));
mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
writeFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
  version: 2,
  plugins: { "llmwiki@obsidian-llm-wiki": [{ scope: "user", installPath: path.resolve("..") }] },
}));
process.env.HOME = home;
process.env.USERPROFILE = home;

// End-to-end tests against a real Obsidian desktop app (Electron), driven by
// wdio-obsidian-service. On Linux CI run under xvfb (`xvfb-run npm run e2e`).
export const config: WebdriverIO.Config = {
  runner: "local",
  framework: "mocha",
  specs: ["./e2e/specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [{
    browserName: "obsidian",
    browserVersion: process.env.OBSIDIAN_VERSION ?? "latest",
    "wdio:obsidianOptions": {
      installerVersion: "latest",
      plugins: ["."],
      vault: "e2e/vaults/basic",
    },
  }],
  services: ["obsidian"],
  reporters: ["obsidian"],
  cacheDir: path.resolve(".obsidian-cache"),
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  logLevel: "warn",
};
