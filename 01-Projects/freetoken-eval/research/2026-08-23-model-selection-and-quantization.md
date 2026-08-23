---
llmwiki_type: analysis
status: analyzed
project_id: "freetoken-eval"
created_at: "2026-08-23T00:00:00.000Z"
updated_at: "2026-08-23T00:00:00.000Z"
actor: "codex"
related_sources: ["src_freetoken_0ab982f10"]
related_issues: ["001-blocked-eval"]
related_knowledge_items:
  - "30-Architecture/freetoken-runtime-on-xr-3080.md"
  - "01-Projects/freetoken-eval/research/2026-08-23-cross-host-placement.md"
tags: ["research", "model-selection", "quantization", "moe", "freetoken-eval"]
---

# Research: FreeToken model selection & quantization on xr-3080

Captured 2026-08-23 in answer to research questions 1 and 2 in
`01-Projects/freetoken-eval/issues/001-blocked-eval.md`. Anchored on
the upstream catalog at
`https://github.com/FlashML-org/FreeToken/blob/main/docs/models.md`
(re-fetched 2026-08-23). Network access to `huggingface.co` and web
search providers failed from this workstation during the capture; the
HF repo file sizes were **not** directly measured and must be confirmed
on the next session with reachable outbound network.

## 0. Constraint Recap

xr-3080 RTX 3080, 10 GB VRAM. Host `/` 6.5 GiB residual; no dedicated
disk; HF cache empty. Cross-host staging chosen: workstation `Z:` or
`F:` → `scp` to xr-3080 `/tmp/`. See
`research/2026-08-23-cross-host-placement.md`.

FreeToken design contract (from upstream README):

> "edge-native Mixture-of-Experts (MoE) serving engine ... designed
> for running frontier-scale open-weight models on personal and
> consumer hardware ... with native support for NVIDIA RTX 30, RTX 40,
> and RTX 50 series GPUs"

This is **not** a small-model eval target. The smallest supported
checkpoint is `gpt-oss-20b` (20 B). Most supported checkpoints are
MoE at 30 B–>500 B class.

## 1. FreeToken-Supported Models (refreshed 2026-08-23)

Pulled directly from
`https://raw.githubusercontent.com/FlashML-org/FreeToken/main/docs/models.md`.

| Family | Specific | Param count | Format | Notes |
|---|---|---|---|---|
| DeepSeek-V4 | DeepSeek-V4-Flash-0731 | unspecified but small | BF16/FP | Has `inference/config.json` requirement |
| GLM-5.2 | nvidia/GLM-5.2-NVFP4 | frontier | NVFP4 | Newer NVIDIA quant format |
| GLM-4.7 | nvidia/GLM-4.7-NVFP4 | frontier | NVFP4 | ditto |
| Qwen3.6/Qwen3.5 MoE | Qwen3.6-35B-A3B | 35B-A3B (active 3B) | BF16/FP8/NVFP4 | Newest |
| Qwen3.6/Qwen3.5 MoE | Qwen3.5-35B-A3B | 35B-A3B (active 3B) | BF16/FP8 | Q3.5 falls back |
| Qwen3.6 dense | Qwen3.6-27B | 27B | BF16/FP8/NVFP4 | only dense line |
| Qwen3 MoE | Qwen3-30B-A3B | 30B total, 3B active | BF16 | FreeToken ups the "small model" floor |
| gpt-oss | gpt-oss-120b | 120B | MXFP4 | Mixture-of-experts tuned |
| gpt-oss | gpt-oss-20b | 20B | MXFP4 | **This is the listed minimum** |
| Gemma-4 | google/gemma-4-12B-it | 12B dense | BF16 | **smallest dense** |
| Gemma-4 | nvidia/Gemma-4-26B-A4B-NVFP4 | 26B MoE | NVFP4 | — |
| MiniMax-M2.5 | nvidia/MiniMax-M2.5-NVFP4 | — | NVFP4 | vendor sample |
| Muse-Glimmer | meta-models/Muse-Glimmer-30B | 30B | BF16 | — |
| Muse-Glimmer | RedHatAI/Muse-Glimmer-30B-NVFP4 | 30B | NVFP4 | quantized |

