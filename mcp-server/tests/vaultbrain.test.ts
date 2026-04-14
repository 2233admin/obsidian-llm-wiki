import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultBrainAdapter } from "../src/adapters/vaultbrain/index.js";
import type { ChunkResult, VaultBrainEngine } from "../src/adapters/vaultbrain/engine.js";
import { chunkMarkdown, embedTexts } from "../src/adapters/vaultbrain/ingest.js";

const originalApiKey = process.env.OPENAI_API_KEY;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  globalThis.fetch = originalFetch;
});

describe("chunkMarkdown", () => {
  it("returns [] for empty string", () => {
    expect(chunkMarkdown("")).toEqual([]);
  });

  it("returns a single short paragraph", () => {
    expect(chunkMarkdown("A short paragraph.")).toEqual(["A short paragraph."]);
  });

  it("merges two short paragraphs when combined fits maxTokens", () => {
    expect(chunkMarkdown("First paragraph.\n\nSecond paragraph.", 20, 0)).toEqual([
      "First paragraph.\n\nSecond paragraph.",
    ]);
  });

  it("splits oversized paragraphs by sentence and hard-split", () => {
    const content = `${"a".repeat(45)}. ${"b".repeat(45)}. ${"c".repeat(90)}`;
    const chunks = chunkMarkdown(content, 10, 0);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.length <= 40)).toBe(true);
  });

  it("adds overlap from the tail of the previous chunk", () => {
    const chunks = chunkMarkdown(`${"a".repeat(20)}\n\n${"b".repeat(20)}`, 5, 2);
    expect(chunks).toHaveLength(2);
    expect(chunks[1].startsWith("a".repeat(8))).toBe(true);
  });

  it("returns [] for whitespace-only content", () => {
    expect(chunkMarkdown(" \n\t\n ")).toEqual([]);
  });
});

describe("embedTexts", () => {
  it("returns [] when OPENAI_API_KEY is not set", async () => {
    delete process.env.OPENAI_API_KEY;
    expect(await embedTexts(["hello"])).toEqual([]);
  });

  it("returns [] for empty input", async () => {
    expect(await embedTexts([])).toEqual([]);
  });
});

describe("VaultBrainAdapter", () => {
  let dataDir: string;
  let adapter: VaultBrainAdapter;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "vb-test-"));
    adapter = new VaultBrainAdapter(dataDir);
    await adapter.init();
  });

  afterEach(async () => {
    await adapter.dispose();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("init succeeds and search returns [] without throwing", async () => {
    await expect(adapter.search("anything")).resolves.toEqual([]);
  });

  it("search with no data returns []", async () => {
    expect(await adapter.search("empty")).toEqual([]);
  });

  it("ingest then search returns keyword results", async () => {
    await adapter.ingest("notes/quantum.md", "# Quantum\n\nQuantum flux resonance notes.");
    const results = await adapter.search("Quantum flux resonance notes");
    expect(results.some((result) => result.path === "notes/quantum")).toBe(true);
  });

  it("ingesting the same path twice does not duplicate chunks", async () => {
    await adapter.ingest("notes/repeat.md", "# Repeat\n\nRepeatable keyword content.");
    await adapter.ingest("notes/repeat.md", "# Repeat\n\nRepeatable keyword content updated.");
    const results = await adapter.search("Repeatable keyword content updated", { maxResults: 10 });
    expect(results.filter((result) => result.path === "notes/repeat")).toHaveLength(1);
  });

  it("dispose makes search return []", async () => {
    await adapter.dispose();
    expect(await adapter.search("anything")).toEqual([]);
  });
});

describe("VaultBrainAdapter RRF fusion", () => {
  it("combines keyword and vector scores, sorts descending, and respects limit", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    }), { status: 200 })) as typeof fetch;

    const adapter = new VaultBrainAdapter(":memory:");
    const engine: VaultBrainEngine = {
      connect: async () => {},
      disconnect: async () => {},
      initSchema: async () => {},
      upsertPage: async () => {},
      deletePage: async () => {},
      upsertChunks: async () => {},
      deleteChunks: async () => {},
      searchKeyword: async (): Promise<ChunkResult[]> => [
        { slug: "a", chunkIndex: 0, chunkText: "shared", score: 0.9 },
        { slug: "b", chunkIndex: 0, chunkText: "keyword", score: 0.8 },
      ],
      searchVector: async (): Promise<ChunkResult[]> => [
        { slug: "a", chunkIndex: 0, chunkText: "shared", score: 0.7 },
        { slug: "c", chunkIndex: 0, chunkText: "vector", score: 0.6 },
      ],
      upsertLink: async () => {},
      upsertTag: async () => {},
    };
    (adapter as unknown as { engine: VaultBrainEngine }).engine = engine;

    const results = await adapter.search("shared", { maxResults: 2 });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ path: "a", score: 1 / 30 });
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});
