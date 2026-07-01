"""Tests for fix planner (PR3)."""
import pytest
import json
from pathlib import Path
from obc.planner import FixPlanner, FixPlan, FixCandidate
from obc.resolver import Diagnostic, DiagnosticCode
from obc.extract import LinkRef, LinkKind


def make_diagnostic(code, target_raw="Target", candidates=None, suggested_fix=None, safety_level="S0"):
    """Create a test diagnostic."""
    link = LinkRef(
        id="test_0",
        source_file=Path("test.md"),
        kind=LinkKind.WIKILINK,
        raw_text=f"[[{target_raw}]]",
        byte_start=0,
        byte_end=len(f"[[{target_raw}]]"),
        line=1,
        column=1,
        target_raw=target_raw,
        target_path_part=target_raw,
        fragment=None,
        alias=None,
    )

    from obc.index import FileEntry
    target = FileEntry(
        path=Path("Target.md"),
        normalized_path="Target.md",
        stem="Target",
        basename="Target.md",
        ext=".md",
        content_hash="abc123",
    )

    return Diagnostic(
        code=code,
        link=link,
        candidates=candidates or [],
        suggested_fix=suggested_fix,
        safety_level=safety_level,
    )


class TestFixPlanner:
    """Test FixPlanner class."""

    def test_plan_empty(self):
        """Should handle empty diagnostics."""
        planner = FixPlanner()
        plan = planner.plan([])

        assert plan.total_diagnostics == 0
        assert len(plan.safe_fixes) == 0
        assert len(plan.review_fixes) == 0
        assert len(plan.unfixable) == 0

    def test_plan_ok_diagnostics(self):
        """Should ignore OK diagnostics."""
        planner = FixPlanner()
        diags = [
            make_diagnostic(DiagnosticCode.OK_EXACT),
            make_diagnostic(DiagnosticCode.OK_UNIQUE_BY_BASENAME),
        ]
        plan = planner.plan(diags)

        assert len(plan.safe_fixes) == 0
        assert len(plan.review_fixes) == 0
        assert len(plan.unfixable) == 0

    def test_plan_broken_with_candidates(self):
        """Should create review fix for broken link with candidates."""
        planner = FixPlanner()

        from obc.index import FileEntry
        target = FileEntry(
            path=Path("Target.md"),
            normalized_path="Target.md",
            stem="Target",
            basename="Target.md",
            ext=".md",
            content_hash="abc123",
        )

        diag = make_diagnostic(
            DiagnosticCode.FUZZY_MATCH,
            target_raw="Targer",  # Typo
            candidates=[target],
            suggested_fix="[[Target]]",
            safety_level="S2",
        )

        plan = planner.plan([diag])

        assert len(plan.safe_fixes) == 0
        assert len(plan.review_fixes) == 1
        assert plan.review_fixes[0].safety_level == "S2"

    def test_plan_broken_no_candidates(self):
        """Should mark as unfixable when no candidates."""
        planner = FixPlanner()
        diag = make_diagnostic(DiagnosticCode.BROKEN_CERTAIN, target_raw="Unknown")
        plan = planner.plan([diag])

        assert len(plan.unfixable) == 1
        assert plan.unfixable[0]["code"] == "BROKEN_CERTAIN"

    def test_to_dict(self):
        """Should serialize to dict correctly."""
        planner = FixPlanner()
        plan = planner.plan([])

        data = plan.to_dict()

        assert "version" in data
        assert "summary" in data
        assert "safe_fixes" in data
        assert "review_fixes" in data
        assert "unfixable" in data


class TestFixCandidate:
    """Test FixCandidate class."""

    def test_to_dict(self):
        """Should serialize to dict correctly."""
        from obc.index import FileEntry
        target = FileEntry(
            path=Path("Target.md"),
            normalized_path="Target.md",
            stem="Target",
            basename="Target.md",
            ext=".md",
            content_hash="abc123",
        )

        link = LinkRef(
            id="test_0",
            source_file=Path("test.md"),
            kind=LinkKind.WIKILINK,
            raw_text="[[Targer]]",
            byte_start=0,
            byte_end=10,
            line=1,
            column=1,
            target_raw="Targer",
            target_path_part="Targer",
            fragment=None,
            alias=None,
        )

        diag = Diagnostic(
            code=DiagnosticCode.FUZZY_MATCH,
            link=link,
            candidates=[target],
        )

        candidate = FixCandidate(
            diagnostic=diag,
            safety_level="S2",
            old_text="[[Targer]]",
            new_text="[[Target]]",
            source_file=Path("test.md"),
            line=1,
            reason="Fuzzy match found",
            target_path="Target.md",
        )

        data = candidate.to_dict()

        assert data["safety_level"] == "S2"
        assert data["old_text"] == "[[Targer]]"
        assert data["new_text"] == "[[Target]]"
        assert data["target_path"] == "Target.md"


class TestApplyFixes:
    """Test apply_fixes method."""

    def test_dry_run_does_not_modify(self, tmp_path):
        """Should not modify files in dry run."""
        # Create test file
        test_file = tmp_path / "test.md"
        test_file.write_text("[[Targer]] is broken")

        # Create plan
        from obc.index import FileEntry
        target = FileEntry(
            path=Path("Target.md"),
            normalized_path="Target.md",
            stem="Target",
            basename="Target.md",
            ext=".md",
            content_hash="abc123",
        )

        link = LinkRef(
            id="test_0",
            source_file=test_file,
            kind=LinkKind.WIKILINK,
            raw_text="[[Targer]]",
            byte_start=0,
            byte_end=10,
            line=1,
            column=1,
            target_raw="Targer",
            target_path_part="Targer",
            fragment=None,
            alias=None,
        )

        diag = Diagnostic(
            code=DiagnosticCode.FUZZY_MATCH,
            link=link,
            candidates=[target],
        )

        plan = FixPlan()
        plan.review_fixes.append(FixCandidate(
            diagnostic=diag,
            safety_level="S2",
            old_text="[[Targer]]",
            new_text="[[Target]]",
            source_file=test_file,
            line=1,
            reason="Fuzzy match",
            target_path="Target.md",
        ))

        # Apply with dry run
        planner = FixPlanner()
        modified, errors = planner.apply_fixes(plan, dry_run=True)

        # File should not be modified
        assert test_file.read_text() == "[[Targer]] is broken"
        assert len(modified) == 0
