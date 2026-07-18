import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { MindMapDocument } from "../src/index.js";

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

export function documentFixture(name = "basic.document.json"): MindMapDocument {
  return JSON.parse(fixture(name)) as MindMapDocument;
}
