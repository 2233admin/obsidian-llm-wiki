import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { makeReceipt, TOOLCHAIN_PROFILES } from "./compatibility.js";
import { HttpToolchainProbe } from "./http-probes.js";

const fixtures = JSON.parse(readFileSync(
  new URL("./fixtures/http-probe-cases.json", import.meta.url),
  "utf8",
)) as Record<string, unknown>;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("side-effect-free HTTP toolchain probes", () => {
  it("probes Ollama/OpenAI-compatible models without embedding or retaining endpoints/secrets", async () => {
    const calls: Array<{ url: string; method?: string; authorization?: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method, authorization: new Headers(init?.headers).get("authorization") ?? undefined });
      return url.endsWith("/api/version")
        ? response(fixtures.ollamaVersion)
        : response(fixtures.ollamaModels);
    };
    const probe = new HttpToolchainProbe({
      ollama: {
        endpoint: "https://user:pass@private.example.test",
        apiKey: "sk-test-secret",
        embeddingModel: "qwen3-embedding:0.6b",
        modelFingerprint: "sha256:qwen3",
      },
    }, fetchImpl);
    const observation = await probe.observe(TOOLCHAIN_PROFILES.ollama[0]);
    assert.deepEqual(calls.map(call => call.method), ["GET", "GET"]);
    assert.ok(calls.every(call => call.authorization === "Bearer sk-test-secret"));
    assert.ok(observation.capabilities?.includes("model.fingerprint"));
    const receipt = makeReceipt(TOOLCHAIN_PROFILES.ollama[0], observation, new Date("2026-07-23T00:00:00Z"), 60_000);
    assert.equal(receipt.health, "available");
    assert.equal(JSON.stringify(receipt).includes("private.example.test"), false);
    assert.equal(JSON.stringify(receipt).includes("sk-test-secret"), false);
  });

  it("maps missing embedding models to partial capability", async () => {
    const probe = new HttpToolchainProbe({
      ollama: { endpoint: "http://localhost:11434", embeddingModel: "missing", versionPath: false, observedVersion: "0.12.4" },
    }, async () => response(fixtures.ollamaModels));
    const observation = await probe.observe(TOOLCHAIN_PROFILES.ollama[0]);
    const receipt = makeReceipt(TOOLCHAIN_PROFILES.ollama[0], observation, new Date(), 1);
    assert.equal(receipt.health, "degraded");
    assert.ok(receipt.diagnosticCodes.includes("EMBEDDING_MODEL_MISSING"));
    assert.ok(receipt.missingCapabilities.includes("model.fingerprint"));
  });

  it("normalizes LightRAG success and RAG-Anything partial wrapper capabilities", async () => {
    const fetchImpl: typeof fetch = async (input) => String(input).includes("lightrag")
      ? response(fixtures.lightRagHealth)
      : response(fixtures.ragAnythingPartial);
    const probe = new HttpToolchainProbe({
      lightrag: { endpoint: "http://lightrag.local" },
      raganything: { endpoint: "http://raganything.local" },
    }, fetchImpl);
    const light = makeReceipt(TOOLCHAIN_PROFILES.lightrag[0], await probe.observe(TOOLCHAIN_PROFILES.lightrag[0]), new Date(), 1);
    const rag = makeReceipt(TOOLCHAIN_PROFILES.raganything[0], await probe.observe(TOOLCHAIN_PROFILES.raganything[0]), new Date(), 1);
    assert.equal(light.health, "available");
    assert.equal(rag.health, "degraded");
    assert.ok(rag.missingCapabilities.includes("query"));
    assert.equal(JSON.stringify(rag).includes("sk-test-secret"), false);
  });

  it("bounds timeouts and returns stable diagnostics", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    const probe = new HttpToolchainProbe({ lightrag: { endpoint: "http://timeout.local", timeoutMs: 5 } }, fetchImpl);
    const observation = await probe.observe(TOOLCHAIN_PROFILES.lightrag[0]);
    assert.equal(observation.timedOut, true);
    assert.ok(observation.diagnosticCodes?.includes("TOOLCHAIN_PROBE_TIMEOUT"));
  });
});
