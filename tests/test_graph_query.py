from __future__ import annotations

import pytest

from llmwiki_vault import (
    EvidenceRecord,
    GraphQueryError,
    InMemoryGraphIndexAdapter,
    SourceRecord,
    TemporalFact,
    VaultIndexSnapshot,
    query_unified,
)


def lazycodex_snapshot() -> VaultIndexSnapshot:
    source = SourceRecord.from_frontmatter(
        {
            "id": "lazycodex-source",
            "platform": "github",
            "source_kind": "repository",
            "raw_url": "https://github.com/example/lazycodex",
            "canonical_url": "https://github.com/example/lazycodex",
            "provider": "manual",
            "pipeline": "lazycodex-fixture",
            "status": "supported",
            "artifact_paths": ["materials/lazycodex/source.md"],
            "evidence_notes": ["lazycodex-evidence"],
            "fetched_at": "2026-06-30T00:00:00+00:00",
            "limitations": [],
            "schema_version": 1,
        }
    )
    evidence = EvidenceRecord.from_frontmatter(
        {
            "id": "lazycodex-evidence",
            "source_id": "lazycodex-source",
            "provider": "manual",
            "artifact_paths": ["materials/lazycodex/evidence.md"],
            "captured_at": "2026-06-30T00:00:00+00:00",
            "generated_by": "pytest",
            "limitations": [],
            "schema_version": 1,
        }
    )
    return VaultIndexSnapshot.from_records([source], [evidence])


def lazycodex_facts() -> tuple[TemporalFact, ...]:
    return (
        TemporalFact(
            id="lcx-memory-workflow",
            subject="LazyCodex",
            predicate="feeds",
            object="LLMwiki memory workflow",
            observed_at="2026-06-30T00:00:00+00:00",
            source_id="lazycodex-source",
            evidence_id="lazycodex-evidence",
            artifact_paths=("materials/lazycodex/evidence.md",),
            temporal_status="atemporal",
            extraction_method="manual",
        ),
        TemporalFact(
            id="lcx-001",
            subject="LCX-001",
            predicate="tracks",
            object="restore searchable LLMwiki memory provider",
            observed_at="2026-06-30T00:00:00+00:00",
            source_id="lazycodex-source",
            evidence_id="lazycodex-evidence",
            artifact_paths=("materials/lazycodex/source.md",),
            temporal_status="atemporal",
            extraction_method="manual",
        ),
    )


def rebuilt_adapter(snapshot: VaultIndexSnapshot) -> InMemoryGraphIndexAdapter:
    adapter = InMemoryGraphIndexAdapter()
    adapter.rebuild(snapshot, lazycodex_facts(), snapshot_revision="rev-1")
    return adapter


def test_graph_index_adapter_rebuild_and_search_contract() -> None:
    snapshot = lazycodex_snapshot()
    adapter = rebuilt_adapter(snapshot)

    result = query_unified(
        snapshot,
        "LazyCodex",
        graph_adapter=adapter,
        graph_mode="required",
        snapshot_revision="rev-1",
    )

    assert result.graph_status == "fresh"
    assert result.warnings == ()
    assert result.graph_hits[0].source_id == "lazycodex-source"
    assert result.graph_hits[0].evidence_id == "lazycodex-evidence"
    assert "LazyCodex" in result.graph_hits[0].snippet


def test_graph_index_search_filters_source_evidence_entity_and_topic() -> None:
    snapshot = lazycodex_snapshot()
    adapter = rebuilt_adapter(snapshot)

    source_result = query_unified(
        snapshot,
        "",
        graph_adapter=adapter,
        source_id="lazycodex-source",
        snapshot_revision="rev-1",
    )
    evidence_result = query_unified(
        snapshot,
        "",
        graph_adapter=adapter,
        evidence_id="lazycodex-evidence",
        snapshot_revision="rev-1",
    )
    entity_result = query_unified(
        snapshot,
        "LCX-001",
        graph_adapter=adapter,
        snapshot_revision="rev-1",
    )
    topic_result = query_unified(
        snapshot,
        "LLMwiki memory workflow",
        graph_adapter=adapter,
        snapshot_revision="rev-1",
    )

    assert len(source_result.graph_hits) == 2
    assert len(evidence_result.graph_hits) == 2
    assert entity_result.graph_hits[0].fact_id == "lcx-001"
    assert topic_result.graph_hits[0].fact_id == "lcx-memory-workflow"


def test_query_unified_opportunistic_degrades_when_graph_missing_or_stale() -> None:
    snapshot = lazycodex_snapshot()
    missing = query_unified(snapshot, "LazyCodex", graph_adapter=None)
    stale_adapter = rebuilt_adapter(snapshot)

    stale = query_unified(
        snapshot,
        "LazyCodex",
        graph_adapter=stale_adapter,
        snapshot_revision="rev-2",
    )

    assert missing.graph_status == "degraded"
    assert "unavailable" in missing.warnings[0]
    assert stale.graph_status == "degraded"
    assert "stale" in stale.warnings[0]


def test_query_unified_required_fails_when_graph_missing_or_stale() -> None:
    snapshot = lazycodex_snapshot()
    adapter = rebuilt_adapter(snapshot)

    with pytest.raises(GraphQueryError):
        query_unified(snapshot, "LazyCodex", graph_adapter=None, graph_mode="required")
    with pytest.raises(GraphQueryError):
        query_unified(
            snapshot,
            "LazyCodex",
            graph_adapter=adapter,
            graph_mode="required",
            snapshot_revision="rev-2",
        )


def test_query_unified_off_does_not_touch_graph_adapter() -> None:
    snapshot = lazycodex_snapshot()

    class FailingAdapter(InMemoryGraphIndexAdapter):
        def metadata(self):  # type: ignore[no-untyped-def]
            raise AssertionError("off mode must not touch graph adapter")

    result = query_unified(
        snapshot,
        "LazyCodex",
        graph_adapter=FailingAdapter(),
        graph_mode="off",
    )

    assert result.graph_status == "off"
    assert result.graph_hits == ()


def test_rebuild_rejects_graph_facts_without_provenance() -> None:
    snapshot = lazycodex_snapshot()
    adapter = InMemoryGraphIndexAdapter()
    bad_fact = TemporalFact(
        id="bad",
        subject="LazyCodex",
        predicate="feeds",
        object="LLMwiki",
        observed_at="2026-06-30T00:00:00+00:00",
        source_id="",
        evidence_id="lazycodex-evidence",
    )

    with pytest.raises(ValueError, match="missing source_id"):
        adapter.rebuild(snapshot, [bad_fact])
