"""Serialize/deserialize HolonSet to/from JSON (stdlib only)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .holon import CausalEdge, Holon, HolonSet

_SCHEMA_VERSION = "1"


def holon_set_to_dict(hs: HolonSet) -> dict:
    holons = []
    for h in hs.holons:
        edges = [
            {
                "source_id": e.source_id,
                "target_id": e.target_id,
                "relation": e.relation,
                "confidence": e.confidence,
                "llm_confidence": e.llm_confidence,
                "cooccur_weight": e.cooccur_weight,
                "provenance": e.provenance,
            }
            for e in h.causal_edges
        ]
        holons.append(
            {
                "id": h.id,
                "kind": h.kind,
                "entity_type": h.entity_type,
                "title": h.title,
                "summary": h.summary,
                "content_hash": h.content_hash,
                "status": h.status,
                "source_path": h.source_path,
                "compiled_at": h.compiled_at,
                "wikilinks": h.wikilinks,
                "keywords": h.keywords,
                "causal_edges": edges,
            }
        )
    return {
        "schema_version": _SCHEMA_VERSION,
        "version": hs.version,
        "vault_path": hs.vault_path,
        "holon_count": len(holons),
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "holons": holons,
    }


def holon_set_from_dict(d: dict) -> HolonSet:
    holons = []
    for raw in d.get("holons", []):
        edges = [
            CausalEdge(
                source_id=e["source_id"],
                target_id=e["target_id"],
                relation=e["relation"],
                confidence=float(e["confidence"]),
                llm_confidence=float(e.get("llm_confidence", 1.0)),
                cooccur_weight=float(e.get("cooccur_weight", 0.0)),
                provenance=e.get("provenance", ""),
            )
            for e in raw.get("causal_edges", [])
        ]
        holons.append(
            Holon(
                id=raw["id"],
                kind=raw["kind"],
                entity_type=raw["entity_type"],
                title=raw["title"],
                summary=raw.get("summary", ""),
                content_hash=raw.get("content_hash", ""),
                status=raw.get("status", "active"),
                source_path=raw.get("source_path", ""),
                compiled_at=raw.get("compiled_at", ""),
                wikilinks=raw.get("wikilinks", []),
                keywords=raw.get("keywords", []),
                causal_edges=edges,
            )
        )
    return HolonSet(
        holons=holons,
        version=d.get("version", ""),
        vault_path=d.get("vault_path", ""),
    )


def dump_json(hs: HolonSet, path: Path, *, indent: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(holon_set_to_dict(hs), ensure_ascii=False, indent=indent), encoding="utf-8")


def load_json(path: Path) -> HolonSet:
    return holon_set_from_dict(json.loads(path.read_text(encoding="utf-8")))
