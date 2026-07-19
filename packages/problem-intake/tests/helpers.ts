import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ProblemReport } from "../src/index.js";

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");
}

export function reportFixture(): ProblemReport {
  return JSON.parse(fixture("obc-broken-link.report.json")) as ProblemReport;
}
