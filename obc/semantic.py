"""
Semantic Similarity - Find similar notes using TF-IDF embeddings.

Uses sklearn TF-IDF for lightweight semantic matching without heavy dependencies.
Supports caching for performance.
"""

from __future__ import annotations

import os
import pickle
from dataclasses import dataclass, field
from pathlib import Path
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


@dataclass
class SimilarNote:
    """A note similar to the query."""
    path: Path
    stem: str
    similarity: float

    def to_dict(self) -> dict:
        return {
            "path": str(self.path),
            "stem": self.stem,
            "similarity": round(self.similarity, 3),
        }


@dataclass
class SemanticIndex:
    """Cached TF-IDF index for a vault."""
    vault_path: Path
    file_paths: list[Path] = field(default_factory=list)
    tfidf_matrix: object = None  # sklearn sparse matrix
    vectorizer: TfidfVectorizer = None

    def save(self, cache_path: Path | None = None) -> None:
        """Save index to disk cache."""
        if cache_path is None:
            cache_path = self.vault_path / ".obc_semantic_cache.pkl"
        with open(cache_path, 'wb') as f:
            pickle.dump({
                'file_paths': self.file_paths,
                'tfidf_matrix': self.tfidf_matrix,
                'vectorizer': self.vectorizer,
            }, f)

    @classmethod
    def load(cls, vault_path: Path) -> 'SemanticIndex | None':
        """Load index from disk cache if valid."""
        cache_path = vault_path / ".obc_semantic_cache.pkl"
        if not cache_path.exists():
            return None
        # Check if vault is newer than cache
        vault_mtime = max(f.stat().st_mtime for f in vault_path.rglob("*.md") if f.is_file()) if any(vault_path.rglob("*.md")) else 0
        cache_mtime = cache_path.stat().st_mtime
        if vault_mtime > cache_mtime:
            return None  # Vault is newer
        try:
            with open(cache_path, 'rb') as f:
                data = pickle.load(f)
            index = cls(vault_path=vault_path)
            index.file_paths = data['file_paths']
            index.tfidf_matrix = data['tfidf_matrix']
            index.vectorizer = data['vectorizer']
            return index
        except Exception:
            return None

    def query(self, query: str, top_k: int = 5) -> list[SimilarNote]:
        """Query the index for similar notes."""
        if self.tfidf_matrix is None or self.vectorizer is None:
            return []
        query_vec = self.vectorizer.transform([query])
        similarities = cosine_similarity(query_vec, self.tfidf_matrix)[0]
        results = []
        for idx, sim in enumerate(similarities):
            if sim > 0.05:  # Threshold
                results.append(SimilarNote(
                    path=self.file_paths[idx],
                    stem=self.file_paths[idx].stem,
                    similarity=float(sim),
                ))
        results.sort(key=lambda x: x.similarity, reverse=True)
        return results[:top_k]


# Global cache
_semantic_cache: dict[str, SemanticIndex] = {}


def suggest_similar(
    query: str,
    vault: Path,
    top_k: int = 5,
    min_similarity: float = 0.1,
    use_cache: bool = True,
) -> list[SimilarNote]:
    """
    Find notes similar to the query using TF-IDF.

    Args:
        query: The broken link target (e.g., "ai-agent")
        vault: Path to vault root
        top_k: Maximum number of candidates to return
        min_similarity: Minimum similarity threshold (0-1)
        use_cache: Use disk cache for faster repeated queries

    Returns:
        List of SimilarNote objects sorted by similarity
    """
    vault_key = str(vault.resolve())

    # Try cache first
    if use_cache and vault_key in _semantic_cache:
        index = _semantic_cache[vault_key]
        return index.query(query, top_k)

    # Try disk cache
    if use_cache:
        index = SemanticIndex.load(vault)
        if index:
            _semantic_cache[vault_key] = index
            return index.query(query, top_k)

    # Build new index
    index = _build_index(vault)
    if index:
        index.save()
        _semantic_cache[vault_key] = index
        return index.query(query, top_k)

    return []


def _build_index(vault: Path) -> SemanticIndex | None:
    """Build TF-IDF index for vault."""
    # Collect all notes
    notes: list[tuple[Path, str]] = []
    for md_file in vault.rglob("*.md"):
        # Skip certain folders
        rel = md_file.relative_to(vault)
        if any(part.startswith('.') for part in rel.parts):
            continue
        if any(part in {'Logs', '.trash', '.scratch', 'node_modules', '09-Archive'} for part in rel.parts):
            continue
        content = _read_note_content(md_file)
        if content.strip():
            notes.append((md_file, content))

    if not notes:
        return None

    file_paths = [n[0] for n in notes]
    texts = [n[1] for n in notes]

    # TF-IDF vectorization with reduced vocabulary for speed
    vectorizer = TfidfVectorizer(
        stop_words='english',
        ngram_range=(1, 1),  # Unigrams only for speed
        max_features=3000,  # Reduced for speed
        min_df=1,  # Term must appear in at least 1 doc
    )

    try:
        tfidf_matrix = vectorizer.fit_transform(texts)
    except Exception:
        return None

    index = SemanticIndex(vault_path=vault)
    index.file_paths = file_paths
    index.tfidf_matrix = tfidf_matrix
    index.vectorizer = vectorizer
    return index


def _read_note_content(file_path: Path) -> str:
    """Read note content, extracting title and first paragraph."""
    try:
        content = file_path.read_text(encoding='utf-8', errors='ignore')
        # Skip frontmatter
        if content.startswith('---'):
            end = content.find('\n---\n', 4)
            if end > 0:
                content = content[end + 4:]
        return content
    except Exception:
        return ""
