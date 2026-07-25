"""Tests for source-versioned contribution manifests (OpenSpec 5.1-5.6)."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]
COMPILER = ROOT / "compiler"
if str(COMPILER) not in sys.path:
    sys.path.insert(0, str(COMPILER))

import contribution_manifest as contribution_module  # noqa: E402
from contribution_manifest import (  # noqa: E402
    COMPILER_SCHEMA_VERSION,
    PROVENANCE_MARKER,
    DestructiveRetractionBlocked,
    apply_compile_extractions,
    apply_source_revision,
    build_contributions_for_source,
    build_manifest,
    collect_active_contributions,
    compute_affected_topic_closure,
    current_generation_path,
    detect_unknown_provenance,
    disable_source_revision,
    load_store,
    make_contribution_id,
    public_manifest_view,
    read_published_projection,
    rebuild_projections_from_active,
    remove_source,
    report_legacy_provenance,
    source_id_from_path,
    source_revision_from_bytes,
    store_path,
)


def _topic(tmp_path: Path) -> Path:
    topic = tmp_path / "demo-topic"
    (topic / "wiki" / "concepts").mkdir(parents=True)
    (topic / "wiki" / "summaries").mkdir(parents=True)
    (topic / "raw").mkdir(parents=True)
    return topic


def _manifest_for(
    source_path: str,
    *,
    body: str,
    concepts: list[dict],
    claims: list[dict] | None = None,
    relationships: list[dict] | None = None,
    summary_text: str = "summary body",
    contradictions: list[dict] | None = None,
):
    source_id = source_id_from_path(source_path)
    revision = source_revision_from_bytes(body.encode("utf-8"))
    contribs = build_contributions_for_source(
        source_id=source_id,
        source_path=source_path,
        source_revision=revision,
        concepts=concepts,
        claims=claims or [],
        relationships=relationships or [],
        summary_sections=[{"heading": "Overview", "text": summary_text}],
        contradictions=contradictions or [],
    )
    return build_manifest(
        source_id=source_id,
        source_revision=revision,
        contributions=contribs,
    )


def test_stable_contribution_ids_and_public_manifest_surface():
    source_id = source_id_from_path("raw/alpha.md")
    rev = source_revision_from_bytes(b"v1")
    contribs = build_contributions_for_source(
        source_id=source_id,
        source_path="raw/alpha.md",
        source_revision=rev,
        concepts=[
            {"name": "Alpha", "definition": "A concept"},
            {"name": "Beta", "definition": "B concept"},
        ],
        claims=[{"content": "Alpha depends on Beta", "confidence": 0.9}],
        relationships=[{"from": "Alpha", "type": "depends-on", "to": "Beta"}],
        summary_sections=[{"heading": "Overview", "text": "About alpha and beta"}],
    )
    kinds = {c.kind for c in contribs}
    assert kinds >= {
        "claim",
        "relationship",
        "concept_membership",
        "summary_input",
    }
    # Determinism: rebuild yields identical ids.
    again = build_contributions_for_source(
        source_id=source_id,
        source_path="raw/alpha.md",
        source_revision=rev,
        concepts=[
            {"name": "Alpha", "definition": "A concept"},
            {"name": "Beta", "definition": "B concept"},
        ],
        claims=[{"content": "Alpha depends on Beta", "confidence": 0.9}],
        relationships=[{"from": "Alpha", "type": "depends-on", "to": "Beta"}],
        summary_sections=[{"heading": "Overview", "text": "About alpha and beta"}],
    )
    assert [c.id for c in contribs] == [c.id for c in again]

    manifest = build_manifest(source_id=source_id, source_revision=rev, contributions=contribs)
    public = public_manifest_view(manifest)
    assert public["schemaVersion"] == 1
    assert public["compilerSchemaVersion"] == COMPILER_SCHEMA_VERSION
    assert public["active"] is True
    assert set(public["affectedConceptKeys"]) == {"alpha", "beta"}
    assert set(public) == {
        "schemaVersion",
        "manifestId",
        "sourceId",
        "sourceRevision",
        "compilerSchemaVersion",
        "active",
        "contributionIds",
        "affectedConceptKeys",
        "contentDigest",
        "createdAt",
    }
    assert make_contribution_id("claim", source_id, "alpha depends on beta") in public["contributionIds"]


def test_source_contributes_to_two_concepts_before_publish(tmp_path: Path):
    topic = _topic(tmp_path)
    manifest = _manifest_for(
        "raw/ab.md",
        body="revision-1",
        concepts=[
            {"name": "Alpha", "definition": "first"},
            {"name": "Beta", "definition": "second"},
        ],
        claims=[{"content": "Alpha links Beta", "confidence": 0.8, "conceptKeys": ["alpha", "beta"]}],
        relationships=[{"from": "Alpha", "type": "links", "to": "Beta"}],
    )
    assert set(manifest["affectedConceptKeys"]) == {"alpha", "beta"}
    assert len(manifest["contributionIds"]) >= 4

    result = apply_source_revision(topic, manifest, force_full_rebuild=True)
    assert result.activated_manifest_id == manifest["manifestId"]
    assert set(result.affected_concepts) == {"alpha", "beta"}
    assert (topic / "wiki" / "concepts" / "alpha.md").exists()
    assert (topic / "wiki" / "concepts" / "beta.md").exists()
    store = load_store(topic)
    assert store["manifests"][manifest["manifestId"]]["active"] is True
    assert store_path(topic).exists()


def test_revised_claim_retracts_obsolete_while_shared_support_remains(tmp_path: Path):
    topic = _topic(tmp_path)

    m1 = _manifest_for(
        "raw/a.md",
        body="a-v1",
        concepts=[{"name": "Shared", "definition": "from A v1"}],
        claims=[
            {"content": "Obsolete claim only from A", "confidence": 0.9, "conceptKeys": ["shared"]},
            {"content": "Shared supported claim", "confidence": 0.9, "conceptKeys": ["shared"]},
        ],
    )
    m2 = _manifest_for(
        "raw/b.md",
        body="b-v1",
        concepts=[{"name": "Shared", "definition": "from B"}],
        claims=[{"content": "Shared supported claim", "confidence": 0.8, "conceptKeys": ["shared"]}],
    )
    apply_source_revision(topic, m1, force_full_rebuild=True)
    apply_source_revision(topic, m2, force_full_rebuild=True)

    page = (topic / "wiki" / "concepts" / "shared.md").read_text("utf-8")
    assert "Obsolete claim only from A" in page
    assert "Shared supported claim" in page

    # Source A revises: drops obsolete claim, keeps shared claim.
    m1b = _manifest_for(
        "raw/a.md",
        body="a-v2",
        concepts=[{"name": "Shared", "definition": "from A v2"}],
        claims=[{"content": "Shared supported claim", "confidence": 0.9, "conceptKeys": ["shared"]}],
    )
    result = apply_source_revision(topic, m1b, force_full_rebuild=False)
    assert m1["manifestId"] in result.deactivated_manifest_ids
    assert result.activated_manifest_id == m1b["manifestId"]

    page2 = (topic / "wiki" / "concepts" / "shared.md").read_text("utf-8")
    assert "Obsolete claim only from A" not in page2
    assert "Shared supported claim" in page2
    assert "raw/b.md" in page2
    assert "raw/a.md" in page2

    store = load_store(topic)
    active = [m for m in store["manifests"].values() if m["active"]]
    assert len(active) == 2
    assert all(m["sourceId"] != m1["sourceId"] or m["sourceRevision"] == m1b["sourceRevision"] for m in active)


def test_removed_relationship_when_final_supporting_source_removed(tmp_path: Path):
    topic = _topic(tmp_path)
    m1 = _manifest_for(
        "raw/rel.md",
        body="rel-v1",
        concepts=[
            {"name": "Alpha", "definition": "A"},
            {"name": "Beta", "definition": "B"},
        ],
        relationships=[{"from": "Alpha", "type": "depends-on", "to": "Beta"}],
    )
    apply_source_revision(topic, m1, force_full_rebuild=True)
    alpha = (topic / "wiki" / "concepts" / "alpha.md").read_text("utf-8")
    assert "depends-on" in alpha
    assert "Beta" in alpha

    result = remove_source(topic, m1["sourceId"], force_full_rebuild=False)
    assert m1["manifestId"] in result.deactivated_manifest_ids
    assert not (topic / "wiki" / "concepts" / "alpha.md").exists()
    assert not (topic / "wiki" / "concepts" / "beta.md").exists()

    store = load_store(topic)
    assert store["manifests"][m1["manifestId"]]["active"] is False
    assert collect_active_contributions(store) == []


def test_unaffected_projection_byte_stability(tmp_path: Path):
    topic = _topic(tmp_path)
    m_alpha = _manifest_for(
        "raw/alpha.md",
        body="alpha-1",
        concepts=[{"name": "AlphaOnly", "definition": "stable"}],
        claims=[{"content": "Alpha fact", "conceptKeys": ["alphaonly"]}],
    )
    m_beta = _manifest_for(
        "raw/beta.md",
        body="beta-1",
        concepts=[{"name": "BetaOnly", "definition": "changing"}],
        claims=[{"content": "Beta fact v1", "conceptKeys": ["betaonly"]}],
    )
    apply_source_revision(topic, m_alpha, force_full_rebuild=True)
    apply_source_revision(topic, m_beta, force_full_rebuild=True)

    alpha_path = topic / "wiki" / "concepts" / "alphaonly.md"
    beta_path = topic / "wiki" / "concepts" / "betaonly.md"
    alpha_bytes = alpha_path.read_bytes()
    alpha_mtime = alpha_path.stat().st_mtime_ns

    # Ensure mtime can move on platforms with coarse resolution.
    time.sleep(0.02)

    m_beta2 = _manifest_for(
        "raw/beta.md",
        body="beta-2",
        concepts=[{"name": "BetaOnly", "definition": "changed"}],
        claims=[{"content": "Beta fact v2", "conceptKeys": ["betaonly"]}],
    )
    result = apply_source_revision(topic, m_beta2, force_full_rebuild=False)
    assert "betaonly" in result.affected_concepts
    assert "alphaonly" not in result.affected_concepts

    assert alpha_path.read_bytes() == alpha_bytes
    assert alpha_path.stat().st_mtime_ns == alpha_mtime
    beta_text = beta_path.read_text("utf-8")
    assert "changed" in beta_text
    assert "Beta fact v2" in beta_text
    assert "Beta fact v1" not in beta_text


def test_contradiction_resolution_rebuilds_from_active_set(tmp_path: Path):
    topic = _topic(tmp_path)
    m1 = _manifest_for(
        "raw/one.md",
        body="one",
        concepts=[{"name": "Topic", "definition": "t"}],
        claims=[{"content": "The system is always online", "conceptKeys": ["topic"]}],
    )
    m2 = _manifest_for(
        "raw/two.md",
        body="two",
        concepts=[{"name": "Topic", "definition": "t"}],
        claims=[{"content": "The system is never online", "conceptKeys": ["topic"]}],
        contradictions=[
            {
                "claimA": "The system is always online",
                "claimB": "The system is never online",
                "severity": "direct",
                "sourcePathA": "raw/one.md",
                "sourcePathB": "raw/two.md",
                "conceptKeys": ["topic"],
            }
        ],
    )
    apply_source_revision(topic, m1, force_full_rebuild=True)
    apply_source_revision(topic, m2, force_full_rebuild=True)
    contra = (topic / "wiki" / "_contradictions.md").read_text("utf-8")
    assert "always online" in contra
    assert "never online" in contra

    # Remove source two: contradiction observation leaves with its manifest.
    remove_source(topic, m2["sourceId"], force_full_rebuild=False)
    contra2 = (topic / "wiki" / "_contradictions.md").read_text("utf-8")
    assert "always online" not in contra2
    assert "never online" not in contra2
    assert "_(none)_" in contra2 or PROVENANCE_MARKER in contra2


def test_disable_source_revision_preserves_other_active_sources(tmp_path: Path):
    topic = _topic(tmp_path)
    m_keep = _manifest_for(
        "raw/keep.md",
        body="keep",
        concepts=[{"name": "Node", "definition": "kept"}],
        claims=[{"content": "Keep claim", "conceptKeys": ["node"]}],
    )
    m_drop = _manifest_for(
        "raw/drop.md",
        body="drop",
        concepts=[{"name": "Node", "definition": "dropped def"}],
        claims=[{"content": "Drop claim", "conceptKeys": ["node"]}],
    )
    apply_source_revision(topic, m_keep, force_full_rebuild=True)
    apply_source_revision(topic, m_drop, force_full_rebuild=True)

    disable_source_revision(
        topic,
        m_drop["sourceId"],
        m_drop["sourceRevision"],
        force_full_rebuild=False,
    )
    page = (topic / "wiki" / "concepts" / "node.md").read_text("utf-8")
    assert "Keep claim" in page
    assert "Drop claim" not in page
    store = load_store(topic)
    assert store["manifests"][m_keep["manifestId"]]["active"] is True
    assert store["manifests"][m_drop["manifestId"]]["active"] is False


def test_legacy_unknown_provenance_blocks_destructive_retraction(tmp_path: Path):
    topic = _topic(tmp_path)
    legacy = topic / "wiki" / "concepts" / "legacy.md"
    legacy.write_text("# Legacy\n\nNo provenance.\n", encoding="utf-8")

    findings = detect_unknown_provenance(topic)
    assert any(f.path == "concepts/legacy.md" for f in findings)
    report = report_legacy_provenance(topic)
    assert report["status"] == "unknown-provenance"
    assert report["diagnosticCode"] == "LEGACY_UNKNOWN_PROVENANCE"

    # Managed compile for a different concept is fine with force.
    m_other = _manifest_for(
        "raw/other.md",
        body="other",
        concepts=[{"name": "Other", "definition": "ok"}],
    )
    apply_source_revision(topic, m_other, force_full_rebuild=True)

    # Touching the legacy concept without force is blocked.
    m_legacy = _manifest_for(
        "raw/legacy-src.md",
        body="legacy-src",
        concepts=[{"name": "Legacy", "definition": "attempted"}],
    )
    with pytest.raises(DestructiveRetractionBlocked) as exc:
        apply_source_revision(topic, m_legacy, force_full_rebuild=False)
    assert exc.value.code == "LEGACY_UNKNOWN_PROVENANCE"
    assert any(b["path"] == "concepts/legacy.md" for b in exc.value.data["blocking"])

    # Full-rebuild gate allows overwrite.
    apply_source_revision(topic, m_legacy, force_full_rebuild=True)
    text = legacy.read_text("utf-8")
    assert PROVENANCE_MARKER in text
    assert "attempted" in text


def test_compile_extractions_fail_closed_on_legacy_unknown_provenance(tmp_path: Path):
    topic = _topic(tmp_path)
    legacy = topic / "wiki" / "concepts" / "legacy.md"
    legacy.write_text("# Legacy\n\nNo provenance.\n", encoding="utf-8")
    extraction = SimpleNamespace(
        summary="legacy summary",
        concepts=[{"name": "Legacy", "definition": "replacement"}],
        claims=[],
        relationships=[],
        chunk=SimpleNamespace(heading="Overview"),
    )

    with pytest.raises(DestructiveRetractionBlocked) as exc:
        apply_compile_extractions(
            topic,
            {"raw/legacy-src.md": [extraction]},
            source_revisions={"raw/legacy-src.md": "sha256:test-revision"},
        )

    assert exc.value.code == "LEGACY_UNKNOWN_PROVENANCE"
    assert legacy.read_text("utf-8") == "# Legacy\n\nNo provenance.\n"


def test_closure_and_rebuild_use_complete_active_set(tmp_path: Path):
    topic = _topic(tmp_path)
    m1 = _manifest_for(
        "raw/s1.md",
        body="s1",
        concepts=[{"name": "Gamma", "definition": "g1"}],
        claims=[{"content": "C1", "conceptKeys": ["gamma"]}],
    )
    m2 = _manifest_for(
        "raw/s2.md",
        body="s2",
        concepts=[{"name": "Gamma", "definition": "g2"}],
        claims=[{"content": "C2", "conceptKeys": ["gamma"]}],
    )
    apply_source_revision(topic, m1, force_full_rebuild=True)
    apply_source_revision(topic, m2, force_full_rebuild=True)
    store = load_store(topic)
    closure = compute_affected_topic_closure(
        m1["affectedConceptKeys"], m2["affectedConceptKeys"]
    )
    assert closure == frozenset({"gamma"})
    projections = rebuild_projections_from_active(store, affected_concepts=closure)
    content = projections["concepts/gamma.md"]
    assert "C1" in content and "C2" in content
    assert "g1" in content or "g2" in content


def test_atomic_swap_leaves_unlisted_files_untouched(tmp_path: Path):
    topic = _topic(tmp_path)
    keep = topic / "wiki" / "concepts" / "keep.md"
    keep.write_text("# Keep\n", encoding="utf-8")
    before = keep.read_bytes()
    mtime = keep.stat().st_mtime_ns

    m = _manifest_for(
        "raw/x.md",
        body="x",
        concepts=[{"name": "X", "definition": "x def"}],
    )
    apply_source_revision(topic, m, force_full_rebuild=True)
    assert keep.read_bytes() == before
    assert keep.stat().st_mtime_ns == mtime
    assert (topic / "wiki" / "concepts" / "x.md").exists()


def test_atomic_generation_pointer_publishes_one_complete_affected_closure(tmp_path: Path):
    topic = _topic(tmp_path)
    manifest = _manifest_for(
        "raw/published.md",
        body="published",
        concepts=[
            {"name": "Published A", "definition": "a"},
            {"name": "Published B", "definition": "b"},
        ],
        claims=[
            {"content": "A claim", "conceptKeys": ["published-a"]},
            {"content": "B claim", "conceptKeys": ["published-b"]},
        ],
    )
    result = apply_source_revision(topic, manifest, force_full_rebuild=True)
    pointer = __import__("json").loads(current_generation_path(topic).read_text("utf-8"))
    affected = {
        path: entry
        for path, entry in pointer["projections"].items()
        if path in set(result.swap.written + result.swap.unchanged + result.swap.deleted)
    }
    assert affected
    assert {entry["generationId"] for entry in affected.values()} == {result.swap.generation_id}
    for relative_path, entry in affected.items():
        if entry["state"] == "deleted":
            assert read_published_projection(topic, relative_path) is None
        else:
            published = read_published_projection(topic, relative_path)
            assert published == (topic / "wiki" / relative_path).read_bytes()
            staged = (
                topic
                / "wiki"
                / "_llmwiki"
                / "contributions"
                / "generations"
                / result.swap.generation_id
                / "projections"
                / relative_path
            )
            assert staged.read_bytes() == published


def test_pointer_publication_failure_rolls_back_every_compatibility_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    topic = _topic(tmp_path)
    existing = topic / "wiki" / "concepts" / "rollback.md"
    existing.write_bytes(b"before\n")
    original_write = contribution_module.write_text_atomic

    def fail_pointer(path: Path, content: str) -> None:
        if path.name == "current-generation.json":
            raise OSError("injected pointer failure")
        original_write(path, content)

    monkeypatch.setattr(contribution_module, "write_text_atomic", fail_pointer)
    manifest = _manifest_for(
        "raw/rollback.md",
        body="after",
        concepts=[{"name": "Rollback", "definition": "after"}],
    )
    with pytest.raises(OSError, match="injected pointer failure"):
        apply_source_revision(topic, manifest, force_full_rebuild=True)

    assert existing.read_bytes() == b"before\n"
    assert not current_generation_path(topic).exists()
