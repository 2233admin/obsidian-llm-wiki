import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { LightRAGAdapter } from "./lightrag.js";

function response(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("LightRAGAdapter", () => {
  it("isAvailable=false when baseUrl is missing", async () => {
    const adapter = new LightRAGAdapter({ baseUrl: undefined });
    await adapter.init();
    assert.equal(adapter.isAvailable, false);
    assert.deepEqual(await adapter.search("attention"), []);
  });

  it("init() marks adapter available when /health is ok", async () => {
    const calls: string[] = [];
    const adapter = new LightRAGAdapter({
      baseUrl: "http://lightrag.local/",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return response({ status: "ok" });
      },
    });
    await adapter.init();
    assert.equal(adapter.isAvailable, true);
    assert.deepEqual(calls, ["http://lightrag.local/health"]);
  });

  it("search() maps /query/data chunks into SearchResult[]", async () => {
    const requests: Array<{ url: string; body?: string; headers?: HeadersInit }> = [];
    const adapter = new LightRAGAdapter({
      baseUrl: "http://lightrag.local",
      apiKey: "secret",
      mode: "hybrid",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: init?.body as string | undefined, headers: init?.headers });
        if (String(url).endsWith("/health")) return response({ ok: true });
        return response({
          data: {
            chunks: [
              {
                id: "chunk-1",
                full_doc_id: "doc-1",
                file_path: "notes/rag.md",
                content: "LightRAG retrieves with graph-aware context.",
                score: 0.91,
                chunk_order_index: 3,
              },
            ],
          },
        });
      },
    });
    await adapter.init();
    const results = await adapter.search("graph retrieval", { maxResults: 5 });
    assert.equal(results.length, 1);
    assert.equal(results[0].source, "lightrag");
    assert.equal(results[0].path, "notes/rag.md");
    assert.equal(results[0].content, "LightRAG retrieves with graph-aware context.");
    assert.equal(results[0].score, 0.91);
    assert.equal(results[0].metadata?.fullDocId, "doc-1");
    assert.ok(requests.some((r) => r.url === "http://lightrag.local/query/data"));
    const body = JSON.parse(requests.find((r) => r.url.endsWith("/query/data"))?.body ?? "{}");
    assert.equal(body.mode, "hybrid");
    assert.equal(body.top_k, 5);
    const queryHeaders = requests.find((r) => r.url.endsWith("/query/data"))?.headers as Record<string, string>;
    assert.equal(queryHeaders["X-API-Key"], "secret");
  });

  it("search() falls back to /query text response when /query/data is empty", async () => {
    const adapter = new LightRAGAdapter({
      baseUrl: "http://lightrag.local",
      fetchImpl: async (url) => {
        const s = String(url);
        if (s.endsWith("/health")) return response({});
        if (s.endsWith("/query/data")) return response({ chunks: [] });
        return response({ response: "Synthesized answer with citations upstream." });
      },
    });
    await adapter.init();
    const results = await adapter.search("what is this", { maxResults: 2 });
    assert.equal(results.length, 1);
    assert.equal(results[0].path, "lightrag:/query");
    assert.equal(results[0].content, "Synthesized answer with citations upstream.");
  });

  it("search() returns [] when unavailable", async () => {
    const adapter = new LightRAGAdapter({
      baseUrl: "http://lightrag.local",
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    await adapter.init();
    assert.equal(adapter.isAvailable, false);
    assert.deepEqual(await adapter.search("offline"), []);
  });

  it("insertText() posts to /documents/text", async () => {
    const requests: Array<{ url: string; body?: string }> = [];
    const adapter = new LightRAGAdapter({
      baseUrl: "http://lightrag.local",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: init?.body as string | undefined });
        if (String(url).endsWith("/health")) return response({});
        return response({ status: "queued", track_id: "track-1" });
      },
    });
    await adapter.init();
    const result = await adapter.insertText({
      text: "# Note\n\nLightRAG source text",
      fileSource: "notes/source.md",
    });
    assert.equal(result.ok, true);
    assert.equal(result.trackId, "track-1");
    assert.equal(result.status, "queued");
    const body = JSON.parse(requests.find((r) => r.url.endsWith("/documents/text"))?.body ?? "{}");
    assert.equal(body.text, "# Note\n\nLightRAG source text");
    assert.equal(body.file_source, "notes/source.md");
  });

  it("uploadFile() posts multipart to /documents/upload", async () => {
    const requests: Array<{ url: string; bodyType: string }> = [];
    const adapter = new LightRAGAdapter({
      baseUrl: "http://lightrag.local",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), bodyType: init?.body?.constructor?.name ?? "" });
        if (String(url).endsWith("/health")) return response({});
        return response({ status: "queued", track_id: "track-2" });
      },
    });
    await adapter.init();
    const result = await adapter.uploadFile({
      filePath: fileURLToPath(import.meta.url),
      fileName: "lightrag.test.ts",
    });
    assert.equal(result.trackId, "track-2");
    assert.equal(requests.some((r) => r.url.endsWith("/documents/upload") && r.bodyType === "FormData"), true);
  });
});
