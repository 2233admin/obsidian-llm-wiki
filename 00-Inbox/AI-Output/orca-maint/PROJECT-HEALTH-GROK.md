# Project health (Grok scan)

Scan: local only (no `--fetch`). Generated: 2026-07-17.

## Project health counts

| metric | count |
|---|---:|
| total | 9 |
| ok | 1 |
| dirty | 5 |
| behind | 1 |
| ahead | 1 |
| missing | 0 |
| other | 1 (umbrella skip) |

Source report: `reports/PROJECT-HEALTH.md`

## Dirty / behind

| name | branch | dirty | behind |
|---|---|---:|---:|
| opencli-admin | feat/workflow-persistence-closed-loop | 2 | 0 |
| KATANAview | main | 3 | 0 |
| k-atana | master | 48 | 2 |
| code-intel-pipeline | main | 1 | 2 |
| memory-keeper | main | 3 | 0 |
| vault-mind | main | 0 | 13 |

Also: **obsidian-llm-wiki** clean but **ahead=1**; **tdxcli-rs** clean/ok.

## Needs you (from human board, top 8)

1. Session memory: 我知道 但是你用的因子太少了 → distill/closeout
2. Session memory: 你看下grok总结的MD 我们在对其下方向 → distill/closeout
3. Session memory: 优化并且改进我们的交易系统 → distill/closeout
4. Session memory: gitea 验证问题 (`git.xart.top:8088`) → distill/closeout
5. Session memory: skills maintenance agent run → distill/closeout
6. Session memory: 找bug / 挑毛病 / 推边界 → distill/closeout
7. Session memory: 下个session 优化代码 + TDXCLI 架构 → distill/closeout
8. Session memory: local-command-caveat session-tmp → distill/closeout

(Next board items after those: dirty trees opencli-admin / KATANAview / k-atana / code-intel-pipeline / memory-keeper; vault-mind behind=13.)

## Commands for user

- `python -m orca_maint projects` (ff-only pull clean trees)
- `python -m orca_maint resolve --target "..." --note "done"`

**Note:** invoke from `D:\projects\_tools\orca-maintenance` (or `python run.py ...`) so the package resolves.

No git reset / clean / force-push. Dirty trees left untouched.
