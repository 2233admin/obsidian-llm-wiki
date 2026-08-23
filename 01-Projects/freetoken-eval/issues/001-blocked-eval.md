---
llmwiki_type: issue
status: planned
project_id: "freetoken-eval"
labels: ["needs-info", "ready-for-agent"]
created_at: "2026-08-23T00:00:00.000Z"
updated_at: "2026-08-23T00:00:00.000Z"
actor: "codex"
depends_on: []
blocks: []
related_sources: ["src_freetoken_0ab982f10"]
related_knowledge_items:
  - "30-Architecture/freetoken-runtime-on-xr-3080.md"
  - "01-Projects/freetoken-eval/research/2026-08-23-cross-host-placement.md"
  - "01-Projects/freetoken-eval/research/2026-08-23-model-selection-and-quantization.md"
---

# 001 — FreeToken cold-start on xr-3080 is blocked

## Problem

The first cold-start of `ft serve` on `xr-3080` cannot run today because
the host has no provisioned disk and the dGPU is held by other services.

Concretely, on 2026-08-23:

1. The `xr-3080` primary system disk (`/`) is btrfs at 296 GiB with 6.5 GiB
   free. FreeToken runtime is already 1.2 GiB at `/opt/freetoken`. No
   checkpoint (model weight) and no HuggingFace cache (76 KiB today) has
   been written yet. Pulling any supported model weight into the residual
   6.5 GiB is not viable.
2. The "DATA" volume (`/dev/nvme2n1p2`, aigo NVMe SSD P7000E 4TB, label
   `DATA`) is a working Win11 data store: 99% used (3.7 TiB of 3.8 TiB)
   and only mounts read-only because the volume has Win-side hibernation
   or dirty flag. It is **not** a candidate for FreeToken runtime
   placement — this was re-confirmed after a one-time read-only probe.
3. `nvidia-smi` deadlocks on `xr-3080` reproducibly (≥ 300 s hang, three
   consecutive attempts); the dGPU is held by `nvidia-powerd.service` and
   two competing inference stacks: `ollama.service` (3 children)
   + `vllm/vllm-openai:v0.22.0` + `vllm/vllm-openai:unlimited-ocr` (~62 GiB
   on disk combined). Any new CUDA init on the same mutex will hang.
4. FreeToken-supplied runtime is fine — `ft serve --help` exits 0 and the
   argument surface matches the upstream CLI.

## Goal

Run a clean `ft serve` on `xr-3080` that loads a single FreeToken-supported
checkpoint and answers at least one chat turn, captured as evidence
(transcript + first-token / token-throughput metrics), without paying
hardware or data cost on the host.

## Acceptance Criteria

- [ ] A FreeToken-supported model weight is staged at workstation
  `Z:/models/freetoken/<id>/`, transferred to xr-3080 `/tmp/` exactly once
  via `scp`, never into the residual 6.5 GiB on `/`.
- [ ] Model choice: `Qwen/Qwen3-30B-A3B` (BF16 MoE, 30 B total / 3 B
  active) — see `research/2026-08-23-model-selection-and-quantization.md`.
- [ ] `nvidia-smi` returns within 5 s on `xr-3080` after B2 unblock.
- [ ] `ollama.service` and the two `vllm/vllm-openai:*` containers are
  intentionally stopped (decision logged).
- [ ] `ft serve --model-path /tmp/freetoken-models/Qwen3-30B-A3B --port 8080
  --moe-backend offload --dtype float16 --memory-ratio 0.85 --cache-type
  radix` boots and exits only when stopped. First-request latency
  captured.
- [ ] One chat completion is executed via `curl` to the served OpenAI-style
  endpoint; response recorded under `01-Projects/freetoken-eval/captures/`.
- [ ] No regression to the previous day's pacman cleanup; `pacman` cache
  size does not balloon back to > 1 GiB during the cold-start run.
- [ ] Note `30-Architecture/freetoken-runtime-on-xr-3080.md` is updated to
  the new fact sheet (or replaced with `002-cold-start.md`).

## Blockers

### B1 — No dedicated disk on `xr-3080`

| Smallest action | Cost | Reversible? |
|---|---|---|
| `btrfs balance start -dusage=80 -musage=80` on `/` | Free; recovers a few GiB at most; not enough for a model checkpoint | yes |
| Repartition `nvme2n1p2` while Win11 is offline | Loses the user data store unless migrated first | partially |
| Add an extra NVMe/SSD; repartition existing leftovers | Hardware cost | yes |
| Run cold-start on `katana-5090` instead | Cross-host; **5090 currently offline** (see research note) | yes |
| **Stage model on workstation `Z:` or `F:` and `scp -r` to xr-3080 `/tmp/freetoken-models/`** — chosen default | One-time network transfer (~tens of GiB over LAN) | yes; no permanent claim on 3080 disk |

### B2 — `nvidia-smi` deadlock

| Smallest action | Cost | Reversible? |
|---|---|---|
| `systemctl restart nvidia-powerd` and retry `nvidia-smi` | Service-cycle only | yes |
| `systemctl stop ollama && docker stop $(docker ps -q)` and retry | Loses long-running inference sessions; must coordinate with whoever relies on them | yes |
| Reboot `xr-3080` | Disruptive; clears NVIDIA UVM state cleanly | yes |

