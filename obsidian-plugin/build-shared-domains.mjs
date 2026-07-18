import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(pluginRoot, "..");
const tsc = join(pluginRoot, "node_modules", "typescript", "bin", "tsc");
const typeRoots = join(pluginRoot, "node_modules", "@types");

for (const domain of ["settings-platform", "agent-domain", "visual-workspace"]) {
  const domainRoot = join(repositoryRoot, "packages", domain);
  rmSync(join(domainRoot, "dist"), { recursive: true, force: true });
  const result = spawnSync(process.execPath, [
    tsc,
    "-p",
    join(domainRoot, "tsconfig.build.json"),
    "--typeRoots",
    typeRoots,
  ], { cwd: pluginRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
