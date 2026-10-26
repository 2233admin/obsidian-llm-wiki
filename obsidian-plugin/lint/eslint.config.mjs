// Obsidian's official plugin guideline rules (eslint-plugin-obsidianmd — the
// rule set the community-plugin review applies), run over the plugin source.
//
// Kept in its own workspace (lint/) with its own TypeScript because
// typescript-eslint requires TypeScript < 6.1 while the plugin itself builds
// with TypeScript 7. General code-quality linting stays the job of the repo's
// root ESLint config; here we only enforce the Obsidian-specific rules, so the
// bundled typescript-eslint type-checked rules are turned off below.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Product nouns that are capitalised on purpose (see CONTEXT.md). The Obsidian
// sentence-case rule treats these as proper nouns instead of flagging them.
const BRANDS = [
  "LLM Wiki", "Obsidian", "Doctor", "Graphify", "Markdown", "Canvas",
  "Settings Platform", "Ask Mate", "Capability Library", "Inbox", "Claude", "Codex",
  "Cursor", "Windsurf", "Copilot", "PostgreSQL",
];

// Technical acronyms the sentence-case rule must not down-case.
const ACRONYMS = ["OS", "AI", "ID", "UI", "URL", "JSON", "YAML", "MCP", "USD", "API"];

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: { project: resolve(pluginRoot, "tsconfig.json"), tsconfigRootDir: pluginRoot },
    },
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", { brands: BRANDS, acronyms: ACRONYMS }],
      // Governed by the repo's root ESLint config, not an Obsidian guideline.
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-deprecated": "off",
    },
  },
]);
