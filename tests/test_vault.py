from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from llmwiki_vault.contract import validate_ingest_output
from llmwiki_vault.domain import EvidenceRecord, SourceRecord, VaultIndexSnapshot
from llmwiki_vault.lint import lint_vault
from llmwiki_vault.markdown import render_markdown
from llmwiki_vault.read import (
    read_evidence_record,
    read_source_record,
    read_vault_index,
    render_evidence_record,
    render_source_record,
)
from llmwiki_vault.scaffold import init_vault


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def source_note(source_id: str = "source-1", **overrides) -> str:
    data = {
        "id": source_id,
        "platform": "web",
        "source_kind": "document",
        "raw_url": "https://example.com/raw",
        "canonical_url": f"https://example.com/{source_id}",
        "provider": "test-provider",
        "pipeline": "test-pipeline",
        "status": "supported",
        "artifact_paths": [f".raw/web/{source_id}.md"],
        "evidence_notes": [f"evidence-{source_id}"],
        "fetched_at": "2026-07-01T00:00:00+00:00",
        "limitations": [],
        "schema_version": 1,
    }
    data.update(overrides)
    return render_markdown(data, f"# {source_id}\n")


def evidence_note(source_id: str = "source-1", evidence_id: str | None = None, **overrides) -> str:
    evidence_id = evidence_id or f"evidence-{source_id}"
    data = {
        "id": evidence_id,
        "source_id": source_id,
        "provider": "test-provider",
        "artifact_paths": [f".raw/web/{source_id}.md"],
        "captured_at": "2026-07-01T00:00:00+00:00",
        "generated_by": "pytest",
        "limitations": [],
        "schema_version": 1,
    }
    data.update(overrides)
    return render_markdown(data, f"# {evidence_id}\n")


def make_good_vault(tmp_path: Path) -> Path:
    root = tmp_path / "vault"
    init_vault(root)
    write(root / ".raw/web/source-1.md", "# artifact\n")
    write(root / "sources/source-1.md", source_note())
    write(root / "evidence/evidence-source-1.md", evidence_note())
    init_vault(root)
    return root


def test_init_empty_vault_and_idempotent(tmp_path: Path) -> None:
    root = tmp_path / "vault"
    first = init_vault(root)
    second = init_vault(root)

    assert (root / "sources/index.md").exists()
    assert (root / "templates/source.md").exists()
    assert (root / "wiki/hot.md").exists()
    assert first.created
    assert not second.updated
    assert not second.errors


def test_init_dry_run_writes_nothing(tmp_path: Path) -> None:
    root = tmp_path / "vault"
    report = init_vault(root, dry_run=True)

    assert report.created
    assert not root.exists()


def test_existing_partial_vault_is_completed(tmp_path: Path) -> None:
    root = tmp_path / "vault"
    (root / "sources").mkdir(parents=True)

    report = init_vault(root)

    assert not report.errors
    assert (root / "evidence").exists()
    assert (root / "views/dashboard.md").exists()


def test_lint_good_vault_has_only_optional_infos(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)

    report = lint_vault(root)

    assert report.errors == []
    assert report.warnings == []
    assert {issue.path for issue in report.infos} == {"views/dashboard.base", "views/source-map.canvas"}


