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
  - "01-Projects/freetoken-eval/research/2026-08-23-model-selection-and-quantization.md"
tags: ["research", "r1.1", "qwen3-30b-a3b", "evidence", "freetoken-eval"]
---

# Research: R1.1 — Real weight size of `Qwen/Qwen3-30B-A3B`

Captured 2026-08-23 to close research question R1.1 in
`01-Projects/freetoken-eval/issues/001-blocked-eval.md`. The HuggingFace
Hub was unreachable from this workstation (DNS resolves to
`2a03:2880:f107:83:face:b00c:0:25de` then the IP path times out at the
gateway). Modelscope (`www.modelscope.cn`) is reachable and is also
the source `ft serve --model-source modelscope` resolves to natively,
so we read the repo from the same source the runtime would use.

## 1. Repo facts (Modelscope API, 2026-08-23)

- repo ID: `Qwen/Qwen3-30B-A3B`
- Revision: `master`
- Files: 27 total
- Weight files: 16 × `model-{00001..00016}-of-00016.safetensors`
- Total weight: **56.87 GiB** (sum of all `safetensors` sizes)
- Largest single shard: 3.725 GiB (15 shards at this size)
- Smallest single shard: 1.013 GiB (shard 16)
- Other top files: `tokenizer.json` ≈ 11 MiB, `vocab.json` ≈ 3 MiB,
  `merges.txt` ≈ 2 MiB, `model.safetensors.index.json` ≈ 2 KiB
- No `*.gguf`, no `*.bin`, no `*.pt`/`*.pth` files in the repo
- No auxiliary quantization flavours (`-FP8`, `-NVFP4`, etc.) attached
  to this specific model. The catalogue shipped `-FP8` for the 3.6
  variants only.

## 2. Architecture (from `config.json`)

```
model_type: qwen3_moe
architectures: Qwen3MoeForCausalLM
hidden_size: 2048
num_hidden_layers: 48
num_attention_heads: 32
num_key_value_heads: 4            # GQA
head_dim: 128
hidden_act: silu                  # standard swiglu MoE
intermediate_size: 6144          # dense FFN (used in shared layers)
moe_intermediate_size: 768       # per-expert FFN
num_experts: 128                 # total experts
num_experts_per_tok: 8           # active experts per token
decoder_sparse_step: 1           # every layer is MoE
rope_theta: 1000000
max_position_embeddings: 40960
vocab_size: 151936
torch_dtype: bfloat16            # weights already shipped BF16
tie_word_embeddings: false
sliding_window: null             # not used in this model
quantization_config: (absent)    # pure BF16
```

## 3. Back-of-Envelope VRAM Math

Active routed weights per token (one layer):

```
8 experts × (down: 768×2048 + up: 2048×768) × 2 bytes (BF16)
= 8 × 1.5 Mi activations × 2 bytes
≈ 24 MiB resident weight per layer per token routed gate
```

48 layers × 24 MiB ≈ 1.1 GiB resident routed-expert footprint **per
in-flight token batch**. The KV cache is the much larger runtime cost
on long contexts. With `--max-seq-len-override 4096` and BF16 KV
(hidden_size 2048 × kv_heads 4 × head_dim 128 × 2 = 1 MiB / token),
2 GiB KV budget suffices for a 2K context.

Total VRAM budget on RTX 3080 (10 GiB):

| Component | Size |
|---|---|
| FreeToken runtime footprint | ~ 0.3 GiB |
| Active routed experts (one batch) | ~ 1.1 GiB |
| KV cache budget | ~ 2 GiB |
| Tool-call tokenizer + misc buffers | ~ 0.5 GiB |
| Headroom (CUDA graph + radix cache) | ~ 1 GiB |
| **Free for offload LRU expert cache** | ~ 5 GiB |

5 GiB is enough for ~80 expert slots (each ~63 MiB resident),
which fits the standard router workload where each token touches
only 8 of 128 experts. The LRU evictions will be common and
will incur host-RAM → GPU PCIe copy latency. This matches the
upstream README's design intent ("edge-native MoE serving").

## 4. Host RAM Requirement for `--moe-backend offload`

Full-weight host-RAM resident (BF16): **56.87 GiB**.

On `xr-3080` from `30-Architecture/freetoken-runtime-on-xr-3080.md`:

```
Mem:  total 125 GiB
      used 23 GiB
      free 27 GiB
      buff/cache 76 GiB
      available 101 GiB
Swap: 125 GiB (zram0 4.8 MiB used)
```

`available` is 101 GiB; we have 101 - OS = ~95 GiB effective budget.
Loading 57 GiB is comfortable.

Zram0 (125 GiB compressed in RAM) will provide pageable backing
if we ever burst above physical; no NVMe swap is configured.

## 5. LAN Transfer Math (Strategy A)

- Source: workstation `Z:/models/freetoken/Qwen3-30B-A3B/` (NTFS)
- Sink: xr-3080 `/tmp/freetoken-models/Qwen3-30B-A3B/` (tmpfs 63 GiB
  available, volatile)
- One-shot `scp -r` over LAN 1 Gbps (between 192.168.50.53 workstation
  and 192.168.50.38 xr-3080)
- Estimated transfer: **56.9 GiB ÷ ~100 MiB/s real-world scp ≈ 9–12 min**
- Cancellation safety: a kill mid-transfer leaves a half-populated dir
  on `/tmp`; remove with `rm -rf /tmp/freetoken-models` on retry.
- After the `scp` the 3080 directory consumes 56.9 GiB of tmpfs. Reboot
  clears it; long-running services depend on it staying alive.

## 6. Verdict

`Qwen/Qwen3-30B-A3B` is a viable cold-start target on xr-3080 provided
the host RAM and tmpfs conditions above hold:

1. Cold-start requires **no VRAM-resident full weight**. Only routed
   active experts land on GPU.
2. Host RAM must accommodate **57 GiB BF16 experts offloaded**.
3. Workspace `Z:/models/freetoken/` on workstation must hold the
   canonical copy (single 56.9 GiB HDF5-equivalent).

The other three deferred research questions remain open (R1.2, R2.1,
R2.2). They become secondary unless Qwen3-30B-A3B fails at runtime.

## 7. Acceptance Read-Back

R1.1 closed. Confirms:

- Total repo size: **56.87 GiB** (16 shards).
- Architecture: 30 B MoE (128 experts, 8 active, all-BF16).
- Single-source point: Modelscope (`ft serve --model-source modelscope`
  resolves natively).

Free to move on to:
1. Operator decision on B2 (`nvidia-smi` unblock path).
2. Confirming the operator's intent on workstation staging location
   (Z: vs F: vs other).
3. Executing the Runbook in `001-blocked-eval.md`.

## 8. Source Capture

The Modelscope API response used to derive §1 was saved locally at
`/tmp/_ms_qwen3_30b.json` (10.8 KiB) during capture; this raw payload
reproduces the same numbers, so re-running today would re-confirm.
The original HF fetch failed (DNS / routing); the assistant noted
this in chat 2026-08-23.
