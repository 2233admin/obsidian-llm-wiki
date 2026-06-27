---
entity: k-atana/stale-demo
type: fact
source: path:research/raw/iii-spec.md
last-verified: 2026-05-01
status: reviewed
---

一个依赖已变更源文件的事实。

Seed #4. type=fact -> 90d threshold, last-verified 2026-05-01 is well within
that window, so this is NOT stale by age. It IS stale because its source file
(research/raw/iii-spec.md) changed after last-verified -- _meta.json records an
old hash that no longer matches the file. Task 2 must mark this STALE via the
source-hash signal alone, independent of the age threshold.
