"""Tests for Phase 2+3: meta_ontology, domain ontology, holons pipeline.

Run: uv run --python 3.11 --with pytest python -m pytest tests/test_holons.py -v
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from compiler.meta_ontology import CAUSAL_TYPES, ENTITY_CLASSES, resolve_entity_class
from compiler.ontology import DomainOntology, load_domain_ontology, _parse_ontology_yaml
from compiler.holons.holon import CausalEdge, Holon, HolonSet
from compiler.holons.extractor import extract_holon, extract_vault
from compiler.holons.concept_graph import (
    attach_edges,
    build_wikilink_graph,
    causal_chain,
    cooccur_weight,
    fuse_confidence,
    wikilink_distance,
)


# ---------------------------------------------------------------------------
# meta_ontology
# ---------------------------------------------------------------------------

class TestMetaOntology:
    def test_causal_types_are_domain_agnostic(self):
        assert "causes" in CAUSAL_TYPES
        assert "macro_factor_drives_price" not in CAUSAL_TYPES

    def test_entity_classes_cover_universals(self):
        for cls in ["Concept", "Entity", "Event", "Decision", "Finding", "Model", "Process"]:
            assert cls in ENTITY_CLASSES

    def test_resolve_uses_frontmatter_entity_type(self):
        assert resolve_entity_class("note", "Finding", set()) == "Finding"

    def test_resolve_falls_back_to_kind(self):
        assert resolve_entity_class("decision", None, set()) == "Decision"

    def test_resolve_accepts_domain_type(self):
        assert resolve_entity_class("research", "MacroFactor", {"MacroFactor"}) == "MacroFactor"

    def test_resolve_unknown_entity_type_falls_back_to_kind(self):
        assert resolve_entity_class("note", "NonExistent", set()) == "Concept"


# ---------------------------------------------------------------------------
# domain ontology
# ---------------------------------------------------------------------------

class TestDomainOntology:
    def test_default_when_yaml_absent(self, tmp_path):
        ont = load_domain_ontology(tmp_path)
        assert isinstance(ont, DomainOntology)
        assert ont.entity_types == []

    def test_parse_entity_types(self):
        yaml = (
            "version: '1'\ndomain: trading\n"
            "entity_types:\n"
            "  - name: MacroFactor\n    parent: Concept\n    description: Economic macro factor\n"
            "  - name: Strategy\n    parent: Process\n"
        )
        ont = _parse_ontology_yaml(yaml)
        assert ont.domain == "trading"
        names = [e.name for e in ont.entity_types]
        assert "MacroFactor" in names and "Strategy" in names

    def test_parse_causal_hints(self):
        yaml = "causal_hints:\n  - from: MacroFactor\n    to: Finding\n    relation: causes\n"
        ont = _parse_ontology_yaml(yaml)
        assert ont.causal_hints[0].relation == "causes"

    def test_invalid_relation_falls_back(self):
        yaml = "causal_hints:\n  - from: A\n    to: B\n    relation: invented\n"
        ont = _parse_ontology_yaml(yaml)
        assert ont.causal_hints[0].relation == "related_to"

    def test_entity_type_names_includes_meta_classes(self):
        ont = DomainOntology()
        assert "Concept" in ont.entity_type_names
        assert "Decision" in ont.entity_type_names

    def test_load_from_vault_kb_dir(self, tmp_path):
        (tmp_path / "KB").mkdir()
        (tmp_path / "KB" / "ontology.yaml").write_text(
            "version: '1'\ndomain: test\nentity_types:\n  - name: Widget\n    parent: Entity\n",
            encoding="utf-8",
        )
        ont = load_domain_ontology(tmp_path)
        assert "Widget" in ont.entity_type_names


# ---------------------------------------------------------------------------
# extract_holon
# ---------------------------------------------------------------------------

class TestExtractHolon:
    def _ont(self):
        return DomainOntology()

    def test_reads_frontmatter_fields(self, tmp_path):
        f = tmp_path / "note.md"
        f.write_text(
            "---\nid: trading/macro\ndescription: A macro note\nkind: research\nstatus: active\n---\n\n# Macro Title\n",
            encoding="utf-8",
        )
        h = extract_holon(f, tmp_path, self._ont())
        assert h is not None
        assert h.id == "trading/macro"
        assert h.kind == "research"
        assert h.summary == "A macro note"
        assert h.title == "Macro Title"

    def test_derives_id_from_path_when_missing(self, tmp_path):
        d = tmp_path / "05-Engineering"
        d.mkdir()
        f = d / "rust-ownership.md"
        f.write_text("---\nkind: note\n---\n", encoding="utf-8")
        h = extract_holon(f, tmp_path, self._ont())
        assert h is not None
        assert "/" in h.id

    def test_extracts_wikilinks(self, tmp_path):
        f = tmp_path / "note.md"
        f.write_text(
            "---\nid: a/b\nkind: note\n---\n\nSee [[other-note]] and [[third|alias]].\n",
            encoding="utf-8",
        )
        h = extract_holon(f, tmp_path, self._ont())
        assert h is not None
        assert "other-note" in h.wikilinks
        assert "third" in h.wikilinks

    def test_content_hash_is_64_char_hex(self, tmp_path):
        f = tmp_path / "note.md"
        f.write_text("---\nid: a/b\nkind: note\n---\n", encoding="utf-8")
        h = extract_holon(f, tmp_path, self._ont())
        assert h is not None
        assert len(h.content_hash) == 64

    def test_returns_none_on_missing_file(self, tmp_path):
        assert extract_holon(tmp_path / "ghost.md", tmp_path, self._ont()) is None

    def test_causal_edges_empty_before_graph_build(self, tmp_path):
        f = tmp_path / "note.md"
        f.write_text("---\nid: a/b\nkind: note\n---\n", encoding="utf-8")
        h = extract_holon(f, tmp_path, self._ont())
        assert h is not None and h.causal_edges == []

    def test_entity_type_from_kind(self, tmp_path):
        f = tmp_path / "d.md"
        f.write_text("---\nid: a/b\nkind: decision\n---\n", encoding="utf-8")
        h = extract_holon(f, tmp_path, self._ont())
        assert h is not None and h.entity_type == "Decision"

    def test_is_frozen_property(self, tmp_path):
        f = tmp_path / "frozen.md"
        f.write_text("---\nid: a/b\nkind: decision\nstatus: frozen\n---\n", encoding="utf-8")
        h = extract_holon(f, tmp_path, self._ont())
        assert h is not None and h.is_frozen is True


# ---------------------------------------------------------------------------
# confidence formulas
# ---------------------------------------------------------------------------

class TestConfidence:
    def test_cooccur_direct(self):
        assert cooccur_weight(1) == 1.0

    def test_cooccur_two_hop(self):
        assert cooccur_weight(2) == 0.5

    def test_cooccur_none(self):
        assert cooccur_weight(None) == 0.0

    def test_fuse_formula(self):
        assert abs(fuse_confidence(1.0, 1) - 1.0) < 1e-9
        assert abs(fuse_confidence(0.8, 2) - (0.7 * 0.8 + 0.3 * 0.5)) < 1e-9
        assert abs(fuse_confidence(0.6, None) - 0.42) < 1e-9


# ---------------------------------------------------------------------------
# wikilink graph
# ---------------------------------------------------------------------------

def _hs(pairs: list[tuple[str, list[str]]]) -> HolonSet:
    holons = [
        Holon(id=hid, kind="note", entity_type="Concept", title=hid.split("/")[-1],
              summary="", content_hash="x", wikilinks=links)
        for hid, links in pairs
    ]
    return HolonSet(holons=holons)


class TestWikilinkGraph:
    def test_direct_link_resolved_by_slug(self):
        hs = _hs([("a/note", ["b-note"]), ("b/b-note", [])])
        graph = build_wikilink_graph(hs)
        assert "b/b-note" in graph.get("a/note", set())

    def test_distance_direct_is_1(self):
        hs = _hs([("a/x", ["y"]), ("b/y", [])])
        graph = build_wikilink_graph(hs)
        assert wikilink_distance("a/x", "b/y", graph) == 1

    def test_distance_two_hop_is_2(self):
        hs = _hs([("a/x", ["y"]), ("b/y", ["z"]), ("c/z", [])])
        graph = build_wikilink_graph(hs)
        assert wikilink_distance("a/x", "c/z", graph) == 2

    def test_distance_unreachable_is_none(self):
        hs = _hs([("a/x", []), ("b/y", [])])
        graph = build_wikilink_graph(hs)
        assert wikilink_distance("a/x", "b/y", graph) is None


# ---------------------------------------------------------------------------
# attach_edges + causal_chain
# ---------------------------------------------------------------------------

class TestGraph:
    def _chain_hs(self):
        hs = _hs([("a/x", ["y"]), ("b/y", ["z"]), ("c/z", [])])
        return attach_edges(hs)

    def test_edges_populated_after_attach(self):
        hs = self._chain_hs()
        assert len(hs.by_id()["a/x"].causal_edges) > 0

    def test_edge_confidence_matches_formula(self):
        hs = self._chain_hs()
        edge = hs.by_id()["a/x"].causal_edges[0]
        assert abs(edge.confidence - fuse_confidence(1.0, 1)) < 1e-9

    def test_causal_chain_direct(self):
        hs = self._chain_hs()
        r = causal_chain("a/x", "b/y", hs)
        assert r.status == "complete"
        assert "b/y" in r.path

    def test_causal_chain_two_hop(self):
        hs = self._chain_hs()
        r = causal_chain("a/x", "c/z", hs)
        assert r.status == "complete"
        assert r.path == ["a/x", "b/y", "c/z"]

    def test_causal_chain_not_found(self):
        hs = _hs([("a/x", []), ("b/y", [])])
        hs = attach_edges(hs)
        assert causal_chain("a/x", "b/y", hs).status == "not_found"

    def test_causal_chain_unknown_source(self):
        hs = _hs([("a/x", [])])
        assert causal_chain("ghost/id", "a/x", hs).status == "not_found"

    def test_cumulative_confidence_is_product_of_edges(self):
        # Pre-populate edges with confidence=0.8 to verify product logic
        e1 = CausalEdge("a/x", "b/y", "related_to", 0.8, 0.8, 0.5, "a/x")
        e2 = CausalEdge("b/y", "c/z", "related_to", 0.8, 0.8, 0.5, "b/y")
        holons = [
            Holon("a/x", "note", "Concept", "x", "", "h", causal_edges=[e1]),
            Holon("b/y", "note", "Concept", "y", "", "h", causal_edges=[e2]),
            Holon("c/z", "note", "Concept", "z", "", "h"),
        ]
        hs = HolonSet(holons=holons)
        r = causal_chain("a/x", "c/z", hs)
        assert r.status == "complete"
        assert abs(r.cumulative_confidence - 0.64) < 1e-9  # 0.8 * 0.8

    def test_high_min_confidence_triggers_halt(self):
        hs = self._chain_hs()
        r = causal_chain("a/x", "c/z", hs, min_confidence=0.999)
        assert r.status in {"low_confidence_halt", "complete"}
