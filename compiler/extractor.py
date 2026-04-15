"""LLM extraction -- calls OpenAI-compatible API to extract structured knowledge from chunks."""

from __future__ import annotations

import json
import sys
import urllib.request
from dataclasses import dataclass
from typing import Any

from models import Chunk

# Provider presets -- base_url + tier-to-model mapping per provider
PROVIDER_PRESETS: dict[str, dict[str, str]] = {
    "anthropic": {
        "base_url": "https://api.anthropic.com/v1",
        "haiku":    "claude-haiku-4-5",
        "sonnet":   "claude-sonnet-4-5",
        "opus":     "claude-opus-4-5",
    },
    "qwen": {
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "haiku":    "qwen-turbo",
        "sonnet":   "qwen-plus",
        "opus":     "qwen-max",
    },
    "doubao": {
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "haiku":    "doubao-lite-32k",
        "sonnet":   "doubao-pro-32k",
        "opus":     "doubao-pro-128k",
    },
    "minimax": {
        "base_url": "https://api.minimax.chat/v1",
        "haiku":    "MiniMax-Text-01",
        "sonnet":   "MiniMax-Text-01",
        "opus":     "MiniMax-Text-01",
    },
}

# Backward compat: existing code that imports TIER_MODELS still works
TIER_MODELS: dict[str, str] = {
    k: v for k, v in PROVIDER_PRESETS["anthropic"].items() if k != "base_url"
}

_SYSTEM_PROMPT = """\
You are a knowledge extraction engine. Given a text chunk from a knowledge base article,
extract structured information as JSON. Output ONLY valid JSON, no markdown fences.

Schema:
{
  "summary": "<one-line summary of the chunk>",
  "concepts": [
    {"name": "<concept name>", "definition": "<concise definition>"}
  ],
  "relationships": [
    {"from": "<concept A>", "to": "<concept B>", "type": "<relationship type>"}
  ],
  "claims": [
    {"content": "<factual claim>", "confidence": <0.0-1.0>}
  ]
}

Rules:
- summary: single sentence, <=120 chars
- concepts: only genuinely new concepts not in the existing_concepts list
- relationships: use verb phrases for type (e.g. "is part of", "contradicts", "enables")
- claims: factual statements that could be verified or contradict other claims
- confidence: 1.0=definitive, 0.7=likely, 0.4=speculative
- Return empty arrays [] if nothing applicable
"""


@dataclass
class ExtractionResult:
    summary: str
    concepts: list[dict[str, str]]
    relationships: list[dict[str, str]]
    claims: list[dict[str, Any]]
    chunk: Chunk


def _build_user_message(chunk: Chunk, existing_concepts: list[str]) -> str:
    existing_str = ", ".join(existing_concepts[:50]) if existing_concepts else "none"
    heading_str = f"\nSection: {chunk.heading}" if chunk.heading else ""
    return (
        f"Source: {chunk.source}"
        f"{heading_str}\n"
        f"Existing concepts (skip these): {existing_str}\n\n"
        f"---\n{chunk.content}\n---"
    )


def _call_api(
    messages: list[dict[str, str]],
    model: str,
    base_url: str,
    api_key: str,
    timeout: int = 60,
) -> str:
    """Minimal HTTP call to OpenAI-compatible /chat/completions endpoint."""
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": 1024,
        "temperature": 0.2,
    }).encode("utf-8")

    url = base_url.rstrip("/") + "/chat/completions"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        body = json.loads(resp.read().decode("utf-8"))

    return body["choices"][0]["message"]["content"]


def extract_chunk(
    chunk: Chunk,
    existing_concepts: list[str],
    model: str,
    base_url: str,
    api_key: str,
) -> ExtractionResult | None:
    """Call LLM to extract structured knowledge from a single chunk.

    Returns None on parse failure (warns to stderr).
    """
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": _build_user_message(chunk, existing_concepts)},
    ]
    try:
        raw = _call_api(messages, model, base_url, api_key)
    except Exception as exc:
        print(f"[warn] API call failed for chunk {chunk.source!r}: {exc}", file=sys.stderr)
        return None

    # strip markdown fences if model ignores instruction
    raw = raw.strip()
    if raw.startswith("```"):
        raw = "\n".join(raw.split("\n")[1:])
    if raw.endswith("```"):
        raw = "\n".join(raw.split("\n")[:-1])

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(
            f"[warn] JSON parse failed for chunk {chunk.source!r} "
            f"(heading={chunk.heading!r}): {exc}",
            file=sys.stderr,
        )
        return None

    return ExtractionResult(
        summary=str(data.get("summary", "")),
        concepts=data.get("concepts", []),
        relationships=data.get("relationships", []),
        claims=data.get("claims", []),
        chunk=chunk,
    )


def resolve_model(tier: str, provider: str = "anthropic") -> str:
    """Map tier name to model string for the given provider, falling back to raw tier."""
    preset = PROVIDER_PRESETS.get(provider, PROVIDER_PRESETS["anthropic"])
    return preset.get(tier, tier)


def resolve_provider_url(provider: str) -> str | None:
    """Return the base_url for a known provider preset, or None."""
    preset = PROVIDER_PRESETS.get(provider)
    return preset.get("base_url") if preset else None
