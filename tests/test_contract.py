"""Tests for compiler.rhizome contract validation.

Run: python -m pytest tests/test_contract.py -v
     (from D:\\workspace\\obsidian-llm-wiki)
"""

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from compiler.rhizome.contract import (
    VALID_KINDS,
    VALID_STATUSES,
    ContractViolation,
    id_from_path,
    is_frozen,
    validate_note,
)
from compiler.rhizome.check import CheckResult, check_file, check_vault
from compiler.rhizome.sources import Domain, discover_domains


# ---------------------------------------------------------------------------
# validate_note
# ---------------------------------------------------------------------------

class TestValidateNote:
    def test_valid_minimal_note(self):
        fm = {"id": "trading/macro-2026", "description": "Macro factor model", "kind": "note"}
        assert validate_note(fm) == []

    def test_valid_decision(self):
        fm = {
            "id": "infra/use-postgres",
            "description": "Use PostgreSQL as primary DB",
            "kind": "decision",
            "status": "frozen",
            "supersedes": ["infra/use-sqlite"],
        }
        assert validate_note(fm) == []

    def test_missing_id_is_warning_not_error(self):
        fm = {"description": "Some note", "kind": "note"}
        violations = validate_note(fm)
        id_v = [v for v in violations if v.field == "id"]
        assert len(id_v) == 1
        assert id_v[0].severity == "warning"

    def test_invalid_id_format_is_error(self):
        fm = {"id": "NO_SLASH", "description": "Bad id", "kind": "note"}
        violations = validate_note(fm)
        assert any(v.field == "id" and v.severity == "error" for v in violations)

    def test_bad_id_variants(self):
        bad_ids = ["NoSlash", "has/UPPER", "double//slash", "/leading", "trailing/"]
        for bad in bad_ids:
            fm = {"id": bad, "description": "x", "kind": "note"}
            violations = validate_note(fm)
            assert any(v.field == "id" and v.severity == "error" for v in violations), \
                f"expected error for id={bad!r}"

    def test_good_id_variants(self):
        good_ids = ["trading/macro-2026", "kb/ontology", "a/b", "my-domain/my-slug"]
        for good in good_ids:
            fm = {"id": good, "description": "x", "kind": "note"}
            violations = validate_note(fm)
            assert not any(v.field == "id" for v in violations), \
                f"unexpected id violation for {good!r}"

    def test_missing_description_is_warning(self):
        fm = {"id": "a/b", "kind": "note"}
        violations = validate_note(fm)
        assert any(v.field == "description" and v.severity == "warning" for v in violations)

    def test_missing_kind_is_error(self):
        fm = {"id": "a/b", "description": "x"}
        violations = validate_note(fm)
        assert any(v.field == "kind" and v.severity == "error" for v in violations)

    def test_invalid_kind_is_error(self):
        fm = {"id": "a/b", "description": "x", "kind": "blog-post"}
        violations = validate_note(fm)
        assert any(v.field == "kind" and v.severity == "error" for v in violations)

    def test_all_valid_kinds_accepted(self):
        for kind in VALID_KINDS:
            fm = {"id": "a/b", "description": "x", "kind": kind}
            violations = validate_note(fm)
            assert not any(v.field == "kind" for v in violations), \
                f"kind {kind!r} should be valid"

    def test_invalid_status_is_error(self):
        fm = {"id": "a/b", "description": "x", "kind": "note", "status": "draft"}
        violations = validate_note(fm)
        assert any(v.field == "status" and v.severity == "error" for v in violations)

    def test_all_valid_statuses_accepted(self):
        for status in VALID_STATUSES:
            fm = {"id": "a/b", "description": "x", "kind": "note", "status": status}
            violations = validate_note(fm)
            assert not any(v.field == "status" for v in violations)

    def test_supersedes_on_non_decision_is_warning(self):
        fm = {"id": "a/b", "description": "x", "kind": "note", "supersedes": ["a/old"]}
        violations = validate_note(fm)
        assert any(v.field == "supersedes" and v.severity == "warning" for v in violations)

    def test_supersedes_on_decision_is_ok(self):
        fm = {"id": "a/b", "description": "x", "kind": "decision", "supersedes": ["a/old"]}
        violations = validate_note(fm)
        assert not any(v.field == "supersedes" for v in violations)

    def test_id_suggestion_includes_path_hint(self):
        path = Path("05-Engineering/rust-ownership.md")
        fm = {"description": "x", "kind": "note"}
        violations = validate_note(fm, path=path)
        id_v = [v for v in violations if v.field == "id"]
        assert id_v and "engineering/rust-ownership" in id_v[0].message


# ---------------------------------------------------------------------------
# is_frozen
# ---------------------------------------------------------------------------

class TestIsFrozen:
    def test_decision_frozen(self):
        assert is_frozen({"kind": "decision", "status": "frozen"}) is True

    def test_decision_active(self):
        assert is_frozen({"kind": "decision", "status": "active"}) is False

    def test_note_with_frozen_status(self):
        assert is_frozen({"kind": "note", "status": "frozen"}) is False

    def test_empty_frontmatter(self):
        assert is_frozen({}) is False


