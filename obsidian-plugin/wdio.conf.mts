import * as path from "node:path";

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
