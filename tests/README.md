# Tests

## Running

After `npm install`, run the full test suite with:

```
npm test
```

To watch for changes during development:

```
npx vitest
```

Tests live in `tests/*.test.ts`. The runner is Vitest with no separate compile step -- it transforms TypeScript directly via esbuild.

## Mocking strategy

Every `bridge.ts` method operates on Obsidian's `App`, `Vault`, and `MetadataCache` objects. Because Obsidian only exists as a runtime inside the Obsidian Electron app, tests cannot import the real package for behaviour -- only for types.

The mock lives in `tests/mocks/obsidian.ts` and is injected via a `resolve.alias` in `vitest.config.ts` so that `import { App, TFile } from "obsidian"` transparently resolves to the mock in test context without touching the production esbuild bundle.

Critical design constraint: `bridge.ts` uses `instanceof TFile` and `instanceof TFolder` checks. The mock therefore defines real ES6 classes (not plain objects or interfaces) so that `instanceof` comparisons succeed. `MockVault` is seeded via a `Record<path, content>` constructor argument to keep test setup declarative.

## Prior art

Mocking pattern (alias-based obsidian stub + real class hierarchy) is consistent with the approach used in `iansinnott/obsidian-claude-code-mcp`. That plugin uses a similar `__mocks__/obsidian.ts` + jest `moduleNameMapper`; this repo uses Vitest's `resolve.alias` which is the direct equivalent.
