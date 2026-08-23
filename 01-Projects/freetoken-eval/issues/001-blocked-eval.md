---
llmwiki_type: issue
status: ready-for-agent
project_id: "freetoken-eval"
labels: ["ready-for-agent"]
created_at: "2026-08-23T00:00:00.000Z"
updated_at: "2026-08-23T00:00:00.000Z"
actor: "codex"
depends_on:
  - "01-Projects/freetoken-eval/research/2026-08-23-r11-real-weights.md"
blocks: []
related_sources: ["src_freetoken_0ab982f10"]
related_knowledge_items:
  - "30-Architecture/freetoken-runtime-on-xr-3080.md"
  - "01-Projects/freetoken-eval/research/2026-08-23-cross-host-placement.md"
  - "01-Projects/freetoken-eval/research/2026-08-23-model-selection-and-quantization.md"
  - "01-Projects/freetoken-eval/research/2026-08-23-r11-real-weights.md"
---

# 001 — FreeToken cold-start on xr-3080 — ready, awaiting B2 + DATADIR decision

## Status

**Ready-for-agent.** Research closure confirmed model choice, sizes,
host-RAM/VRAM budget. The remaining blockers are operator decisions:

- B2: which `nvidia-smi` unblock path
- `DATADIR`: workstation staging location (Z: vs F: vs other)

All three B1 default options (Strategy A workstation staging) require
no extra research. The Runbook in §Runbook is reproducible end-to-end
provided the operator answers B2 and `DATADIR`.

## Problem

The first cold-start of `ft serve` on `xr-3080` cannot run today because
the host has no provisioned disk and the dGPU is held by other services.
Captured 2026-08-23, see `30-Architecture/freetoken-runtime-on-xr-3080.md`
for the full host fact sheet.

## Goal

Run a clean `ft serve` on `xr-3080` that loads `Qwen/Qwen3-30B-A3B` and
answers at least one chat turn; capture as evidence under
`01-Projects/freetoken-eval/captures/`. Zero permanent disk claim on
3080; one workstation staging directory; one `scp`; one `docker stop`
or `systemctl stop`; one restart of `nvidia-powerd.service`.

## Acceptance Criteria

- [ ] Model weight staged at workstation `${DATADIR}/freetoken/Qwen3-30B-A3B/`
  (operator picks DATADIR; default `Z:/models/`). Total 56.87 GiB.
- [ ] Single `scp -r` from workstation to xr-3080
  `/tmp/freetoken-models/Qwen3-30B-A3B/`; transfer completes within
  30 min over LAN.
- [ ] `nvidia-smi` returns within 5 s on xr-3080 after B2 unblock.
- [ ] `ollama.service` and the two `vllm/vllm-openai:*` containers are
  intentionally stopped; reason and trade-off captured.
- [ ] `ft serve --model-path /tmp/freetoken-models/Qwen3-30B-A3B --port 8080
  --model-source modelscope --dtype float16 --moe-backend offload
  --memory-ratio 0.85 --cache-type radix` boots and exits only when
  stopped.
- [ ] First-request latency captured (`< 30 s` once first expert-batch
  is staged, given PCIe bandwidth).
- [ ] One chat completion executed via `curl` to the served OpenAI-style
  endpoint; response saved as
  `01-Projects/freetoken-eval/captures/001-cold-start.json`.
- [ ] No regression to the prior pacman cleanup; `pacman` cache size
  remains < 1 GiB.
- [ ] `30-Architecture/freetoken-runtime-on-xr-3080.md` is updated or
  replaced with `002-cold-start.md`.

## Blockers

### B1 — No dedicated disk on `xr-3080`

**Default: Strategy A** (workstation staging → `scp` to xr-3080
`/tmp/freetoken-models/`). Single-transfer, one `scp`, no permanent
claim on 3080 disk. Reversible by removing `/tmp/freetoken-models/`.

### B2 — `nvidia-smi` deadlock (DECISION REQUIRED)

| Smallest action | Cost | Reversible? |
|---|---|---|
| `systemctl restart nvidia-powerd` and retry `nvidia-smi` | Service-cycle only | yes |
| `systemctl stop ollama && docker stop $(docker ps -q)` and retry | Loses long-running inference sessions; must coordinate with whoever relies on them | yes |
| Reboot `xr-3080` | Disruptive; clears NVIDIA UVM state cleanly | yes |

`needs-info`: pick one.

### B3 — DATA volume

The DATA volume (`/dev/nvme2n1p2`) is **not** a candidate for
FreeToken runtime placement. Default: leave it alone.

