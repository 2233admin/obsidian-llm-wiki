import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

const output = ".settings-test.cjs";
try {
  await esbuild.build({
    entryPoints: ["tests/settings.test.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
  });
  const result = spawnSync(process.execPath, ["--test", output], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(output, { force: true });
}
