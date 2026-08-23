---
llmwiki_type: source_record
source_id: "src_freetoken_0ab982f10"
url: "https://github.com/FlashML-org/FreeToken"
platform: "github"
source_kind: "repo"
access_context: "public"
status: planned
provider: "unknown"
pipeline: "[]"
created_at: "2026-08-23T00:00:00.000Z"
updated_at: "2026-08-23T00:00:00.000Z"
project_id: "freetoken-eval"
tags: ["freetoken", "llm-serving", "inference", "cuda", "moe", "linux", "nvidia", "evaluation", "blocked"]
actor: "codex"
input_type: "url"
canonical: "https://github.com/FlashML-org/FreeToken"
---

# FlashML-org/FreeToken

## Source

- Input: https://github.com/FlashML-org/FreeToken
- Canonical: https://github.com/FlashML-org/FreeToken
- Platform: github
- Source kind: repo
- Models reference: https://github.com/FlashML-org/FreeToken/blob/main/docs/models.md

## Preflight

FreeToken is an open-source LLM inference engine that targets NVIDIA RTX
30-series and MoE workloads on Linux CUDA. Phase 1 evaluation scope covers
two facts already verified on 2026-08-23 against xr-3080 (real host):

| Surface | Verified |
|---|---|
| Install package version | `0.1.2+g0ab982f10` (python pyvenv at `/opt/freetoken`, 1.2 GiB) |
| CLI surface | `/usr/local/bin/ft` is a symlink to `/opt/freetoken/bin/ft`; CLI entrypoint imports `freetoken.cli.main` |
| Serve subcommand | `ft serve --help` parses and exits 0; arguments include `--model-path`, `--tensor-parallel-size`, `--memory-ratio`, `--dtype`, `--num-tokenizer`, `--attention-backend`, `--model-source {huggingface,modelscope}`, `--cache-type {naive,radix}`, `--sampling-defaults {model,none}`, `--tool-call-parser`, MoE offload, etc. |
| Bundled models | None. FreeToken is runtime-only; weights are pulled at first `ft serve` or `hf download`. |
| License | Inspect on first ingest (upstream MIT notice retention still pending). |

Capabilities relevant for the FreeToken evaluation project:

- Single-node CUDA serving with OpenAI-style tool-call parsers (llama3, qwen,
  qwen25, qwen3_coder, mistral, deepseekv32, gemma4, glm47, …)
- MoE offload mode for memory-constrained devices
- Tensor parallel across GPUs
- Radix / naive KV cache

## Selection Policy

- Registration only. No collection expansion, capture, or ingest pipeline
  executed against the upstream repo. Source Note anchors future analytical
  evidence and decisions about model selection and on-host placement.
- Future Selection Policy candidates: pin specific supported model families
  (e.g. Qwen2.5 dense or DeepSeek-MoE) once the on-host blocker below is
  resolved.

## Notes

This Source belongs to the project-scoped context `freetoken-eval`
(`01-Projects/freetoken-eval/`). All on-host install evidence, blockers,
and runbooks must reference `source_id: src_freetoken_0ab982f10`.

Upstream Profile:

- Repo: https://github.com/FlashML-org/FreeToken
- Models: https://github.com/FlashML-org/FreeToken/blob/main/docs/models.md
- Maintained by: FlashML-org
- Target OS: Linux + NVIDIA (RTX 30 series explicitly supported)

## Related Knowledge Items

- `01-Projects/freetoken-eval/issues/001-blocked-eval.md` — xr-3080 on-host
  blockers for the first cold-start of `ft serve`
- `30-Architecture/freetoken-runtime-on-xr-3080.md` — host layout, storage
  inventory, and runtime provenance captured 2026-08-23
