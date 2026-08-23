---
llmwiki_type: analysis
status: analyzed
project_id: "freetoken-eval"
created_at: "2026-08-23T00:00:00.000Z"
updated_at: "2026-08-23T00:00:00.000Z"
actor: "codex"
related_sources: ["src_freetoken_0ab982f10"]
related_issues: ["001-blocked-eval"]
related_knowledge_items: ["30-Architecture/freetoken-runtime-on-xr-3080.md"]
tags: ["research", "cross-host", "sshfs", "rsync", "storage", "freetoken-eval"]
---

# Research: FreeToken cross-host placement (Workstation ↔ xr-3080)

Captured 2026-08-23 in answer to research question 3 in
`01-Projects/freetoken-eval/issues/001-blocked-eval.md`. This note
records the host-side facts and the comparison of placement strategies
without changing any host state.

## 0. Constraint Recap

`xr-3080` has **no dedicated disk** for FreeToken runtime + checkpoint
+ HuggingFace cache. The on-host capture is in
`30-Architecture/freetoken-runtime-on-xr-3080.md`. The only disk with
>= 30 GiB of headroom is the btrfs `/` with 6.5 GiB free, which is not
enough for any FreeToken-supported checkpoint.

## 1. Workstation inventory

`192.168.50.53` is the workstation (CN-Qingdao). Local disks:

| Mount | Size | Used | Free | Use% | Role today |
|---|---|---|---|---|---|
| `C:` | 1.9 TiB | 1.9 TiB | 61 GiB | 97% | Git/MSYS root (irrelevant) |
| `D:` | 7.0 TiB | 6.8 TiB | 259 GiB | 97% | user data |
| `E:` | 3.7 TiB | 3.5 TiB | 146 GiB | 97% | user data |
| `F:` | 7.0 TiB | 5.3 TiB | **1.7 TiB** | 76% | user data; **`F:/AI/` already populated** |
| `Z:` | 16 TiB | 12 TiB | **4.2 TiB** | 74% | NAS / large store; **`Z:/models/` already populated** |

The two clearly-suitable FreeToken-as-model-warehouse candidates are
**`F:`** (because `F:/AI/` is the existing model cache) and **`Z:`**
(because there is already a `Z:/models/` directory). Both are NTFS
volumes on Windows.

Existing `Z:/models/` looks like a hand-curated model library. The
recent `Z:/knowledge/` and `Z:/llmwikiobsdina/` directories suggest the
workstation has been pre-staged for LLM Wiki work. **This is the disk
to use for FreeToken model staging.**

## 2. Existing Local Sandbox

- WSL2 distros available: `Ubuntu-24.04` (Stopped), `Arch` (Running).
  The `Arch` instance could host a FreeToken install mirroring the
  `xr-3080` install, but the immediate question is model placement, not
  runtime placement.
- Docker Desktop is running and serving the workstation (one of the
  reasons the ARC and `docker-desktop` data root live alongside the WSL2
  distros).
- `sshfs` is **not** installed on the workstation shell. Falling back to
  `scp`/`rsync` over SSH is the next-best portable option. The WSL2
  distros almost certainly have `sshfs` available; if cross-host mount
  becomes essential, install there.

## 3. 5090 Status

- DNS `au-5090-105-128.netbird.cloud` did not resolve at capture time
  (netbird hosts file lookup returned NXDOMAIN).
- NetBird peers list shows `2/38 Connected`. We can deduce that 5090 is
  not in the active peer set at this moment.
- `~/.ssh/config` only stores a single 5090 entry (`katana-5090`); no
  alternate IP / direct LAN alias is configured.

**5090 is offline relative to this session.** The "warm spare" plan
originally sketched in `001-blocked-eval.md` (B1 cross-host option:
"Run cold-start on `katana-5090` instead") is currently not actionable.
We must work without 5090 or schedule a follow-up once it is online.

## 4. Cross-Host Strategy Comparison

### A. Pull model to workstation → rsync/scp to xr-3080 → `ft serve` on xr-3080

