import esbuild from "esbuild";
import process from "process";

const production = process.argv[2] === "production";

// Obsidian + Electron + the Node builtins we use are provided by the runtime;
// never bundle them.
const external = [
  "obsidian", "electron",
  "child_process", "util", "fs", "path", "os", "crypto", "events", "stream",
];

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external,
  format: "cjs",
  target: "es2020",
  platform: "node",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production,
  outfile: "main.js",
});

if (production) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
