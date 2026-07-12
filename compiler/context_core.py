from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .holons.concept_graph import attach_edges
from .holons.extractor import extract_vault
from .holons.holon import CausalEdge, Holon, HolonSet
from .ontology import DomainOntology, load_domain_ontology

CONTEXT_CORE_DIR = Path("KB") / "context-core"
COMPILER_VERSION = "0.4.0"
VERSION_RE = re.compile(r"^\d{8}-\d{4}$")
TAG_PREFIX = "context-core-v"


def context_core_version(compiled_at: datetime | None = None) -> str:
    return _coerce_datetime(compiled_at).strftime("%Y%m%d-%H%M")


def context_core_tag(version: str) -> str:
    if not VERSION_RE.match(version):
        raise ValueError(f"invalid Context Core version: {version}")
    return f"{TAG_PREFIX}{version}"


def build_context_core(
    vault_path: Path | str,
    *,
    compiled_at: datetime | None = None,
    compiler_version: str = COMPILER_VERSION,
    git_sha: str = "unknown",
) -> dict[str, Any]:
    vault = Path(vault_path).resolve()
    now = _coerce_datetime(compiled_at)
    compiled_at_iso = _isoformat_z(now)
    version = context_core_version(now)
    ontology = load_domain_ontology(vault)
    holon_set = attach_edges(extract_vault(vault, ontology))
    holon_set.version = version
    holon_set.vault_path = vault.as_posix()

    for holon in holon_set.holons:
        holon.compiled_at = compiled_at_iso

    ontology_payload = _ontology_to_dict(ontology)
    holon_payloads = [_holon_to_payload(holon, ontology.domain, compiler_version) for holon in holon_set.holons]
    causal_graph = _causal_graph_payload(holon_set, compiled_at_iso)
    provenance = _provenance_payload(holon_set, compiled_at_iso, compiler_version)
    holon_files = {_holon_filename(payload["id"]): payload for payload in holon_payloads}

    stats = _stats_payload(holon_set, causal_graph)
    content_hash = _content_hash(
        {
            "ontology": ontology_payload,
            "holons": holon_files,
            "causal_graph": causal_graph,
            "provenance": provenance,
        }
    )
    manifest = {
        "version": version,
        "tag": context_core_tag(version),
        "domain": ontology.domain,
        "vault_path": vault.as_posix(),
        "compiled_at": compiled_at_iso,
        "compiler_version": compiler_version,
        "content_hash": content_hash,
        "stats": stats,
        "adapters": ["filesystem"],
        "git_sha": git_sha,
    }

    return {
        "manifest": manifest,
        "ontology": ontology_payload,
        "holons": holon_files,
        "causal_graph": causal_graph,
        "provenance": provenance,
    }


def compile_context_core(
    vault_path: Path | str,
    *,
    output_dir: Path | str | None = None,
    dry_run: bool = False,
    compiled_at: datetime | None = None,
    compiler_version: str = COMPILER_VERSION,
    git_sha: str = "unknown",
) -> dict[str, Any]:
    vault = Path(vault_path).resolve()
    bundle = build_context_core(
        vault,
        compiled_at=compiled_at,
        compiler_version=compiler_version,
        git_sha=git_sha,
    )
    target = Path(output_dir) if output_dir is not None else vault / CONTEXT_CORE_DIR
    if not dry_run:
        write_context_core(bundle, target)
    return bundle


def write_context_core(bundle: dict[str, Any], output_dir: Path | str) -> None:
    target = Path(output_dir)
    holons_dir = target / "holons"
    holons_dir.mkdir(parents=True, exist_ok=True)
    _write_json(target / "manifest.json", bundle["manifest"])
    _write_json(target / "ontology.json", bundle["ontology"])
    for filename, payload in bundle["holons"].items():
        _write_json(holons_dir / filename, payload)
    _write_json(target / "causal-graph.json", bundle["causal_graph"])
    _write_json(target / "provenance.json", bundle["provenance"])


