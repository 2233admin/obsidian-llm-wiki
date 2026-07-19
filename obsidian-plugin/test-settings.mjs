import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { verifyProductionBundleBoundary } from "./verify-production-bundle.mjs";

const output = ".settings-test.cjs";
try {
  await verifyProductionBundleBoundary();
  await esbuild.build({
    stdin: {
      contents: 'import "./tests/settings.test.ts"; import "./tests/control-plane.test.ts"; import "./tests/production-control-plane.test.ts"; import "./tests/main-lifecycle.test.ts"; import "./tests/ask-mate-outline.test.ts"; import "./tests/ask-mate-client.test.ts"; import "./tests/ask-mate-interaction.test.ts"; import "./tests/ask-mate-view.test.ts"; import "./tests/ask-mate-activation.test.ts"; import "./tests/ask-mate-production.test.ts";',
      resolveDir: process.cwd(),
      sourcefile: "tests/all.test.ts",
      loader: "ts",
    },
    outfile: output,
    bundle: true,
    // The obsidian package is types-only; lifecycle tests run src/main.ts
    // against this runtime stub.
    alias: { obsidian: resolve("tests/obsidian-stub.ts") },
    nodePaths: [resolve("node_modules")],
    platform: "node",
    format: "cjs",
    target: "node20",
  });
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec", output], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(output, { force: true });
}