## 2. Param totals vs. RTX 3080 VRAM (10 GB)

For inference to fit on a single 10 GB GPU **without** MoE offload,
activations+KV cache must fit alongside weights. Rule of thumb:

- BF16 weights ≈ 2 × param count bytes (gpt-oss uses MXFP4 ≈ 0.5–0.7 byte/param).
- MoE offload shifts expert weights to host RAM — feasible on 3080 with
  --moe-backend offload.
- Tensor parallel is single-GPU on xr-3080; `--tensor-parallel-size` > 1
  is not actionable here.

| Family | Param (total) | Format | Approx weight size | Fits 10 GB? | Verdict |
|---|---|---|---|---|---|
| gpt-oss-20b | 20 B | MXFP4 | ~13–14 GB (fp4 packed) | No, must offload | ❌ No |
| gemma-4-12B-it | 12 B | BF16 | ~24 GB | No | ❌ No |
| Qwen3-30B-A3B | 30 B (3 B active) | BF16 | ~60 GB total, ~6 GB active | **Yes if MoE offload** | ⚠ **Best candidate** |
| Qwen3.6-27B dense | 27 B | BF16 | ~54 GB | No | ❌ |
| Qwen3.6-35B-A3B | 35 B (3 B active) | BF16 | ~70 GB total, ~7 GB active | **Yes if MoE offload** | ⚠ Candidate |
| gpt-oss-120b | 120 B | MXFP4 | ~70 GB packed | No | ❌ |
| DeepSeek-V4-Flash | frontier | BF16 | ≫ 10 GB | No | ❌ |

**Conclusion Q1** — there is **no FreeToken-supported checkpoint that
natively fits 10 GB VRAM.** The two plausible candidates both rely on
MoE offload:

1. **`Qwen/Qwen3-30B-A3B` (BF16, MoE)** — 30 B total, 3 B active. Total
   BF16 weight ≈ 60 GB (lives in host RAM via MoE offload). Active
   expert set per token ≈ 6 GB on GPU.
2. **`Qwen/Qwen3.5-35B-A3B` (BF16/FP8, MoE)** — same shape, slightly
   larger but FP8 halves host-RAM pressure. Would be a second choice
   only after Qwen3-30B-A3B is verified end-to-end.

`gpt-oss-20b` (20 B MXFP4) is potentially compact, but upstream packages
show it at ~13 GB packed — still over 10 GB by ~3 GB and has no MoE
offload variant in the catalogue.

## 3. Quantization Paths

From upstream docs only FreeToken ships one knob: `--dtype {auto,
float16, bfloat16, float32}` and `--moe-backend {auto, fused, offload,
cpu, hybrid}`. Upstream says **"FreeToken loads HF safetensors
checkpoints directly (plus native GGUF for Gemma-4)"**. There is **no
quantization conversion in FreeToken** itself; you feed it whatever the
HF repo already provides. So the q4 path has to come from the HF side.

| Family | Already quantized flavors |
|---|---|
| DeepSeek-V4 | BF16/FP only |
| GLM-5.2 / 4.7 | NVFP4 only |
| Qwen3.6 MoE | BF16 / FP8 / NVFP4 |
| Qwen3.6-27B dense | BF16 / FP8 / NVFP4 |
| Qwen3-30B-A3B | **BF16 only** in catalogue |
| gpt-oss | MXFP4 |
| Gemma-4 | BF16 / NVFP4 (and **native GGUF** for Gemma-4 specifically) |
| MiniMax-M2.5 | NVFP4 only |
| Muse-Glimmer | BF16 / NVFP4 |

`--dtype` choices when feeding BF16-only repos:

| dtype | Side effect |
|---|---|
| `auto` | FreeToken picks BF16 or FP32 based on file; default is BF16 |
| `float16` | downcast to FP16 at load (modest RAM saving) |
| `bfloat16` | keep BF16 (matches repo) |
| `float32` | doubles weight size — never use on 3080 |