def _coerce_datetime(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _isoformat_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _ontology_to_dict(ontology: DomainOntology) -> dict[str, Any]:
    return {
        "version": ontology.version,
        "domain": ontology.domain,
        "entity_types": [asdict(entity_type) for entity_type in ontology.entity_types],
        "causal_hints": [asdict(hint) for hint in ontology.causal_hints],
    }


def _holon_to_payload(holon: Holon, domain: str, compiler_version: str) -> dict[str, Any]:
    return {
        "id": holon.id,
        "type": holon.entity_type,
        "kind": holon.kind,
        "domain": domain,
        "title": holon.title,
        "summary": holon.summary,
        "keywords": holon.keywords,
        "parts": holon.wikilinks,
        "facts": [],
        "relations": [_edge_to_relation(edge) for edge in holon.causal_edges],
        "embedding_ref": "",
        "provenance": {
            "source_note": holon.source_path,
            "content_hash": holon.content_hash,
            "compiled_at": holon.compiled_at,
            "compiler_version": compiler_version,
        },
    }


def _edge_to_relation(edge: CausalEdge) -> dict[str, Any]:
    return {
        "predicate": edge.relation,
        "target": edge.target_id,
        "confidence": edge.confidence,
        "trust_level": "extracted",
        "provenance": edge.provenance,
    }


def _causal_graph_payload(holon_set: HolonSet, generated_at: str) -> dict[str, Any]:
    nodes = [
        {
            "id": holon.id,
            "type": holon.entity_type,
            "title": holon.title,
            "source_note": holon.source_path,
        }
        for holon in holon_set.holons
    ]
    edges = [
        {
            "source": edge.source_id,
            "target": edge.target_id,
            "relation": edge.relation,
            "confidence": edge.confidence,
            "llm_confidence": edge.llm_confidence,
            "cooccur_weight": edge.cooccur_weight,
            "provenance": edge.provenance,
        }
        for holon in holon_set.holons
        for edge in holon.causal_edges
    ]
    return {
        "generated_at": generated_at,
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "nodes": len(nodes),
            "edges": len(edges),
            "causal_edges": len(edges),
            "contradiction_count": _contradiction_count(edges),
        },
    }


def _provenance_payload(
    holon_set: HolonSet,
    generated_at: str,
    compiler_version: str,
) -> dict[str, Any]:
    return {
        "generated_at": generated_at,
        "compiler_version": compiler_version,
        "sources": [
            {
                "holon_id": holon.id,
                "source_note": holon.source_path,
                "content_hash": holon.content_hash,
                "compiled_at": holon.compiled_at,
                "trust_level": "human" if holon.kind == "decision" else "extracted",
            }
            for holon in holon_set.holons
        ],
    }


def _stats_payload(holon_set: HolonSet, causal_graph: dict[str, Any]) -> dict[str, int]:
    graph_stats = causal_graph["stats"]
    return {
        "total_notes": len(holon_set.holons),
        "total_holons": len(holon_set.holons),
        "total_relations": graph_stats["edges"],
        "causal_edges": graph_stats["causal_edges"],
        "contradiction_count": graph_stats["contradiction_count"],
    }


def _contradiction_count(edges: list[dict[str, Any]]) -> int:
    seen: set[tuple[str, str, str]] = set()
    contradictions = 0
    for edge in edges:
        key = (edge["source"], edge["target"])
        relation = edge["relation"]
        if relation == "contradicts":
            contradictions += 1
            continue
        inverse = (key[0], key[1], "contradicts")
        if inverse in seen:
            contradictions += 1
        seen.add((key[0], key[1], relation))
    return contradictions


def _content_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _holon_filename(holon_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "__", holon_id).strip("_")
    return f"{safe or 'holon'}.json"


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    path.write_text(text, encoding="utf-8")
