import registryDocument from "../registry/v1.json" with { type: "json" };

import { deepClone } from "./canonical.js";
import { parseRegistry } from "./registry.js";
import type { SettingsRegistry } from "./types.js";

const registry = parseRegistry(registryDocument);

/** Registry copy embedded into bundles so headless hosts need no sidecar file. */
export function bundledRegistry(): SettingsRegistry {
  return deepClone(registry);
}