### B3 — DATA volume ro + Win user data store

The DATA volume must not be reformatted. Cleaning the dirty flag
(`ntfsfix -d /dev/nvme2n1p2`) only buys a writable mount but does not buy
any additional free space.

`needs-info`: confirm that filling 43 GiB of win-data-store with
FreeToken test artifacts is acceptable as a one-shot.

## Decision Required From Operator

- Confirm **B1 = workstation staging default** (`Z:/models/freetoken/…`).
- Pick one of the B2 paths.
- Confirm B3 default (don't touch DATA).

Once the three are answered, the issue can move from `needs-info` to
`ready-for-agent` and the runbook in §Runbook will execute.

## Research Questions

### Already Answered

- **Q1 answered (2026-08-23)** in
  `research/2026-08-23-model-selection-and-quantization.md`. No
  FreeToken-supported checkpoint fits a 10 GB GPU without MoE offload.
  Recommended: `Qwen/Qwen3-30B-A3B` (BF16 MoE, 30 B total / 3 B active)
  with `--moe-backend offload`. Alternative: `gemma-4-12B-it` via GGUF.
- **Q2 answered (2026-08-23)** in same research note. `--dtype` controls
  compute precision only, not quantization. FreeToken reads HF safetensors
  as-published. q4 path exists only for Gemma-4. Practical default
  `--dtype float16`.
- **Q3 answered (2026-08-23)** — see
  `research/2026-08-23-cross-host-placement.md`. Strategy A: workstation
  staging → `scp` to xr-3080 → `ft serve` on 3080.
- **Q4 answered (2026-08-23)** — `katana-5090` netbird FQDN
  (`au-5090-105-128.netbird.cloud`) is NXDOMAIN; not an option until the
  operator brings it online.

### Still Open

- **R1.1** — confirm `Qwen/Qwen3-30B-A3B` total repo size on HF. Likely
  50–70 GB (BF16). Needs outbound network from this workstation.
- **R1.2** — confirm `Qwen/Qwen3.6-27B-FP8` exists and repo size. Fallback.
- **R2.1** — does FreeToken's Gemma-4 GGUF path support `--moe-backend
  offload`? If yes, `google/gemma-4-12B-it` (BF16) and any Gemma-4
  q4 GGUF become plausible on 10 GB.
- **R2.2** — does FreeToken accept GPTQ/AWQ/AutoGPTQ safetensors produced
  externally? CLI does not expose a quantize flag; needs source dive.

## Runbook (To Execute Once Decisions Above Are Made)

```bash
# Step 0 — workstation staging (Strategy A)
# On workstation, pull the chosen model into Z:/models/freetoken/<id>/
huggingface-cli download Qwen/Qwen3-30B-A3B \
    --cache /mnt/z/Models/freetoken/Qwen3-30B-A3B    # or use WSL2 Arch

# Step 1 — single transfer to xr-3080
ssh xr-3080 'mkdir -p /tmp/freetoken-models'
scp -r /mnt/z/Models/freetoken/Qwen3-30B-A3B xr-3080:/tmp/freetoken-models/

# Step 2 — unblock nvidia-smi by stopping in inverse priority
ssh xr-3080 '
  systemctl stop ollama.service
  docker stop 6836a36a8b5a    # vllm-openai
  docker stop $(docker ps -q --filter ancestor=vllm/vllm-openai:unlimited-ocr)
  systemctl restart nvidia-powerd.service
'
ssh xr-3080 'timeout 5 nvidia-smi'   # expect <5s return

# Step 3 — first cold start
ssh xr-3080 '
  source /opt/freetoken/bin/activate
  ft serve \
    --model-path /tmp/freetoken-models/Qwen3-30B-A3B \
    --port 8080 \
    --dtype float16 \
    --moe-backend offload \
    --memory-ratio 0.85 \
    --cache-type radix \
    --tool-call-parser auto \
    --sampling-defaults model
' &

# Step 4 — capture
curl -sS http://xr-3080:8080/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"Qwen3-30B-A3B","messages":[{"role":"user","content":"Hello"}]}' \
  | tee 01-Projects/freetoken-eval/captures/001-cold-start.json
```

## Evidence

- Note: `30-Architecture/freetoken-runtime-on-xr-3080.md`
- Research Q1/Q2: `01-Projects/freetoken-eval/research/2026-08-23-model-selection-and-quantization.md`
- Research Q3/Q4 (cross-host): `01-Projects/freetoken-eval/research/2026-08-23-cross-host-placement.md`
- Capture snapshots: none yet (cold-start runbook not executed).
- Reproduction transcript (deadlock): `nvidia-smi` was issued three times
  on 2026-08-23 from a fresh SSH session; each call did not return within
  300 s. A separate SSH session running `ls /proc/driver/nvidia/` returned
  immediately, ruling out ssh-layer stalls.

## Related Items

- Source: `src_freetoken_0ab982f10` (upstream anchor)
- Architecture note: `30-Architecture/freetoken-runtime-on-xr-3080.md`
- Cross-host research: `01-Projects/freetoken-eval/research/2026-08-23-cross-host-placement.md`
- Model/quantization research: `01-Projects/freetoken-eval/research/2026-08-23-model-selection-and-quantization.md`
- Triage label mapping: `docs/agents/triage-labels.md`