## Decision Required From Operator

1. Pick a B2 path.
2. Pick a workstation `DATADIR` (Z: / F: / other).

Once both are answered, this issue is fully action-ready: the
Runbook will execute without further questions.

## Research Questions

### Closed

- **Q1 closed** (2026-08-23) — see
  `research/2026-08-23-model-selection-and-quantization.md`.
  `Qwen3-30B-A3B` selected.
- **Q2 closed** (2026-08-23) — same note. `--dtype` does not
  quantize; `--dtype float16` is the practical default for `offload`.
- **Q3 closed** (2026-08-23) — see
  `research/2026-08-23-cross-host-placement.md`. Strategy A.
- **Q4 closed** (2026-08-23) — same note. 5090 offline.
- **R1.1 closed (2026-08-23)** — see
  `research/2026-08-23-r11-real-weights.md`. **56.87 GiB total;
  16 shards; BF16 only; pure MoE (128 experts / 8 active).**

### Open (deferred)

- **R1.2** — verify `Qwen/Qwen3.6-27B-FP8` exists and repo size. Fallback.
- **R2.1** — FreeToken Gemma-4 GGUF path with `--moe-backend offload`.
  Could become a fallback path if Qwen3-30B-A3B fails.
- **R2.2** — FreeToken external quantization (GPTQ/AWQ) ingestion. CLI
  does not expose a quantize flag.

## Runbook (To Execute Once B2 + DATADIR Are Set)

```bash
# ---- Step 0 — workstation: download model via Modelscope ----
#   DATADIR is operator choice; default below is /z/Models/
export DATADIR="/z/Models"      # operator override
mkdir -p "$DATADIR/freetoken/Qwen3-30B-A3B"
modelscope download --model Qwen/Qwen3-30B-A3B \
    --local_dir "$DATADIR/freetoken/Qwen3-30B-A3B"

# ---- Step 1 — single transfer to xr-3080 ----
ssh xr-3080 'mkdir -p /tmp/freetoken-models'
scp -r "$DATADIR/freetoken/Qwen3-30B-A3B" \
      xr-3080:/tmp/freetoken-models/

# ---- Step 2 — unblock nvidia-smi (B2 path) ----
# Variant A: service-cycle only
ssh xr-3080 '
  systemctl restart nvidia-powerd.service
'
ssh xr-3080 'timeout 5 nvidia-smi'   # expect <5s return

# Variant B: stop ollama + vllm first
ssh xr-3080 '
  systemctl stop ollama.service
  docker stop 6836a36a8b5a
  docker stop $(docker ps -q --filter ancestor=vllm/vllm-openai:unlimited-ocr)
  systemctl restart nvidia-powerd.service
'
ssh xr-3080 'timeout 5 nvidia-smi'   # expect <5s return

# Variant C: reboot
ssh xr-3080 'shutdown -r now'        # wait for SSH to come back

# ---- Step 3 — first cold start ----
ssh xr-3080 '
  source /opt/freetoken/bin/activate
  ft serve \
    --model-path /tmp/freetoken-models/Qwen3-30B-A3B \
    --model-source modelscope \
    --port 8080 \
    --dtype float16 \
    --moe-backend offload \
    --memory-ratio 0.85 \
    --cache-type radix \
    --tool-call-parser auto \
    --sampling-defaults model
' &

# ---- Step 4 — capture ----
curl -sS --max-time 60 http://xr-3080:8080/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"Qwen3-30B-A3B","messages":[{"role":"user","content":"Hello"}]}' \
  | tee 01-Projects/freetoken-eval/captures/001-cold-start.json
```

## Evidence

- Note: `30-Architecture/freetoken-runtime-on-xr-3080.md`
- Research Q1/Q2: `research/2026-08-23-model-selection-and-quantization.md`
- Research Q3/Q4: `research/2026-08-23-cross-host-placement.md`
- Research R1.1: `research/2026-08-23-r11-real-weights.md`
- Capture snapshots: none yet.

## Related Items

- Source: `src_freetoken_0ab982f10` (upstream anchor)
- Architecture note: `30-Architecture/freetoken-runtime-on-xr-3080.md`
- Cross-host research: `research/2026-08-23-cross-host-placement.md`
- Model/quantization research: `research/2026-08-23-model-selection-and-quantization.md`
- R1.1 evidence: `research/2026-08-23-r11-real-weights.md`
- Triage label mapping: `docs/agents/triage-labels.md`