- Where the model lives: `Z:/models/freetoken/<model-id>/` (or `F:/AI/`)
  on the workstation.
- Transport: `scp -r` over the existing SSH config (LAN, <1 ms to
  `192.168.50.38`).
- On xr-3080 the model goes into `/tmp/freetoken-models/<model-id>/` for
  the demonstration; nothing on disk is permanently claimed.
- Cost: ~30–60 GiB transfer per chosen checkpoint. Reusable across runs.
- Pros: zero additional disk setup on xr-3080; FreeToken runtime is
  already in `/opt/freetoken`; only the runtime argument `--model-path`
  changes.
- Cons: a real production run needs persistence, which means
  repeating the transfer or persisting on the workstation forever.

### B. WSL2 (Arch) runs FreeToken itself, xr-3080 is irrelevant

- Where the model lives: `Z:/models/freetoken/<model-id>/` accessed
  from the WSL2 distro via `/mnt/z/...`.
- Transport: none — same host as the model.
- Pros: no GPU contention from xr-3080 services; workstation WSL2 GPU
  (if NVIDIA driver + WSL CUDA passthrough enabled) is the runtime.
- Cons:
  - Requires installing FreeToken into the WSL2 Arch (no install
    exists today; would have to mirror the `/opt/freetoken` pyvenv).
  - WSL2 GPU passthrough is not verified on this Windows host (no
    evidence captured today).
  - Reproduces the FreeToken install decisions separately on WSL2 —
    drift risk.

### C. Use weights already present on xr-3080

- `AI-Models` (23 GiB) and `BaiduNetdiskDownload` (1.4 TiB) are the only
  sizable data sets on xr-3080 outside the system. We have not opened
  them; whether any are FreeToken-compatible is unknown.
- Pros: zero model-download cost.
- Cons: format/likeness risk; opening user data is a separate decision.

### D. rsync/sshfs Live mount from workstation to xr-3080

- Same model location as A, but mount live instead of copying.
- Pros: no duplicate storage; one source of truth.
- Cons:
  - `sshfs` is not installed on workstation; would need to be set up in
    WSL2 for the demo.
  - On xr-3080, fuse + sshfs would also need to be installed (likely
    is, but unverified).
  - Live-mount of an NTFS source means read latency from xr-3080
    includes NTFS ACL / granularity overhead. Acceptable for one-time
    inference but adds ~5–15% cold-start lag.

## 5. Recommendation

**Strategy A is the immediate path of least resistance** given the
current state of the 5090 host and the model support in FreeToken. We
should:

1. Decide on a FreeToken-supported model family whose smallest
   checkpoint fits inside 6.5 GiB residual on the workstation or a
   `scp` transfer that the operator is willing to do exactly once.
2. Land the workstation-side staging directory:
   `Z:/models/freetoken/<model-id>/` (or `$F:/AI/<model-id>/`).
3. Pull the model with `huggingface-cli download` from the workstation
   (Linux side: `bash.exe` -> WSL2 -> python venv).
4. `scp -r` to xr-3080 `/tmp/freetoken-models/`. Single transfer, no
   disk pressure on xr-3080.
5. Then call the existing `001-blocked-eval.md` runbook Step 4 with
   `--model-path /tmp/freetoken-models/<model-id>`. All other rules
   (B1/B2/B3 decisions, nvidia-smi, ollama/vllm stop) still apply.

Strategy B is a stronger long-term answer for production runs but
isn't actionable today without first installing FreeToken in WSL2.
Strategy D is best saved for second iteration once Strategy A has
proven out the model-selection question.

## 6. Follow-Up Question For Next Session

- **Which FreeToken-supported model is the smallest GGUF / BF16 we can
  ship?** This is research question 1 in `001-blocked-eval.md` and
  prerequisite for executing A above.
- Confirm whether the operator wants staging under `Z:/models/freetoken/`
  (NAS, broad visibility) or `F:/AI/freetoken/` (existing AI cache, more
  curated).
