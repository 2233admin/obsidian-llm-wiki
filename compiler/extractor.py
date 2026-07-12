"""LLM extraction -- calls OpenAI-compatible API to extract structured knowledge from chunks."""

from __future__ import annotations

import asyncio
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import json_compat as orjson  # zero-dep shim: orjson if installed, else stdlib json
from models import Chunk

# Thread pool for concurrent API calls (max 10 concurrent)
_executor = ThreadPoolExecutor(max_workers=10)

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
    entity_type: str = "Concept"
    facts: list[dict[str, Any]] = field(default_factory=list)


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
    payload = orjson.dumps({
        "model": model,
        "messages": messages,
        "max_tokens": 1024,
        "temperature": 0.2,
    })

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
        body = orjson.loads(resp.read())

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
        first_newline = raw.find("\n")
        last_newline = raw.rfind("\n")
        if first_newline != last_newline:
            raw = raw[first_newline+1:last_newline]
        else:
            raw = raw[first_newline+1:] if first_newline >= 0 else ""
    if raw.endswith("```"):
        raw = raw[:-3].rstrip()

    try:
        data = orjson.loads(raw)
    except orjson.JSONDecodeError as exc:
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
        entity_type=str(data.get("entity_type", "Concept")),
        facts=data.get("facts", []),
    )


def resolve_model(tier: str, provider: str = "anthropic") -> str:
    """Map tier name to model string for the given provider, falling back to raw tier."""
    preset = PROVIDER_PRESETS.get(provider, PROVIDER_PRESETS["anthropic"])
    return preset.get(tier, tier)


def resolve_provider_url(provider: str) -> str | None:
    """Return the base_url for a known provider preset, or None."""
    preset = PROVIDER_PRESETS.get(provider)
    return preset.get("base_url") if preset else None


async def extract_batch(
    chunks: list[Chunk],
    existing_concepts: list[str],
    model: str,
    base_url: str,
    api_key: str,
    max_concurrent: int = 10,
) -> list[ExtractionResult]:
    """Extract from multiple chunks concurrently using thread pool.

    This provides 3-5x speedup over sequential extraction for I/O-bound API calls.
    """
    loop = asyncio.get_event_loop()

    def call_single(chunk: Chunk) -> ExtractionResult | None:
        return extract_chunk(chunk, existing_concepts, model, base_url, api_key)

    # Use thread pool to run blocking I/O concurrently
    futures = [
        loop.run_in_executor(_executor, call_single, chunk)
        for chunk in chunks
    ]
    results = await asyncio.gather(*futures, return_exceptions=True)

    # Filter out exceptions and None results
    valid_results: list[ExtractionResult] = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            print(f"[warn] Batch extraction failed for chunk {i}: {result}", file=sys.stderr)
        elif result is not None:
            valid_results.append(result)

    return valid_results


def _meta_relation_names() -> set[str]:
    try:
        from .meta_ontology import RELATION_TYPES
    except ImportError:
        from meta_ontology import RELATION_TYPES

    return {relation for group in RELATION_TYPES.values() for relation in group}


def _ontology_allowed_relations(
    ontology: Any,
    from_type: str,
    to_type: str,
) -> set[str]:
    if hasattr(ontology, "get_allowed_relations"):
        return set(ontology.get_allowed_relations(from_type, to_type))

    constraints = getattr(ontology, "ontology", {}).get("relation_constraints", [])
    allowed: set[str] = set()
    for constraint in constraints:
        if constraint.get("from") != from_type:
            continue
        if to_type in constraint.get("to", []):
            allowed.update(constraint.get("allowed", []))
    return allowed


def normalize_holon_extraction(
    extraction: dict[str, Any],
    ontology: Any,
    default_entity_type: str = "Concept",
) -> dict[str, Any]:
    entity_type = str(extraction.get("entity_type") or default_entity_type)
    valid_relations = _meta_relation_names()
    facts: list[dict[str, Any]] = []

    for raw_fact in extraction.get("facts", []):
        if not isinstance(raw_fact, dict):
            continue
        relation = str(raw_fact.get("relation", ""))
        if relation not in valid_relations:
            continue

        target_type = str(raw_fact.get("target_type") or default_entity_type)
        allowed = _ontology_allowed_relations(ontology, entity_type, target_type)
        if not allowed or relation not in allowed:
            continue

        confidence = raw_fact.get("confidence", 0.6)
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            confidence = 0.6

        fact = dict(raw_fact)
        fact["relation"] = relation
        fact["target_type"] = target_type
        fact["confidence"] = max(0.0, min(1.0, confidence))
        fact.setdefault("trust_level", "extracted")
        facts.append(fact)

    return {"entity_type": entity_type, "facts": facts}


def extract_causal_schema(
    text: str,
    ontology: Any,
    entity_type: str = "Concept",
    target_type: str | None = None,
) -> dict[str, Any]:
    relation_markers = [
        ("prevents", ["prevents", "prevent", "blocks", "阻止", "防止", "避免"]),
        ("causes", ["causes", "cause", "caused", "leads to", "导致", "造成", "引发"]),
        ("enables", ["enables", "enable", "allows", "促进", "使得"]),
        ("requires", ["requires", "require", "depends on", "需要", "依赖"]),
    ]
    lowered = text.lower()
    relation = ""
    marker = ""
    for candidate, markers in relation_markers:
        marker = next((m for m in markers if m in lowered or m in text), "")
        if marker:
            relation = candidate
            break

    facts: list[dict[str, Any]] = []
    if relation:
        target_text = _target_after_marker(text, marker)
        facts.append(
            {
                "claim": text.strip(),
                "relation": relation,
                "target_id": _fact_target_id(target_text),
                "target_type": target_type or entity_type,
                "confidence": 0.8,
                "evidence": text.strip(),
                "trust_level": "extracted",
            }
        )

    return normalize_holon_extraction(
        {"entity_type": entity_type, "facts": facts},
        ontology,
        default_entity_type=entity_type,
    )


def _target_after_marker(text: str, marker: str) -> str:
    if not marker:
        return "unknown-target"
    index = text.lower().find(marker.lower())
    if index == -1:
        index = text.find(marker)
    target = text[index + len(marker) :].strip(" ，,。.;；:：\n\t")
    for sep in ("，", "。", ",", ".", ";", "；", "\n"):
        if sep in target:
            target = target.split(sep, 1)[0]
    return target.strip() or "unknown-target"


def _fact_target_id(target_text: str) -> str:
    normalized = target_text.lower()
    replacements = {
        "债券价格": "bond-prices",
        "bond prices": "bond-prices",
        "prices": "prices",
    }
    for needle, slug in replacements.items():
        if needle in normalized:
            return f"extracted/{slug}"
    chars = [
        char if char.isalnum() else "-"
        for char in normalized
        if char.isalnum() or char in {" ", "-", "_", "/"}
    ]
    slug = "".join(chars).replace("_", "-").replace("/", "-")
    slug = "-".join(part for part in slug.split("-") if part)
    return f"extracted/{slug or 'unknown-target'}"