`float16` vs `bfloat16`: for inference math both are fine. On RTX 3080
(sm_86, no native BF16 ALU) BF16 weights also have to convert to FP16
inside the kernels, so there is **no VRAM benefit of `--dtype
bfloat16` vs `--dtype float16` here** — what matters is whether the
repo itself ships FP8 or other sub-byte formats.

**Conclusion Q2** — `--dtype float16` is the practical default for the
MoE offload case on xr-3080. **`--dtype` does not quantize**, and
FreeToken currently has no q4 path. The minimum-size path is therefore
a **MoE checkpoint loaded with `--dtype float16` and `--moe-backend
offload`** rather than a quantized dense checkpoint.

For Gemma-4 only, FreeToken accepts native GGUF (q4/q5/q8 already
quantized). On `google/gemma-4-12B-it` and any NVFP4 Gemma-4 variant a
q4 GGUF would land in 4–6 GB resident weights which can plausibly fit
on 10 GB — but the upstream README doesn't say whether GGUF flow
plays nicely with `--moe-backend offload`. This is a research question
to defer (R2.1 below).

## 4. Recommended Path Forward

For the cold-start on xr-3080:

1. Pull **`Qwen/Qwen3-30B-A3B`** (BF16, 30 B total / 3 B active) on
   the workstation into `Z:/models/freetoken/Qwen3-30B-A3B/`.
2. `scp -r` to xr-3080 `/tmp/freetoken-models/Qwen3-30B-A3B/`.
3. After clearing B2 (nvidia-smi) per issue `001-blocked-eval.md`:
   ```
   ft serve \
     --model-path /tmp/freetoken-models/Qwen3-30B-A3B \
     --port 8080 \
     --dtype float16 \
     --moe-backend offload \
     --memory-ratio 0.85 \
     --cache-type radix \
     --tool-call-parser auto \
     --sampling-defaults model
   ```
4. Use `--num-pages` or `--num-tokens` to bound KV cache so a single
   request never pages in too many experts simultaneously (the offload
   LRU will plateau, but cold-start latency is brutal on first request).

If Qwen3-30B-A3B's BF16 weight size in the repo exceeds what we want
to transfer (target: one `scp` < 30 minutes over LAN), reduce to
Qwen3.6-27B dense FP8 (`Qwen3.6-27B-FP8` if it ships with FP8 weights)
and accept higher VRAM pressure; or use gemma-4-12B-it with GGUF q4.

## 5. R&D Questions To Defer

- **R1.1** — confirm `Qwen/Qwen3-30B-A3B` total repo size in HF. Likely
  in the 50–70 GB range (BF16, ~60 GB). Needs outbound network.
- **R1.2** — confirm `Qwen/Qwen3.6-27B-FP8` exists and repo size. Fallback.
- **R2.1** — does FreeToken's Gemma-4 GGUF path support `--moe-backend
  offload`? If yes, `google/gemma-4-12B-it` (BF16) and any Gemma-4
  q4 GGUF become plausible on 10 GB.
- **R2.2** — does FreeToken accept GPTQ/AWQ/AutoGPTQ safetensors
  produced externally? Upstream README does not say. The CLI does not
  expose a quantize flag, but the loader may still parse quantized
  weight files. Needs source dive.
- **R2.3** — `--num-tokenizer` / `--num-pages` defaults at first launch;
  whether 3080 needs manual tuning before serving chat.

## 6. Acceptance Read-Back To The Issue

This research answers Research Questions 1 and 2 from
`01-Projects/freetoken-eval/issues/001-blocked-eval.md` as follows:

- **Q1** — No FreeToken-supported checkpoint fits a 10 GB GPU natively.
  `Qwen3-30B-A3B` (MoE BF16) is the smallest candidate; fits only
  with `--moe-backend offload`. `gemma-4-12B-it` (BF16 dense) does
  not fit at 24 GB.
- **Q2** — `--dtype` controls compute precision only, not weight
  quantization. FreeToken reads HF safetensors as-published. q4 GGUF
  is supported only for Gemma-4 (per upstream). No general quantize
  path inside FreeToken; quantized dense weights have to come from
  HF/MXFP4/NVFP4 upstream flavors.
