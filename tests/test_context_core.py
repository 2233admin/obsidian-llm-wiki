from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from compiler.context_core import (
    VERSION_RE,
    build_context_core,
    compile_context_core,
    context_core_tag,
    context_core_version,
)


FIXED_TIME = datetime(2026, 6, 20, 14, 30, tzinfo=timezone.utc)


def test_version_and_tag_follow_context_core_rules():
    version = context_core_version(FIXED_TIME)

    assert version == "20260620-1430"
    assert VERSION_RE.match(version)
    assert context_core_tag(version) == "context-core-v20260620-1430"


def test_build_context_core_manifest_stats_and_hash_are_reproducible(tmp_path):
    vault = _sample_vault(tmp_path)

    first = build_context_core(vault, compiled_at=FIXED_TIME, git_sha="abc123")
    second = build_context_core(vault, compiled_at=FIXED_TIME, git_sha="abc123")

    assert first["manifest"] == second["manifest"]
    assert first["manifest"]["content_hash"] == second["manifest"]["content_hash"]
    assert len(first["manifest"]["content_hash"]) == 64
    assert first["manifest"]["stats"] == {
        "total_notes": 2,
        "total_holons": 2,
        "total_relations": 1,
        "causal_edges": 1,
        "contradiction_count": 0,
    }
    assert first["manifest"]["version"] == "20260620-1430"
    assert first["manifest"]["tag"] == "context-core-v20260620-1430"
    assert first["ontology"]["domain"] == "test-domain"
    assert sorted(first["holons"]) == ["research__alpha.json", "research__beta.json"]
    assert first["causal_graph"]["stats"]["nodes"] == 2
    assert first["causal_graph"]["stats"]["edges"] == 1
    assert len(first["provenance"]["sources"]) == 2


def test_dry_run_and_formal_packaging_return_same_payload(tmp_path):
    vault = _sample_vault(tmp_path)
    output_dir = tmp_path / "context-core-out"

    dry_run_bundle = compile_context_core(
        vault,
        output_dir=output_dir,
        dry_run=True,
        compiled_at=FIXED_TIME,
        git_sha="abc123",
    )
    assert not output_dir.exists()

    written_bundle = compile_context_core(
        vault,
        output_dir=output_dir,
        dry_run=False,
        compiled_at=FIXED_TIME,
        git_sha="abc123",
    )

    assert written_bundle == dry_run_bundle
    assert _read_json(output_dir / "manifest.json") == written_bundle["manifest"]
    assert _read_json(output_dir / "ontology.json") == written_bundle["ontology"]
    assert _read_json(output_dir / "causal-graph.json") == written_bundle["causal_graph"]
    assert _read_json(output_dir / "provenance.json") == written_bundle["provenance"]
    assert _read_json(output_dir / "holons" / "research__alpha.json") == written_bundle["holons"]["research__alpha.json"]


def _sample_vault(tmp_path: Path) -> Path:
    vault = tmp_path / "vault"
    kb = vault / "KB"
    notes = vault / "notes"
    kb.mkdir(parents=True)
    notes.mkdir(parents=True)
    (kb / "ontology.yaml").write_text(
        'version: "1.0"\n'
        "domain: test-domain\n"
        "entity_types:\n"
        "  MacroFactor:\n"
        "    parent: Concept\n"
        '    description: "macro"\n',
        encoding="utf-8",
    )
    (notes / "alpha.md").write_text(
        "---\n"
        "id: research/alpha\n"
        "kind: research\n"
        "entity_type: MacroFactor\n"
        "description: Alpha summary\n"
        "keywords: [one, two]\n"
        "---\n"
        "# Alpha\n\n"
        "Alpha links to [[beta]].\n",
        encoding="utf-8",
    )
    (notes / "beta.md").write_text(
        "---\n"
        "id: research/beta\n"
        "kind: note\n"
        "description: Beta summary\n"
        "---\n"
        "# Beta\n",
        encoding="utf-8",
    )
    return vault


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))
