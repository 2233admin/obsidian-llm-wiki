// Root ESLint v9 flat config. Each package extends via `root: true`.
// Run from root: `npm run lint` (after wiring in package.json).

import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import importPlugin from "eslint-plugin-import";

export default [
  // 1. Base JS recommended
  js.configs.recommended,

  // 2. Globals — ignore generated/dist/vendor/runtime caches
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.tsbuildinfo",
      "**/*.tsbuildinfo",
      "mcp-server/bundle.js",
      "mcp-server/agent-domain-cli.js",
      "mcp-server/memu-query.js",
      "mcp-server/usage-cli.js",
      "obsidian-plugin/main.js",
      "packages/*/dist/**",
      ".orca/imvt/scripts/**/__pycache__/**",
      ".vault-mind/**",
      ".repowise/**",
      ".gitnexus/**",
      ".planning/**",
      ".claude/**",
      "Components/", // legacy path; samples live in docs/samples/components/
      "vault/",
      "docs/samples/components/**/node_modules/**",
    ],
  },

  // 3. TypeScript — strict, type-aware rules
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: [
          "./mcp-server/tsconfig.json",
          "./obsidian-plugin/tsconfig.json",
          "./packages/*/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      import: importPlugin,
    },
    rules: {
      // TS strict rules
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      // Import hygiene
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/no-duplicates": "error",
      // JS baseline
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
    },
  },
];