def test_lint_missing_source_note_is_error(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    (root / "sources/source-1.md").unlink()

    report = lint_vault(root)

    assert any("source note is missing" in issue.message for issue in report.errors)


def test_lint_broken_evidence_link_is_error(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    write(root / "sources/source-1.md", source_note(evidence_notes=["missing-evidence"]))

    report = lint_vault(root)

    assert any("evidence note is missing" in issue.message for issue in report.errors)


def test_lint_path_escape_is_error(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    write(root / "evidence/evidence-source-1.md", evidence_note(artifact_paths=["../outside.md"]))

    report = lint_vault(root)

    assert any("escapes vault" in issue.message for issue in report.errors)


def test_lint_absolute_outside_path_is_error(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    outside = tmp_path / "outside.md"
    write(root / "evidence/evidence-source-1.md", evidence_note(artifact_paths=[str(outside)]))

    report = lint_vault(root)

    assert any("absolute paths are not allowed" in issue.message for issue in report.errors)


def test_lint_broken_artifact_path_requires_reason(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    write(root / "evidence/evidence-source-1.md", evidence_note(artifact_paths=[".raw/web/missing.md"]))

    report = lint_vault(root)

    assert any("artifact path is missing without reason" in issue.message for issue in report.errors)


def test_lint_stale_hot_cache_warning_or_release_error(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    old = (datetime.now(timezone.utc) - timedelta(days=2)).replace(microsecond=0).isoformat()
    hot = render_markdown(
        {
            "generated_at": old,
            "source_window": "recent",
            "max_items": 20,
            "stale_after": "24h",
            "source_links": ["../sources/source-1.md"],
            "schema_version": 1,
        },
        "# Hot Cache\n",
    )
    write(root / "wiki/hot.md", hot)

    normal = lint_vault(root)
    release = lint_vault(root, release_check=True)

    assert any("stale" in issue.message for issue in normal.warnings)
    assert any("stale" in issue.message for issue in release.errors)


def test_unsupported_source_is_warning(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    write(root / "sources/source-1.md", source_note(status="unsupported", canonical_url="", artifact_paths=[]))
    write(root / "evidence/evidence-source-1.md", evidence_note(artifact_paths=[], missing_artifact_reason="unsupported source"))

    report = lint_vault(root)

    assert not report.errors
    assert any("unsupported" in issue.message for issue in report.warnings)


def test_duplicate_canonical_url_requires_conflict(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    write(root / ".raw/web/source-2.md", "# artifact\n")
    write(root / "sources/source-2.md", source_note("source-2", canonical_url="https://example.com/source-1", evidence_notes=["evidence-source-2"]))
    write(root / "evidence/evidence-source-2.md", evidence_note("source-2"))

    report = lint_vault(root)

    assert any("duplicate canonical_url" in issue.message for issue in report.errors)


def test_duplicate_canonical_url_with_conflict_passes(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    write(root / ".raw/web/source-2.md", "# artifact\n")
    write(
        root / "sources/source-2.md",
        source_note("source-2", canonical_url="https://example.com/source-1", status="conflict", evidence_notes=["evidence-source-2"]),
    )
    write(root / "evidence/evidence-source-2.md", evidence_note("source-2"))

    report = lint_vault(root)

    assert not any("duplicate canonical_url" in issue.message for issue in report.errors)


def test_ingest_output_contract_supported_passes(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    contract = render_markdown(
        {
            "contract": "llmwiki.ingest.output",
            "version": 1,
            "source_status": "supported",
            "required_outputs": ["sources/source-1.md", "evidence/evidence-source-1.md"],
            "artifact_paths": [".raw/web/source-1.md"],
            "search_expectations": ["source id discoverable", "evidence id discoverable"],
        },
        "# Contract\n",
    )
    write(root / "meta/ingest-source-1.md", contract)

    report = validate_ingest_output(root / "meta/ingest-source-1.md", vault_root=root)

    assert report.errors == []


def test_ingest_output_blocked_auth_requires_missing_reason(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    contract = render_markdown(
        {
            "contract": "llmwiki.ingest.output",
            "version": 1,
            "source_status": "blocked_auth",
            "required_outputs": ["sources/source-1.md", "evidence/evidence-source-1.md"],
            "artifact_paths": [],
            "search_expectations": [],
        },
        "# Contract\n",
    )
    write(root / "meta/ingest-source-1.md", contract)

    report = validate_ingest_output(root / "meta/ingest-source-1.md", vault_root=root)

    assert any("missing_artifact_reason" in issue.message or "artifact_paths" in issue.message for issue in report.errors)


def test_ingest_output_partial_allows_missing_artifact_reason(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    contract = render_markdown(
        {
            "contract": "llmwiki.ingest.output",
            "version": 1,
            "source_status": "partial",
            "required_outputs": ["sources/source-1.md", "evidence/evidence-source-1.md"],
            "artifact_paths": [],
            "missing_artifact_reason": "provider did not return media transcript",
            "search_expectations": [],
        },
        "# Contract\n",
    )
    write(root / "meta/ingest-source-1.md", contract)

    report = validate_ingest_output(root / "meta/ingest-source-1.md", vault_root=root)

    assert report.errors == []




def test_domain_records_round_trip_frontmatter() -> None:
    source = SourceRecord.from_frontmatter(
        {
            "id": "source-1",
            "platform": "web",
            "source_kind": "document",
            "raw_url": "https://example.com/raw",
            "canonical_url": "https://example.com/source-1",
            "provider": "test-provider",
            "pipeline": "test-pipeline",
            "status": "supported",
            "artifact_paths": [".raw/web/source-1.md"],
            "evidence_notes": ["evidence-source-1"],
            "fetched_at": "2026-07-01T00:00:00+00:00",
            "limitations": [],
            "schema_version": 1,
        }
    )
    evidence = EvidenceRecord.from_frontmatter(
        {
            "id": "evidence-source-1",
            "source_id": "source-1",
            "provider": "test-provider",
            "artifact_paths": ".raw/web/source-1.md",
            "captured_at": "2026-07-01T00:00:00+00:00",
            "generated_by": "pytest",
            "limitations": "",
            "schema_version": "1",
        }
    )

    assert source.to_frontmatter()["evidence_notes"] == ["evidence-source-1"]
    assert evidence.artifact_paths == (".raw/web/source-1.md",)
    assert evidence.to_frontmatter()["schema_version"] == 1


def test_vault_index_snapshot_sorts_and_indexes_records() -> None:
    source_b = SourceRecord.from_frontmatter({"id": "source-b"})
    source_a = SourceRecord.from_frontmatter({"id": "source-a"})
    evidence = EvidenceRecord.from_frontmatter({"id": "evidence-a", "source_id": "source-a"})

    snapshot = VaultIndexSnapshot.from_records([source_b, source_a], [evidence])

    assert [record.id for record in snapshot.sources] == ["source-a", "source-b"]
    assert snapshot.source_by_id["source-a"] == source_a
    assert snapshot.evidence_by_id["evidence-a"].source_id == "source-a"




def test_read_api_reads_rendered_records(tmp_path: Path) -> None:
    source = SourceRecord.from_frontmatter(
        {
            "id": "source-1",
            "platform": "web",
            "source_kind": "document",
            "raw_url": "https://example.com/raw",
            "canonical_url": "https://example.com/source-1",
            "provider": "test-provider",
            "pipeline": "test-pipeline",
            "status": "supported",
            "artifact_paths": [".raw/web/source-1.md"],
            "evidence_notes": ["evidence-source-1"],
            "fetched_at": "2026-07-01T00:00:00+00:00",
            "limitations": [],
            "schema_version": 1,
        }
    )
    evidence = EvidenceRecord.from_frontmatter(
        {
            "id": "evidence-source-1",
            "source_id": "source-1",
            "provider": "test-provider",
            "artifact_paths": [".raw/web/source-1.md"],
            "captured_at": "2026-07-01T00:00:00+00:00",
            "generated_by": "pytest",
            "limitations": [],
            "schema_version": 1,
        }
    )
    source_path = tmp_path / "source.md"
    evidence_path = tmp_path / "evidence.md"
    write(source_path, render_source_record(source, "# Source\n"))
    write(evidence_path, render_evidence_record(evidence, "# Evidence\n"))

    assert read_source_record(source_path) == source
    assert read_evidence_record(evidence_path) == evidence


def test_read_vault_index_returns_snapshot(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)

    result = read_vault_index(root)

    snapshot = result.require_clean()
    assert result.issues == ()
    assert list(snapshot.source_by_id) == ["source-1"]
    assert snapshot.evidence_by_id["evidence-source-1"].source_id == "source-1"


def test_read_vault_index_reports_invalid_note(tmp_path: Path) -> None:
    root = make_good_vault(tmp_path)
    write(root / "sources" / "bad.md", "# Missing frontmatter\n")

    result = read_vault_index(root)

    assert any(issue.path == "sources/bad.md" for issue in result.issues)
    assert "source-1" in result.snapshot.source_by_id
