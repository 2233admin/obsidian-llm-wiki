/**
 * Unit tests for GraphifyAdapter.
 *
 * Does not require graphify CLI installed -- tests use a fake node script
 * as the binary and a temp dir for graph.json fixtures.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraphifyAdapter } from "./graphify.js";

function makeFakeGraphify(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "graphify-fake-"));
  const cjsPath = join(dir, "fake-graphify.cjs");
  const script =
    "#!/usr/bin/env node\n" +
    "const args = process.argv.slice(2);\n" +
    "if (args[0] === '--version') {\n" +
    "  process.stdout.write('graphify 1.0.0\\n');\n" +
    "  process.exit(0);\n" +
    "} else if (args[0] === 'query') {\n" +
    "  process.stdout.write('Traversal: NodeA -> NodeB -> NodeC\\n');\n" +
    "  process.exit(0);\n" +
    "} else if (args[0] === 'update') {\n" +
    "  process.exit(0);\n" +
    "} else {\n" +
    "  process.exit(0);\n" +
    "}\n";
  writeFileSync(cjsPath, script, { mode: 0o755 });

  let binPath: string;
  if (process.platform === "win32") {
    // On Windows, .cjs files are not directly executable — wrap via .cmd
    binPath = join(dir, "fake-graphify.cmd");
    writeFileSync(binPath, `@echo off\nnode "${cjsPath}" %*\n`);
  } else {
    binPath = cjsPath;
    try {
      chmodSync(cjsPath, 0o755);
    } catch {
      // ignore
    }
  }

  return {
    path: binPath,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

function writeGraphJson(dir: string, graph: unknown): void {
  writeFileSync(join(dir, "graph.json"), JSON.stringify(graph));
}

const SAMPLE_GRAPH = {
  nodes: [
    { id: "n1", label: "MyClass", file_type: "code", source_file: "src/myclass.py" },
    { id: "n2", label: "myMethod", file_type: "code", source_file: "src/myclass.py" },
    { id: "n3", label: "helper_fn", file_type: "code", source_file: "src/helper.py" },
    { id: "n4", label: "README", file_type: "document", source_file: "README.md" },
  ],
  edges: [
    { source: "n1", target: "n2", relation: "method", confidence: "EXTRACTED", source_file: "src/myclass.py" },
    { source: "n2", target: "n3", relation: "calls", confidence: "EXTRACTED", source_file: "src/myclass.py" },
    { source: "n3", target: "n4", relation: "semantically_similar_to", confidence: "INFERRED", source_file: "src/helper.py" },
  ],
};

describe("GraphifyAdapter", () => {
  it("isAvailable=false when binary missing (graceful degradation)", async () => {
    const adapter = new GraphifyAdapter({ binary: "no-such-graphify-xyz123" });
    await adapter.init();
    assert.equal(adapter.isAvailable, false);
  });

  it("isAvailable=true when binary --version exits 0", async () => {
    const fake = makeFakeGraphify();
    try {
      const adapter = new GraphifyAdapter({ binary: fake.path });
      await adapter.init();
      assert.equal(adapter.isAvailable, true);
      await adapter.dispose();
    } finally {
      fake.cleanup();
    }
  });

  it("keeps a cached graph readable when the CLI is unavailable", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "graphify-cached-"));
    try {
      writeGraphJson(tmpDir, SAMPLE_GRAPH);
      const adapter = new GraphifyAdapter({
        binary: "no-such-graphify-xyz123",
        outputDir: tmpDir,
      });
      await adapter.init();
      assert.equal(adapter.isAvailable, true);
      assert.equal((await adapter.graph()).nodes.length, 3);
      assert.deepEqual(await adapter.search("anything"), []);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("never exposes configured machine paths through search or graph results", async () => {
    const fake = makeFakeGraphify();
    const tmpDir = mkdtempSync(join(tmpdir(), "graphify-private-output-"));
    const vaultDir = mkdtempSync(join(tmpdir(), "graphify-vault-"));
    try {
      const privatePath = join(vaultDir, "src", "inside.ts");
      const outsidePath = join(tmpdir(), "private-user", "outside.ts");
      writeGraphJson(tmpDir, {
        nodes: [
          { id: "inside", label: "Inside", file_type: "code", source_file: privatePath },
          { id: "outside", label: "Outside", file_type: "code", source_file: outsidePath },
        ],
        edges: [],
      });
      const adapter = new GraphifyAdapter({
        binary: fake.path,
        vaultPath: vaultDir,
        outputDir: tmpDir,
      });
      await adapter.init();

      const search = await adapter.search("inside");
      assert.equal(search[0]?.path, "graphify-out/graph.json");
      const graph = await adapter.graph();
      assert.deepEqual(graph.nodes.map((node) => node.path), ["src/inside.ts"]);
      const serialized = JSON.stringify({ search, graph });
      assert.equal(serialized.includes(tmpDir), false);
      assert.equal(serialized.includes("private-user"), false);
    } finally {
      fake.cleanup();
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(vaultDir, { recursive: true, force: true });
    }
  });

  it("search() returns [] when unavailable", async () => {
    const adapter = new GraphifyAdapter({ binary: "no-such-graphify-xyz123" });
    await adapter.init();
    const results = await adapter.search("anything");
    assert.deepEqual(results, []);
  });

  it("search() wraps BFS traversal text as single SearchResult", async () => {
    const fake = makeFakeGraphify();
    try {
      const adapter = new GraphifyAdapter({ binary: fake.path });
      await adapter.init();
      const results = await adapter.search("who calls helper_fn");
      assert.equal(results.length, 1);
      assert.equal(results[0].source, "graphify");
      assert.equal(results[0].score, 1.0);
      assert.ok(results[0].content.includes("Traversal"));
      assert.equal((results[0].metadata as Record<string, unknown>)?.query, "who calls helper_fn");
    } finally {
      fake.cleanup();
    }
  });

  it("graph() returns empty when graph.json absent", async () => {
    const fake = makeFakeGraphify();
    try {
      const adapter = new GraphifyAdapter({
        binary: fake.path,
        outputDir: join(tmpdir(), "no-such-graphify-out-xyz"),
      });
      await adapter.init();
      const data = await adapter.graph();
      assert.deepEqual(data, { nodes: [], edges: [] });
    } finally {
      fake.cleanup();
    }
  });

  it("graph() collapses symbol nodes to unique file-level GraphNodes", async () => {
    const fake = makeFakeGraphify();
    const tmpDir = mkdtempSync(join(tmpdir(), "graphify-out-"));
    try {
      writeGraphJson(tmpDir, SAMPLE_GRAPH);
      const adapter = new GraphifyAdapter({ binary: fake.path, outputDir: tmpDir });
      await adapter.init();
      const data = await adapter.graph();
      // 4 nodes span 3 unique files
      assert.equal(data.nodes.length, 3);
      const paths = data.nodes.map((n) => n.path).sort();
      assert.deepEqual(paths, ["README.md", "src/helper.py", "src/myclass.py"]);
      // titles are basenames
      const titles = new Set(data.nodes.map((n) => n.title));
      assert.ok(titles.has("myclass.py"));
      assert.ok(titles.has("helper.py"));
      assert.ok(titles.has("README.md"));
    } finally {
      fake.cleanup();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("graph() skips same-file edges and maps 'calls' to 'link'", async () => {
    const fake = makeFakeGraphify();
    const tmpDir = mkdtempSync(join(tmpdir(), "graphify-out-"));
    try {
      writeGraphJson(tmpDir, SAMPLE_GRAPH);
      const adapter = new GraphifyAdapter({ binary: fake.path, outputDir: tmpDir });
      await adapter.init();
      const data = await adapter.graph();
      // n1->n2: "method", same file -> skipped
      // n2->n3: "calls" -> link (src/myclass.py -> src/helper.py)
      // n3->n4: "semantically_similar_to" -> link (src/helper.py -> README.md)
      assert.equal(data.edges.length, 2);
      const types = data.edges.map((e) => e.type);
      assert.ok(types.every((t) => t === "link"));
    } finally {
      fake.cleanup();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("graph() preserves Graphify relation, confidence, adapter, and source evidence", async () => {
    const fake = makeFakeGraphify();
    const tmpDir = mkdtempSync(join(tmpdir(), "graphify-out-"));
    try {
      writeGraphJson(tmpDir, SAMPLE_GRAPH);
      const adapter = new GraphifyAdapter({ binary: fake.path, outputDir: tmpDir });
      await adapter.init();
      const data = await adapter.graph();

      const callsEdge = data.edges.find(
        (edge) => edge.from === "src/myclass.py" && edge.to === "src/helper.py",
      );
      assert.deepEqual(callsEdge?.evidence, [
        {
          adapter: "graphify",
          relation: "calls",
          confidence: "extracted",
          sourcePath: "src/myclass.py",
        },
      ]);

      const inferredEdge = data.edges.find(
        (edge) => edge.from === "src/helper.py" && edge.to === "README.md",
      );
      assert.deepEqual(inferredEdge?.evidence, [
        {
          adapter: "graphify",
          relation: "semantically_similar_to",
          confidence: "inferred",
          sourcePath: "src/helper.py",
        },
      ]);
    } finally {
      fake.cleanup();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("graph() maps 'contains' and 'method' cross-file relations to 'tag'", async () => {
    const fake = makeFakeGraphify();
    const tmpDir = mkdtempSync(join(tmpdir(), "graphify-out-"));
    try {
      writeGraphJson(tmpDir, {
        nodes: [
          { id: "a1", label: "ClassA", file_type: "code", source_file: "a.py" },
          { id: "b1", label: "ClassB", file_type: "code", source_file: "b.py" },
        ],
        edges: [
          { source: "a1", target: "b1", relation: "contains", confidence: "EXTRACTED", source_file: "a.py" },
        ],
      });
      const adapter = new GraphifyAdapter({ binary: fake.path, outputDir: tmpDir });
      await adapter.init();
      const data = await adapter.graph();
      assert.equal(data.edges.length, 1);
      assert.equal(data.edges[0].type, "tag");
    } finally {
      fake.cleanup();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("graph() deduplicates identical evidence collapsed to same (from, to, type)", async () => {
    const fake = makeFakeGraphify();
    const tmpDir = mkdtempSync(join(tmpdir(), "graphify-out-"));
    try {
      writeGraphJson(tmpDir, {
        nodes: [
          { id: "n1", label: "FuncA", file_type: "code", source_file: "a.py" },
          { id: "n2", label: "FuncB", file_type: "code", source_file: "b.py" },
          { id: "n3", label: "FuncC", file_type: "code", source_file: "a.py" },
        ],
        edges: [
          { source: "n1", target: "n2", relation: "calls", confidence: "EXTRACTED", source_file: "a.py" },
          { source: "n3", target: "n2", relation: "calls", confidence: "EXTRACTED", source_file: "a.py" },
        ],
      });
      const adapter = new GraphifyAdapter({ binary: fake.path, outputDir: tmpDir });
      await adapter.init();
      const data = await adapter.graph();
      // Both edges collapse to (a.py -> b.py, "link") -- deduped to 1
      assert.equal(data.edges.length, 1);
      assert.equal(data.edges[0].from, "a.py");
      assert.equal(data.edges[0].to, "b.py");
      assert.equal(data.edges[0].evidence?.length, 1);
    } finally {
      fake.cleanup();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("graph() aggregates distinct evidence and normalizes unsupported confidence", async () => {
    const fake = makeFakeGraphify();
    const tmpDir = mkdtempSync(join(tmpdir(), "graphify-out-"));
    try {
      writeGraphJson(tmpDir, {
        nodes: [
          { id: "a1", label: "A", file_type: "code", source_file: "a.py" },
          { id: "a2", label: "A2", file_type: "code", source_file: "a.py" },
          { id: "b1", label: "B", file_type: "code", source_file: "b.py" },
        ],
        edges: [
          {
            source: "a1",
            target: "b1",
            relation: "calls",
            confidence: "AMBIGUOUS",
            source_file: "a.py",
          },
          {
            source: "a2",
            target: "b1",
            relation: "depends_on",
            confidence: "CUSTOM",
            source_file: "generated/inference.json",
          },
        ],
      });
      const adapter = new GraphifyAdapter({ binary: fake.path, outputDir: tmpDir });
      await adapter.init();
      const data = await adapter.graph();

      assert.equal(data.edges.length, 1);
      assert.deepEqual(data.edges[0].evidence, [
        {
          adapter: "graphify",
          relation: "calls",
          confidence: "ambiguous",
          sourcePath: "a.py",
        },
        {
          adapter: "graphify",
          relation: "depends_on",
          confidence: "unknown",
          sourcePath: "generated/inference.json",
        },
      ]);
    } finally {
      fake.cleanup();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("graph() accepts NetworkX 'links' alias for edges", async () => {
    const fake = makeFakeGraphify();
    const tmpDir = mkdtempSync(join(tmpdir(), "graphify-out-"));
    try {
      writeGraphJson(tmpDir, {
        nodes: [
          { id: "x1", label: "X", file_type: "code", source_file: "x.py" },
          { id: "y1", label: "Y", file_type: "code", source_file: "y.py" },
        ],
        links: [
          { source: "x1", target: "y1", relation: "imports", confidence: "EXTRACTED", source_file: "x.py" },
        ],
      });
      const adapter = new GraphifyAdapter({ binary: fake.path, outputDir: tmpDir });
      await adapter.init();
      const data = await adapter.graph();
      assert.equal(data.edges.length, 1);
    } finally {
      fake.cleanup();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("read() returns labels of nodes belonging to the given file", async () => {
    const fake = makeFakeGraphify();
    const tmpDir = mkdtempSync(join(tmpdir(), "graphify-out-"));
    try {
      writeGraphJson(tmpDir, SAMPLE_GRAPH);
      const adapter = new GraphifyAdapter({ binary: fake.path, outputDir: tmpDir });
      await adapter.init();
      const content = await adapter.read("src/myclass.py");
      assert.ok(content.includes("MyClass"));
      assert.ok(content.includes("myMethod"));
      assert.ok(!content.includes("helper_fn"));
    } finally {
      fake.cleanup();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("read() returns empty string when path not in graph", async () => {
    const fake = makeFakeGraphify();
    const tmpDir = mkdtempSync(join(tmpdir(), "graphify-out-"));
    try {
      writeGraphJson(tmpDir, SAMPLE_GRAPH);
      const adapter = new GraphifyAdapter({ binary: fake.path, outputDir: tmpDir });
      await adapter.init();
      const content = await adapter.read("no/such/file.py");
      assert.equal(content, "");
    } finally {
      fake.cleanup();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("read() returns empty string when unavailable", async () => {
    const adapter = new GraphifyAdapter({ binary: "no-such-graphify-xyz123" });
    await adapter.init();
    assert.equal(await adapter.read("any/file.py"), "");
  });
});
