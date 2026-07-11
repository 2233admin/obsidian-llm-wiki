"""Tests for semantic similarity matching."""
import pytest
from pathlib import Path

# obc/semantic.py is an optional feature (resolver.py imports it lazily inside a
# try/except and treats failures as "semantic matching is optional"); sklearn is
# not a declared project dependency, so skip this whole module cleanly instead
# of erroring out pytest collection when it isn't installed.
pytest.importorskip("sklearn")
from obc.semantic import suggest_similar, SimilarNote  # noqa: E402


class TestSuggestSimilar:
    """Test suggest_similar function."""

    def test_returns_candidates(self, tmp_path):
        """Should return list of similar notes."""
        # Create notes
        (tmp_path / "ai-agent.md").write_text("# AI Agent\n\nAn autonomous agent.")
        (tmp_path / "llm-overview.md").write_text("# LLM Overview\n\nLarge language models.")
        (tmp_path / "unrelated.md").write_text("# Cooking\n\nHow to cook rice.")

        candidates = suggest_similar("ai-agent", tmp_path)

        assert len(candidates) > 0, "Should return at least one candidate"
        assert all(isinstance(c, SimilarNote) for c in candidates)

    def test_deduplicates(self, tmp_path):
        """Should not return duplicate candidates."""
        (tmp_path / "ai-agent.md").write_text("# AI Agent")
        (tmp_path / "agent-ai.md").write_text("# Agent AI")

        candidates = suggest_similar("ai-agent", tmp_path)

        paths = [c.path for c in candidates]
        assert len(paths) == len(set(paths)), "Should not have duplicate paths"

    def test_returns_similarity_scores(self, tmp_path):
        """Should return similarity scores between 0 and 1."""
        (tmp_path / "ai-agent.md").write_text("# AI Agent\n\nAn autonomous agent.")

        candidates = suggest_similar("ai-agent", tmp_path)

        for c in candidates:
            assert 0.0 <= c.similarity <= 1.0, "Similarity should be 0-1"


class TestSimilarNote:
    """Test SimilarNote dataclass."""

    def test_to_dict(self, tmp_path):
        """Should serialize to dict."""
        note = SimilarNote(
            path=Path("test.md"),
            stem="test",
            similarity=0.85,
        )

        data = note.to_dict()
        assert "path" in data
        assert "stem" in data
        assert "similarity" in data