# ---------------------------------------------------------------------------
# id_from_path
# ---------------------------------------------------------------------------

class TestIdFromPath:
    def test_numbered_dir(self):
        assert id_from_path(Path("05-Engineering/rust-ownership.md")) == "engineering/rust-ownership"

    def test_plain_dir(self):
        assert id_from_path(Path("KB/ontology.md")) == "kb/ontology"

    def test_single_file(self):
        result = id_from_path(Path("note.md"))
        assert "/" in result

    def test_special_chars_replaced_with_hyphens(self):
        result = id_from_path(Path("My Dir/My Note!.md"))
        assert re.match(r"^[a-z0-9-]+/[a-z0-9-]+$", result)

    def test_none_returns_placeholder(self):
        assert id_from_path(None) == "domain/slug"


# ---------------------------------------------------------------------------
# check_file
# ---------------------------------------------------------------------------

class TestCheckFile:
    def test_clean_file(self, tmp_path):
        f = tmp_path / "note.md"
        f.write_text(
            "---\nid: trading/macro\ndescription: A macro note\nkind: note\n---\n\nBody.\n",
            encoding="utf-8",
        )
        result = check_file(f, tmp_path)
        assert not result.has_errors
        assert not result.has_warnings

    def test_file_with_bad_id_format(self, tmp_path):
        f = tmp_path / "bad.md"
        f.write_text("---\nid: BADID\ndescription: x\nkind: note\n---\n", encoding="utf-8")
        result = check_file(f, tmp_path)
        assert result.has_errors

    def test_no_frontmatter_gives_violations(self, tmp_path):
        f = tmp_path / "plain.md"
        f.write_text("# Just a heading\n\nNo frontmatter.\n", encoding="utf-8")
        result = check_file(f, tmp_path)
        assert result.has_warnings or result.has_errors

    def test_missing_file(self, tmp_path):
        result = check_file(tmp_path / "ghost.md")
        assert result.has_errors

    def test_derived_id_populated(self, tmp_path):
        f = tmp_path / "note.md"
        f.write_text(
            "---\nid: trading/macro\ndescription: x\nkind: note\n---\n",
            encoding="utf-8",
        )
        result = check_file(f, tmp_path)
        assert result.derived_id == "trading/macro"


# ---------------------------------------------------------------------------
# check_vault — frozen invariant
# ---------------------------------------------------------------------------

class TestFrozenInvariant:
    def test_staging_frozen_decision_is_blocked(self, tmp_path):
        f = tmp_path / "decision.md"
        f.write_text(
            "---\nid: infra/use-pg\ndescription: Use Postgres\nkind: decision\nstatus: frozen\n---\n",
            encoding="utf-8",
        )
        results = check_vault(tmp_path, staged_files=[f])
        assert results[0].frozen_modified is True
        assert any(v.field == "frozen" and v.severity == "error" for v in results[0].violations)

    def test_staging_active_decision_is_allowed(self, tmp_path):
        f = tmp_path / "decision.md"
        f.write_text(
            "---\nid: infra/use-pg\ndescription: Use Postgres\nkind: decision\nstatus: active\n---\n",
            encoding="utf-8",
        )
        results = check_vault(tmp_path, staged_files=[f])
        assert results[0].frozen_modified is False
        assert not any(v.field == "frozen" for v in results[0].violations)

    def test_full_vault_scan(self, tmp_path):
        (tmp_path / "a.md").write_text(
            "---\nid: a/note\ndescription: x\nkind: note\n---\n", encoding="utf-8"
        )
        (tmp_path / "b.md").write_text(
            "---\nid: b/note\ndescription: y\nkind: research\n---\n", encoding="utf-8"
        )
        results = check_vault(tmp_path)
        assert len(results) == 2
        assert not any(r.has_errors for r in results)


# ---------------------------------------------------------------------------
# discover_domains
# ---------------------------------------------------------------------------

class TestDiscoverDomains:
    def test_finds_index_md_domains(self, tmp_path):
        eng = tmp_path / "05-Engineering"
        eng.mkdir()
        (eng / "INDEX.md").write_text(
            "---\nid: engineering/index\ndescription: Engineering domain\nkind: index\n---\n",
            encoding="utf-8",
        )
        domains = discover_domains(tmp_path)
        assert "engineering" in [d.name for d in domains]

    def test_fallback_to_top_level_numbered_dirs(self, tmp_path):
        (tmp_path / "01-Projects").mkdir()
        domains = discover_domains(tmp_path)
        assert "projects" in [d.name for d in domains]

    def test_skips_hidden_and_system_dirs(self, tmp_path):
        for d in [".obsidian", ".git", "node_modules"]:
            (tmp_path / d).mkdir()
        domains = discover_domains(tmp_path)
        names = [d.name for d in domains]
        assert "obsidian" not in names
        assert "git" not in names
        assert "node-modules" not in names
