/**
 * Test B: VaultBridge business logic
 *
 * Instantiates VaultBridge against MockApp (no real Obsidian runtime).
 * Verifies:
 *   1. exists() returns true/false based on seeded files
 *   2. search() finds correct files and line numbers
 *   3. search() with case-insensitive flag hits both cases
 *   4. read() returns seeded content
 *   5. getVaultName() returns mock vault name
 */

import { describe, it, expect, beforeEach } from "vitest";
import { VaultBridge } from "../src/bridge";
import { MockApp } from "./mocks/obsidian";

// Seed: three markdown files with known content
const SEED: Record<string, string> = {
  "note1.md": "foo bar baz\nsecond line\nthird line",
  "note2.md": "baz foo\nonly one match",
  "note3.md": "nothing relevant here",
};

let app: MockApp;
let bridge: VaultBridge;

beforeEach(() => {
  app = new MockApp(SEED);
  // VaultBridge accepts App -- MockApp satisfies the interface at runtime
  // because only the methods actually called are needed (duck typing via mock).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bridge = new VaultBridge(app as any);
});

describe("VaultBridge.exists", () => {
  it("returns true for a seeded file", () => {
    expect(bridge.exists("note1.md")).toBe(true);
  });

  it("returns false for a path not in the vault", () => {
    expect(bridge.exists("does-not-exist.md")).toBe(false);
  });
});

describe("VaultBridge.getVaultName", () => {
  it("returns the mock vault name", () => {
    expect(bridge.getVaultName()).toBe("test-vault");
  });
});

describe("VaultBridge.read", () => {
  it("returns the full content of a seeded file", async () => {
    const content = await bridge.read("note1.md");
    expect(content).toBe(SEED["note1.md"]);
  });

  it("throws when the file does not exist", async () => {
    await expect(bridge.read("missing.md")).rejects.toThrow("File not found");
  });
});

describe("VaultBridge.search", () => {
  it("finds 'foo' in note1.md and note2.md, not in note3.md", async () => {
    const { results, totalMatches } = await bridge.search("foo");
    const paths = results.map((r) => r.path).sort();
    expect(paths).toEqual(["note1.md", "note2.md"]);
    // note1 has "foo" on line 1; note2 has "foo" on line 1 -- 2 matches total
    expect(totalMatches).toBe(2);
  });

  it("returns correct line numbers for matches", async () => {
    const { results } = await bridge.search("foo");
    const note1 = results.find((r) => r.path === "note1.md");
    expect(note1).toBeDefined();
    // "foo bar baz" is line 1
    expect(note1!.matches[0].line).toBe(1);
    expect(note1!.matches[0].text).toBe("foo bar baz");
  });

  it("returns empty results when query matches nothing", async () => {
    const { results, totalMatches } = await bridge.search("zzz-no-match");
    expect(results).toHaveLength(0);
    expect(totalMatches).toBe(0);
  });

  it("is case-insensitive by default (finds 'FOO' in lowercase content)", async () => {
    const { results } = await bridge.search("FOO");
    // caseSensitive defaults to false, so "FOO" matches "foo"
    expect(results.length).toBeGreaterThan(0);
  });

  it("respects caseSensitive:true -- does not match wrong case", async () => {
    const { results } = await bridge.search("FOO", { caseSensitive: true });
    // Content is all lowercase "foo", so "FOO" with case sensitivity -> no match
    expect(results).toHaveLength(0);
  });

  it("respects maxResults limit", async () => {
    // "foo" matches 2 lines across files; maxResults:1 should return 1
    const { totalMatches } = await bridge.search("foo", { maxResults: 1 });
    expect(totalMatches).toBe(1);
  });
});
