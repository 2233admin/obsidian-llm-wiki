# fixture: vault-iii

The iii-pivot acceptance vault for the currency layer (anti-drift). All currency
tests run against this fixture; never against a real vault.

Layout follows the real vault-mind conventions:

```
vault-iii/                                  <- vault root
  00-Inbox/AI-Output/test-agent/
    iii-done.md                             <- seed #2 (unreviewed, supersedes #1)
  research/                                 <- a topic (<vault>/<topic>/{raw,wiki,_meta.json})
    raw/iii-spec.md                         <- source file for seed #4 (edited since verify)
    wiki/entities/
      iii.md                                <- seed #1 (reviewed old truth)
      unsupported-demo.md                   <- seed #3 (empty source -> UNSUPPORTED)
      stale-demo.md                         <- seed #4 (source changed -> STALE)
    _meta.json                              <- records an old hash for raw/iii-spec.md
```

## Seeds and their expected Task 2 verdicts

| # | file | entity | type | source | last-verified | status | expected after compile |
|---|------|--------|------|--------|---------------|--------|------------------------|
| 1 | research/wiki/entities/iii.md | k-atana/iii | decision | commit:OLD1234 | 2026-03-26 | reviewed | SUPERSEDED, appended to supersession log |
| 2 | 00-Inbox/AI-Output/test-agent/iii-done.md | k-atana/iii | decision | commit:NEW5678 | 2026-06-24 | draft | current-truth for k-atana/iii = "已完成" |
| 3 | research/wiki/entities/unsupported-demo.md | k-atana/unsupported-demo | note | (empty) | 2026-06-20 | draft | UNSUPPORTED |
| 4 | research/wiki/entities/stale-demo.md | k-atana/stale-demo | fact | path:research/raw/iii-spec.md | 2026-05-01 | reviewed | STALE (source hash changed, not by age) |

## Schema decisions (build-on-existing, see docs/ai-output-convention.md)

- Review state reuses the existing `status` field: `draft` == unreviewed,
  `reviewed` == human-vetted. No new `status: unreviewed|reviewed` vocabulary.
- `stale` / `superseded` are existing `status` values; Task 2 surfaces them in
  the derived current-truth view + log, it does not rewrite source notes.
- Five new fields layer on top: `entity`, `type`, `source`, `last-verified`,
  `supersedes` (kebab-case, matching the AI-Output schema).
- `_meta.json` records `raw/iii-spec.md` with a placeholder old hash
  (`deadbeefdeadbeef`); the real file content differs, so `kb_meta diff`
  reports it changed -- the deterministic STALE signal for seed #4.
