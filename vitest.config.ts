// Vitest chosen: zero-config TS support via esbuild transform, no separate compile step,
// and alias resolution lets us intercept `import ... from "obsidian"` without touching esbuild.config.mjs.
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Redirect Obsidian API imports to our minimal test mock.
      obsidian: path.resolve(__dirname, "tests/mocks/obsidian.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 5000,
  },
});
