import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AdapterRegistry } from "./registry.js";
import type {
  GraphData,
  VaultMindAdapter,
} from "./interface.js";
import {
  makeAdapterGraphOps,
  queryAdapterGraphs,
} from "./graph-query.js";

function graphAdapter(
  name: string,
  graph: () => Promise<GraphData>,
): VaultMindAdapter {
  return {
    name,
    capabilities: ["graph"],
    graph,
    async init() {},
    async dispose() {},
  };
}

describe("queryAdapterGraphs", () => {
  it("keeps Graphify-like enriched evidence in an adapter-owned snapshot", async () => {
    const registry = new AdapterRegistry();
    registry.register(graphAdapter("graphify", async () => ({
      nodes: [
        { path: "src/target.ts", title: "Target" },
        { path: "src/source.ts", title: "Source" },
      ],
      edges: [{
        from: "src/source.ts",
        to: "src/target.ts",
        type: "link",
        evidence: [{
          adapter: "graphify",
          relation: "calls",
          confidence: "extracted",
          sourcePath: "src/source.ts",
        }],
      }],
    })));

    const result = await queryAdapterGraphs(registry);

    assert.equal(result.snapshots[0].adapter, "graphify");
    assert.equal(result.snapshots[0].status, "ok");
    assert.deepEqual(result.snapshots[0].graph.edges[0].evidence, [{
      adapter: "graphify",
      relation: "calls",
      confidence: "extracted",
      sourcePath: "src/source.ts",
    }]);
    assert.deepEqual(result.diagnostics, []);
  });

  it("degrades one failed adapter without blocking successful snapshots", async () => {
    const registry = new AdapterRegistry();
    registry.register(graphAdapter("broken", async () => {
      throw new Error("graph unavailable");
    }));
    registry.register(graphAdapter("healthy", async () => ({
      nodes: [{ path: "healthy.md" }],
      edges: [],
    })));

    const result = await queryAdapterGraphs(registry);

    assert.deepEqual(result.snapshots.map((snapshot) => ({
      adapter: snapshot.adapter,
      status: snapshot.status,
    })), [
      { adapter: "broken", status: "error" },
      { adapter: "healthy", status: "ok" },
    ]);
    assert.deepEqual(result.snapshots[0].graph, { nodes: [], edges: [] });
    assert.deepEqual(result.diagnostics, [{
      adapter: "broken",
      code: "adapter_graph_query_failed",
      severity: "warning",
      message: "Adapter graph query failed.",
    }]);
  });

  it("does not expose adapter errors containing secrets or machine-local paths", async () => {
    const registry = new AdapterRegistry();
    registry.register(graphAdapter("sensitive", async () => {
      throw new Error(
        "postgres://user:token@localhost/vault C:\\Users\\alice\\vault",
      );
    }));

    const result = await queryAdapterGraphs(registry);
    const serialized = JSON.stringify(result);

    assert.equal(serialized.includes("token"), false);
    assert.equal(serialized.includes("alice"), false);
    assert.equal(serialized.includes("postgres"), false);
    assert.equal(result.diagnostics[0].message, "Adapter graph query failed.");
  });

  it("queries only adapters included by the optional allowlist", async () => {
    const registry = new AdapterRegistry();
    let excludedCalls = 0;
    registry.register(graphAdapter("included", async () => ({
      nodes: [{ path: "included.md" }],
      edges: [],
    })));
    registry.register(graphAdapter("excluded", async () => {
      excludedCalls += 1;
      return { nodes: [{ path: "excluded.md" }], edges: [] };
    }));

    const result = await queryAdapterGraphs(registry, {
      adapters: ["included"],
    });

    assert.deepEqual(result.snapshots.map((snapshot) => snapshot.adapter), [
      "included",
    ]);
    assert.equal(excludedCalls, 0);

    const empty = await queryAdapterGraphs(registry, { adapters: [] });
    assert.deepEqual(empty, { snapshots: [], diagnostics: [] });
  });

  it("sorts adapters, nodes, edges, and evidence deterministically", async () => {
    const registry = new AdapterRegistry();
    registry.register(graphAdapter("zeta", async () => ({
      nodes: [{ path: "z.md" }],
      edges: [],
    })));
    registry.register(graphAdapter("alpha", async () => ({
      nodes: [
        { path: "z.md", title: "Zulu" },
        { path: "a.md", title: "Alpha" },
      ],
      edges: [
        {
          from: "z.md",
          to: "a.md",
          type: "link",
          evidence: [{
            adapter: "graphify",
            relation: "references",
            confidence: "ambiguous",
          }],
        },
        {
          from: "a.md",
          to: "z.md",
          type: "link",
          evidence: [
            {
              adapter: "graphify",
              relation: "uses",
              confidence: "inferred",
            },
            {
              adapter: "graphify",
              relation: "calls",
              confidence: "extracted",
            },
          ],
        },
      ],
    })));

    const first = await queryAdapterGraphs(registry);
    const second = await queryAdapterGraphs(registry);

    assert.deepEqual(first, second);
    assert.deepEqual(first.snapshots.map((snapshot) => snapshot.adapter), [
      "alpha",
      "zeta",
    ]);
    assert.deepEqual(
      first.snapshots[0].graph.nodes.map((node) => node.path),
      ["a.md", "z.md"],
    );
    assert.deepEqual(
      first.snapshots[0].graph.edges.map((edge) => `${edge.from}->${edge.to}`),
      ["a.md->z.md", "z.md->a.md"],
    );
    assert.deepEqual(
      first.snapshots[0].graph.edges[0].evidence?.map(
        (evidence) => evidence.relation,
      ),
      ["calls", "uses"],
    );
  });

  it("exposes the read-only operation without importing core operations", async () => {
    const registry = new AdapterRegistry();
    registry.register(graphAdapter("graphify", async () => ({
      nodes: [{ path: "graph.md" }],
      edges: [],
    })));
    const operation = makeAdapterGraphOps(registry)[0];

    assert.equal(operation.name, "graph.adapters.query");
    assert.equal(operation.mutating ?? false, false);
    const result = await operation.handler(null as never, {
      adapters: [" graphify ", "graphify"],
    }) as { snapshots: Array<{ adapter: string }> };
    assert.deepEqual(
      result.snapshots.map((snapshot) => snapshot.adapter),
      ["graphify"],
    );

    await assert.rejects(
      () => operation.handler(null as never, { adapters: [""] }),
      (error: unknown) => (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: unknown }).code === -32602 &&
        (error as { message?: unknown }).message ===
          "adapters must contain non-empty Knowledge Adapter names"
      ),
    );
  });
});
