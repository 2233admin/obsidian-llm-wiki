import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RAGAnythingAdapter } from "./raganything.js";

function response(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("RAGAnythingAdapter", () => {
  it("isAvailable=false when baseUrl is missing", async () => {
    const adapter = new RAGAnythingAdapter({ baseUrl: undefined });
    await adapter.init();
    assert.equal(adapter.isAvailable, false);
    assert.deepEqual(await adapter.search("chart"), []);
  });

  it("init() marks adapter available when /health is ok", async () => {
    const calls: string[] = [];
    const adapter = new RAGAnythingAdapter({
      baseUrl: "http://raganything.local/",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return response({ status: "ok" });
      },
    });
    await adapter.init();
    assert.equal(adapter.isAvailable, true);
    assert.deepEqual(calls, ["http://raganything.local/health"]);
  });

  it("search() maps multimodal chunks into SearchResult[]", async () => {
    const requests: Array<{ url: string; body?: string }> = [];
    const adapter = new RAGAnythingAdapter({
      baseUrl: "http://raganything.local",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: init?.body as string | undefined });
        if (String(url).endsWith("/health")) return response({});
        return response({
          results: [{
            id: "chunk-1",
            doc_id: "doc-1",
            file_path: "attachments/report.pdf",
            text: "A table extracted from page 3.",
            score: 0.87,
            page_idx: 3,
            type: "table",
          }],
        });
      },
    });
    await adapter.init();
    const results = await adapter.search("table", { maxResults: 5 });
    assert.equal(results.length, 1);
    assert.equal(results[0].source, "raganything");
    assert.equal(results[0].path, "attachments/report.pdf");
    assert.equal(results[0].content, "A table extracted from page 3.");
    assert.equal(results[0].score, 0.87);
    assert.equal(results[0].metadata?.type, "table");
    const body = JSON.parse(requests.find((r) => r.url.endsWith("/query"))?.body ?? "{}");
    assert.equal(body.top_k, 5);
    assert.equal(body.max_results, 5);
  });

  it("processDocument() maps markdown response", async () => {
    const requests: Array<{ url: string; body?: string }> = [];
    const adapter = new RAGAnythingAdapter({
      baseUrl: "http://raganything.local",
      processPath: "/parse",
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: init?.body as string | undefined });
        if (String(url).endsWith("/health")) return response({});
        return response({
          markdown: "# Report\n\nExtracted text",
          doc_id: "doc-1",
          metadata: { pages: 4 },
        });
      },
    });
    await adapter.init();
    const result = await adapter.processDocument({
      filePath: "D:/vault/attachments/report.pdf",
      sourcePath: "attachments/report.pdf",
      parser: "mineru",
    });
    assert.equal(result.markdown, "# Report\n\nExtracted text");
    assert.equal(result.metadata.docId, "doc-1");
    assert.equal(result.metadata.pages, 4);
    assert.equal(result.metadata.parser, "mineru");
    assert.equal(requests.some((r) => r.url === "http://raganything.local/parse"), true);
    const body = JSON.parse(requests.find((r) => r.url.endsWith("/parse"))?.body ?? "{}");
    assert.equal(body.file_path, "D:/vault/attachments/report.pdf");
    assert.equal(body.source_path, "attachments/report.pdf");
  });

  it("processDocument() can derive markdown from content_list", async () => {
    const adapter = new RAGAnythingAdapter({
      baseUrl: "http://raganything.local",
      fetchImpl: async (url) => {
        if (String(url).endsWith("/health")) return response({});
        return response({
          content_list: [
            { type: "text", page_idx: 1, text: "First paragraph" },
            { type: "equation", page_idx: 2, latex: "E=mc^2" },
          ],
        });
      },
    });
    await adapter.init();
    const result = await adapter.processDocument({ filePath: "D:/vault/a.pdf" });
    assert.match(result.markdown, /First paragraph/);
    assert.match(result.markdown, /E=mc\^2/);
    assert.equal(result.contentList?.length, 2);
  });

  it("search() returns [] when unavailable", async () => {
    const adapter = new RAGAnythingAdapter({
      baseUrl: "http://raganything.local",
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    await adapter.init();
    assert.equal(adapter.isAvailable, false);
    assert.deepEqual(await adapter.search("offline"), []);
  });
});
