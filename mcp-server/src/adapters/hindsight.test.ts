import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HindsightAdapter } from "./hindsight.js";

function response(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("HindsightAdapter", () => {
  it("degrades without configuration and never probes the network during init", async () => {
    let calls = 0;
    const adapter = new HindsightAdapter({
      fetchImpl: async () => {
        calls += 1;
        return response([]);
      },
    });

    await adapter.init();

    assert.equal(adapter.isAvailable, false);
    assert.deepEqual(await adapter.search("project history"), []);
    assert.equal(calls, 0);
  });

  it("calls only the official recall route and maps results without becoming memory authority", async () => {
    const requests: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    const adapter = new HindsightAdapter({
      baseUrl: "http://hindsight.local/",
      bankId: "project bank",
      timeoutMs: 1_000,
      apiKey: "device-only-secret",
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          body: String(init?.body),
          headers: init?.headers as Record<string, string>,
        });
        return response({
          results: [{
            id: "memory-1",
            text: "The deployment uses an explicit rollback gate.",
            scores: { final: 0.92 },
            created_at: "2026-07-15T00:00:00Z",
            metadata: { authorization: "Bearer reflected-secret" },
          }],
        });
      },
    });

    await adapter.init();
    const results = await adapter.search("rollback", { maxResults: 3 });

    assert.equal(adapter.isAvailable, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.url, "http://hindsight.local/v1/default/banks/project%20bank/memories/recall");
    assert.deepEqual(JSON.parse(requests[0]!.body), { query: "rollback" });
    assert.equal(requests[0]!.headers.Authorization, "Bearer device-only-secret");
    assert.equal(results[0]?.source, "hindsight");
    assert.equal(results[0]?.path, "hindsight/project%20bank/memory-1");
    assert.equal(results[0]?.score, 0.92);
    assert.equal(results[0]?.metadata?.authority, "external-read-only");
    assert.equal(JSON.stringify(results).includes("reflected-secret"), false);
  });

  it("returns an empty result on timeout or remote failure without reading remote error text", async () => {
    let errorTextRead = false;
    const failed = new HindsightAdapter({
      baseUrl: "https://hindsight.example",
      bankId: "default",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        text: async () => {
          errorTextRead = true;
          return "Bearer device-only-secret";
        },
      }) as Response,
    });
    await failed.init();
    assert.deepEqual(await failed.search("query"), []);
    assert.equal(errorTextRead, false);

    const timedOut = new HindsightAdapter({
      baseUrl: "https://hindsight.example",
      bankId: "default",
      timeoutMs: 5,
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    });
    await timedOut.init();
    assert.deepEqual(await timedOut.search("query"), []);
  });
});
