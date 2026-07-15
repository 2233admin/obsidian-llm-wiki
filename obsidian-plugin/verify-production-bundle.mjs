import esbuild from "esbuild";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const external = [
  "obsidian", "electron",
  "child_process", "util", "fs", "path", "os", "crypto", "events", "stream",
  "node:*",
];

export async function verifyProductionBundleBoundary() {
  const result = await esbuild.build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    nodePaths: [resolve("node_modules")],
    external,
    format: "cjs",
    target: "es2020",
    platform: "node",
    treeShaking: true,
    minify: true,
    write: false,
    metafile: true,
  });
  const inputs = Object.keys(result.metafile.inputs).map(path => path.replaceAll("\\", "/"));
  const forbiddenInput = inputs.find(path => [
    "/mcp-server/src/index.ts",
    "/mcp-server/src/connector/",
    "/mcp-server/src/server/",
    "/mcp-server/src/rag/",
    "/mcp-server/src/lightrag/",
    "/mcp-server/src/adapters/python",
    "/mcp-server/src/adapters/lightrag",
  ].some(fragment => path.includes(fragment)));
  if (forbiddenInput) throw new Error(`Production Obsidian bundle crossed a forbidden server boundary: ${forbiddenInput}`);

  const output = result.outputFiles.map(file => file.text).join("\n");
  for (const forbiddenToken of [
    "StdioServerTransport",
    "WebSocketServer",
    "@modelcontextprotocol/sdk/server",
    "startMcpServer",
  ]) {
    if (output.includes(forbiddenToken)) {
      throw new Error(`Production Obsidian bundle contains forbidden startup/listener token: ${forbiddenToken}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyProductionBundleBoundary();
}
