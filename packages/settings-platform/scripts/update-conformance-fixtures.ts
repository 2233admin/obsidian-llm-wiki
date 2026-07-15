import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadRegistry, resolveSettings } from "../src/index.js";

const registryPath = fileURLToPath(new URL("../registry/v1.json", import.meta.url));
const fixturePath = fileURLToPath(new URL("../fixtures/conformance/full-precedence.json", import.meta.url));
const outputPath = fileURLToPath(new URL("../fixtures/expected/full-precedence.snapshot.json", import.meta.url));

const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const snapshot = resolveSettings({ registry: loadRegistry(registryPath), ...fixture });
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

process.stdout.write(`updated ${outputPath}\n`);
