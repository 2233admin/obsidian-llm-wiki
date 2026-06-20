"""Tests for Phase 4: HolonSet JSON serialization round-trip."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from compiler.holons.holon import CausalEdge, Holon, HolonSet, HyperEdge
from compiler.holons.serializer import (
    dump_json,
    holon_set_from_dict,
    holon_set_to_dict,
    load_json,
)


def _make_hs() -> HolonSet:
    edge = CausalEdge("a/x", "b/y", "enables", 0.85, 1.0, 0.5, "a/x")
    h1 = Holon("a/x", "research", "Finding", "Alpha", "Alpha summary", "abc123",
                wikilinks=["b-y"], causal_edges=[edge], status="active")
    h2 = Holon("b/y", "decision", "Decision", "Beta", "", "def456", status="frozen")
    h3 = Holon("tasks/t1", "knowledge-task", "Concept", "Task 1", "do something", "ghi789",
                status="active")
    he = HyperEdge(participants=["a/x", "b/y", "tasks/t1"], relation="co-decided",
                   confidence=0.9, provenance_id="events/meeting-1")
    return HolonSet(holons=[h1, h2, h3], hyper_edges=[he], version="1", vault_path="/fake/vault")


class TestToDict:
    def test_schema_version_present(self):
        d = holon_set_to_dict(_make_hs())
        assert d["schema_version"] == "1"

    def test_holon_count_matches(self):
        hs = _make_hs()
        d = holon_set_to_dict(hs)
        assert d["holon_count"] == len(hs.holons)

    def test_exported_at_present(self):
        d = holon_set_to_dict(_make_hs())
        assert "exported_at" in d and d["exported_at"]

    def test_holons_serialized(self):
        d = holon_set_to_dict(_make_hs())
        ids = {h["id"] for h in d["holons"]}
        assert "a/x" in ids and "b/y" in ids

    def test_causal_edge_serialized(self):
        d = holon_set_to_dict(_make_hs())
        ax = next(h for h in d["holons"] if h["id"] == "a/x")
        assert len(ax["causal_edges"]) == 1
        e = ax["causal_edges"][0]
        assert e["relation"] == "enables"
        assert abs(e["confidence"] - 0.85) < 1e-9

    def test_wikilinks_preserved(self):
        d = holon_set_to_dict(_make_hs())
        ax = next(h for h in d["holons"] if h["id"] == "a/x")
        assert ax["wikilinks"] == ["b-y"]

    def test_hyper_edges_serialized(self):
        d = holon_set_to_dict(_make_hs())
        assert d["hyper_edge_count"] == 1
        he = d["hyper_edges"][0]
        assert he["relation"] == "co-decided"
        assert "a/x" in he["participants"]
        assert he["provenance_id"] == "events/meeting-1"


class TestFromDict:
    def test_round_trip_ids(self):
        hs = _make_hs()
        hs2 = holon_set_from_dict(holon_set_to_dict(hs))
        assert {h.id for h in hs2.holons} == {h.id for h in hs.holons}

    def test_round_trip_edge(self):
        hs2 = holon_set_from_dict(holon_set_to_dict(_make_hs()))
        ax = hs2.by_id()["a/x"]
        assert len(ax.causal_edges) == 1
        assert ax.causal_edges[0].relation == "enables"

    def test_round_trip_status(self):
        hs2 = holon_set_from_dict(holon_set_to_dict(_make_hs()))
        assert hs2.by_id()["b/y"].status == "frozen"

    def test_empty_holons_ok(self):
        hs = holon_set_from_dict({"holons": []})
        assert hs.holons == []

    def test_missing_optional_fields_get_defaults(self):
        raw = {
            "holons": [{
                "id": "x/y", "kind": "note", "entity_type": "Concept",
                "title": "X", "summary": "", "content_hash": "abc",
            }]
        }
        hs = holon_set_from_dict(raw)
        h = hs.holons[0]
        assert h.status == "active"
        assert h.wikilinks == []
        assert h.causal_edges == []

    def test_round_trip_hyper_edges(self):
        hs2 = holon_set_from_dict(holon_set_to_dict(_make_hs()))
        assert len(hs2.hyper_edges) == 1
        he = hs2.hyper_edges[0]
        assert he.relation == "co-decided"
        assert set(he.participants) == {"a/x", "b/y", "tasks/t1"}
        assert abs(he.confidence - 0.9) < 1e-9
        assert he.provenance_id == "events/meeting-1"

    def test_empty_hyper_edges_ok(self):
        hs = holon_set_from_dict({"holons": []})
        assert hs.hyper_edges == []


class TestFileIO:
    def test_dump_and_load_round_trip(self, tmp_path):
        out = tmp_path / "core.json"
        hs = _make_hs()
        dump_json(hs, out)
        hs2 = load_json(out)
        assert {h.id for h in hs2.holons} == {h.id for h in hs.holons}

    def test_dump_creates_parent_dirs(self, tmp_path):
        out = tmp_path / "deep" / "nested" / "core.json"
        dump_json(_make_hs(), out)
        assert out.exists()

    def test_dump_indent_produces_readable_json(self, tmp_path):
        out = tmp_path / "core.json"
        dump_json(_make_hs(), out, indent=2)
        text = out.read_text()
        assert "\n" in text

    def test_dump_valid_json(self, tmp_path):
        out = tmp_path / "core.json"
        dump_json(_make_hs(), out)
        json.loads(out.read_text())  # must not raise
