#!/usr/bin/env python3
"""KB auto-orchestration pipeline.

Usage:
    python compile.py <vault_topic_path> [--tier haiku|sonnet|opus] [--dry-run]
                      [--chunk-size N] [--chunk-overlap N]
                      [--base-url URL] [--api-key KEY]

Environment variables:
    OPENAI_API_KEY   (or ANTHROPIC_API_KEY) -- API key
    OPENAI_BASE_URL  -- base URL for OpenAI-compatible API (default: https://api.openai.com/v1)
    COMPILE_MODEL    -- override model name directly

Pipeline:
    raw/ -> [diff] -> [chunk] -> [extract] -> [merge] -> [write] -> [index] -> [report]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from chunker import chunk_file
from extractor import ExtractionResult, extract_chunk, resolve_model, resolve_provider_url
from models import Claim, CompileReport, Contradiction

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _slugify(name: str) -> str:
    """Convert a concept name to a filesystem-safe slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug)
    return slug.strip("-")[:80]


def _today() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")


def _run_kb_meta(vault: str, topic: str, *extra_args: str) -> dict:
    """Invoke kb_meta.py as a subprocess and return parsed JSON output."""
    kb_meta = Path(__file__).parent / "kb_meta.py"
    cmd = [sys.executable, str(kb_meta), *extra_args, vault, topic]
    # kb_meta expects: <cmd> <vault> <topic> [args...]
    # but update-hash needs file as 3rd arg after topic -- handle separately
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0 and result.stderr:
        print(f"[warn] kb_meta stderr: {result.stderr.strip()}", file=sys.stderr)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}


def _run_kb_meta_cmd(args: list[str]) -> dict:
    """Invoke kb_meta.py with an explicit args list."""
    kb_meta = Path(__file__).parent / "kb_meta.py"
    cmd = [sys.executable, str(kb_meta), *args]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0 and result.stderr:
        print(f"[warn] kb_meta stderr: {result.stderr.strip()}", file=sys.stderr)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}


# ---------------------------------------------------------------------------
# Step: diff
# ---------------------------------------------------------------------------

def step_diff(vault: str, topic: str) -> list[str]:
    """Return relative paths of new/changed raw files."""
    result = _run_kb_meta_cmd(["diff", vault, topic])
    dirty = result.get("new", []) + result.get("changed", [])
    return dirty


# ---------------------------------------------------------------------------
# Step: chunk
# ---------------------------------------------------------------------------

def step_chunk(vault: str, topic: str, dirty: list[str], chunk_size: int, overlap: int):
    """Yield Chunk objects for each dirty file."""

    base = Path(vault) / topic
    for rel in dirty:
        full = base / rel
        if not full.exists():
            print(f"[warn] File not found, skipping: {rel}", file=sys.stderr)
            continue
        chunks = chunk_file(full, source=rel, chunk_size=chunk_size, chunk_overlap=overlap)
        print(f"  chunked {rel} -> {len(chunks)} chunk(s)")
        yield from chunks


# ---------------------------------------------------------------------------
# Step: extract
# ---------------------------------------------------------------------------

def step_extract(
    chunks,
    existing_concepts: list[str],
    model: str,
    base_url: str,
    api_key: str,
    dry_run: bool,
) -> list[ExtractionResult]:
    """Run LLM extraction on each chunk."""
    results: list[ExtractionResult] = []
    for chunk in chunks:
        if dry_run:
            # stub result for dry-run
            from extractor import ExtractionResult as ER  # noqa: PLC0415
            results.append(ER(
                summary=f"[dry-run] {chunk.source} / {chunk.heading or 'top'}",
                concepts=[],
                relationships=[],
                claims=[],
                chunk=chunk,
            ))
            continue
        result = extract_chunk(chunk, existing_concepts, model, base_url, api_key)
        if result is not None:
            results.append(result)
            # update known concepts so later chunks skip them
            for c in result.concepts:
                name = c.get("name", "")
                if name and name not in existing_concepts:
                    existing_concepts.append(name)
    return results


# ---------------------------------------------------------------------------
# Step: merge & write
# ---------------------------------------------------------------------------

def _load_existing_concepts(wiki_concepts: Path) -> dict[str, str]:
    """Return {slug: name} for all existing concept files."""
    mapping: dict[str, str] = {}
    if not wiki_concepts.exists():
        return mapping
    for f in wiki_concepts.iterdir():
        if f.suffix == ".md" and not f.name.startswith("_"):
            mapping[f.stem] = f.stem  # stem is the slug
    return mapping


def _read_concept_file(path: Path) -> str:
    if path.exists():
        return path.read_text("utf-8-sig", errors="replace")
    return ""


def _write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(content, "utf-8")
        tmp.replace(path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def step_merge_write(
    extractions: list[ExtractionResult],
    vault: str,
    topic: str,
    dry_run: bool,
) -> tuple[int, int, int, int, list[Contradiction]]:
    """Merge extracted knowledge into wiki/.

    Returns (summaries_written, concepts_created, concepts_updated,
    contradictions_found, contradictions).
    """
    base = Path(vault) / topic
    wiki = base / "wiki"
    wiki_concepts = wiki / "concepts"
    wiki_summaries = wiki / "summaries"
    wiki_concepts.mkdir(parents=True, exist_ok=True)
    wiki_summaries.mkdir(parents=True, exist_ok=True)

    existing_slugs = _load_existing_concepts(wiki_concepts)

    # group extractions by source file
    by_source: dict[str, list[ExtractionResult]] = {}
    for ex in extractions:
        by_source.setdefault(ex.chunk.source, []).append(ex)

    summaries_written = 0
    concepts_created = 0
    concepts_updated = 0
    contradictions: list[Contradiction] = []

    # collect all claims across extractions for contradiction detection
    all_claims: list[Claim] = []

    for source_rel, source_extractions in by_source.items():
        # --- write summary ---
        source_slug = _slugify(Path(source_rel).stem)
        summary_path = wiki_summaries / f"{source_slug}.md"

        summary_sections: list[str] = []
        summary_sections.append(f"# Summary: {Path(source_rel).stem}\n")
        summary_sections.append(f"> Source: `{source_rel}`  \n> Compiled: {_today()}\n")

        for ex in source_extractions:
            heading = ex.chunk.heading or "Overview"
            summary_sections.append(f"\n## {heading}\n\n{ex.summary}")
            if ex.relationships:
                rel_lines = "\n".join(
                    f"- **{r.get('from', '?')}** {r.get('type', '->')} **{r.get('to', '?')}**"
                    for r in ex.relationships
                )
                summary_sections.append(f"\n### Relationships\n{rel_lines}")

        summary_content = "\n".join(summary_sections) + "\n"
        if dry_run:
            print(f"  [dry-run] would write {summary_path.relative_to(base)}")
        else:
            _write_atomic(summary_path, summary_content)
        summaries_written += 1

        # --- process concepts ---
        for ex in source_extractions:
            for concept_dict in ex.concepts:
                name = concept_dict.get("name", "").strip()
                definition = concept_dict.get("definition", "").strip()
                if not name or not definition:
                    continue

                slug = _slugify(name)
                concept_path = wiki_concepts / f"{slug}.md"
                existing_text = _read_concept_file(concept_path)

                if slug not in existing_slugs:
                    # new concept
                    content = (
                        f"# {name}\n\n"
                        f"{definition}\n\n"
                        f"## Sources\n- `{source_rel}` ({_today()})\n"
                    )
                    if dry_run:
                        print(f"  [dry-run] would create concept: {slug}.md")
                    else:
                        _write_atomic(concept_path, content)
                    existing_slugs[slug] = name
                    concepts_created += 1
                else:
                    # existing concept -- append if source not already listed
                    if source_rel not in existing_text:
                        appended = existing_text.rstrip() + f"\n- `{source_rel}` ({_today()})\n"
                        if dry_run:
                            print(f"  [dry-run] would update concept: {slug}.md")
                        else:
                            _write_atomic(concept_path, appended)
                        concepts_updated += 1

            # --- collect claims for contradiction detection ---
            for claim_dict in ex.claims:
                content = claim_dict.get("content", "").strip()
                confidence = float(claim_dict.get("confidence", 0.5))
                if content:
                    all_claims.append(Claim(
                        content=content,
                        source=source_rel,
                        date=_today(),
                        confidence=confidence,
                    ))

    # --- contradiction detection ---
    contradictions = _detect_contradictions(all_claims)

    if contradictions:
        _write_contradictions(wiki, contradictions, dry_run)

    n_contradictions = len(contradictions)
    return summaries_written, concepts_created, concepts_updated, n_contradictions, contradictions


def _detect_contradictions(claims: list[Claim]) -> list[Contradiction]:
    """Heuristic contradiction detection -- same source claims are not compared."""
    contradictions: list[Contradiction] = []
    negation_words = {"not", "never", "no", "false", "incorrect", "wrong", "cannot", "impossible"}
    temporal_words = {"previously", "formerly", "used to", "was", "before", "old", "deprecated"}

    for i, ca in enumerate(claims):
        for cb in claims[i + 1:]:
            if ca.source == cb.source:
                continue
            words_a = set(ca.content.lower().split())
            words_b = set(cb.content.lower().split())
            shared = words_a & words_b - {"the", "a", "an", "is", "are", "of", "in", "to", "and"}
            if len(shared) < 3:
                continue  # not enough overlap to be a contradiction

            neg_a = bool(negation_words & words_a)
            neg_b = bool(negation_words & words_b)
            temp_a = bool(temporal_words & words_a)
            temp_b = bool(temporal_words & words_b)

            if neg_a != neg_b:
                severity = "direct"
            elif temp_a or temp_b:
                severity = "temporal"
            elif len(shared) >= 5:
                severity = "nuanced"
            else:
                continue

            contradictions.append(Contradiction(
                claim_a=ca,
                claim_b=cb,
                severity=severity,
                resolution=None,
            ))

    return contradictions


def _write_contradictions(wiki: Path, contradictions: list[Contradiction], dry_run: bool) -> None:
    path = wiki / "_contradictions.md"
    existing = path.read_text("utf-8-sig", errors="replace") if path.exists() else ""

    new_entries: list[str] = []
    for c in contradictions:
        entry = (
            f"\n---\n"
            f"**Severity**: {c.severity}  \n"
            f"**Claim A** (`{c.claim_a.source}`): {c.claim_a.content}  \n"
            f"**Claim B** (`{c.claim_b.source}`): {c.claim_b.content}  \n"
            f"**Resolution**: {c.resolution or 'unresolved'}  \n"
            f"**Detected**: {_today()}\n"
        )
        new_entries.append(entry)

    if not existing.strip():
        header = "# Contradictions\n\n> Auto-detected conflicts between source claims.\n"
        content = header + "".join(new_entries)
    else:
        content = existing.rstrip() + "\n" + "".join(new_entries)

    if dry_run:
        print(f"  [dry-run] would write {path.name} ({len(contradictions)} contradiction(s))")
    else:
        _write_atomic(path, content)


# ---------------------------------------------------------------------------
# Step: update hash
# ---------------------------------------------------------------------------

def step_update_hashes(vault: str, topic: str, dirty: list[str], dry_run: bool) -> None:
    for rel in dirty:
        if dry_run:
            print(f"  [dry-run] would update hash for {rel}")
        else:
            _run_kb_meta_cmd(["update-hash", vault, topic, rel])


# ---------------------------------------------------------------------------
# Step: index + check-links
# ---------------------------------------------------------------------------

def step_index(vault: str, topic: str, dry_run: bool) -> int:
    """Run update-index and check-links. Returns broken link count."""
    if dry_run:
        print("  [dry-run] would run update-index + check-links")
        return 0
    _run_kb_meta_cmd(["update-index", vault, topic])
    links_result = _run_kb_meta_cmd(["check-links", vault, topic])
    broken = links_result.get("broken", [])
    if broken:
        print(f"  [warn] {len(broken)} broken link(s) detected:")
        for b in broken[:10]:
            print(f"    {b.get('from')} -> {b.get('to')}")
    return len(broken)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="KB auto-orchestration pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "vault_topic",
        help="Path to <vault>/<topic> directory (e.g. /path/to/vault/my-topic)",
    )
    parser.add_argument(
        "--tier",
        default="haiku",
        choices=["haiku", "sonnet", "opus"],
        help="Model tier (default: haiku)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print actions without executing")
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=1000,
        help="Max chars per chunk (default: 1000)",
    )
    parser.add_argument(
        "--chunk-overlap",
        type=int,
        default=200,
        help="Overlap chars between chunks (default: 200)",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="OpenAI-compatible API base URL (env: OPENAI_BASE_URL)",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="API key (env: OPENAI_API_KEY or ANTHROPIC_API_KEY)",
    )
    args = parser.parse_args()

    # resolve vault / topic
    topic_path = Path(args.vault_topic).resolve()
    if not topic_path.exists():
        print(f"Error: path does not exist: {topic_path}", file=sys.stderr)
        sys.exit(1)
    vault = str(topic_path.parent)
    topic = topic_path.name

    # resolve API config
    provider = os.environ.get("COMPILE_PROVIDER", "anthropic")
    base_url = (
        args.base_url
        or os.environ.get("OPENAI_BASE_URL")
        or resolve_provider_url(provider)
        or "https://api.openai.com/v1"
    )
    api_key = (
        args.api_key
        or os.environ.get("OPENAI_API_KEY")
        or os.environ.get("ANTHROPIC_API_KEY", "")
    )
    model = os.environ.get("COMPILE_MODEL") or resolve_model(args.tier, provider)

    dry_tag = " [DRY RUN]" if args.dry_run else ""
    print(f"\n=== KB Compile: {topic}{dry_tag} ===")
    print(f"    vault : {vault}")
    print(f"    model : {model}  (provider: {provider})")
    print(f"    chunks: size={args.chunk_size} overlap={args.chunk_overlap}")

    # ensure init
    _run_kb_meta_cmd(["init", vault, topic])

    # 1. diff
    print("\n[1/7] diff -- finding dirty files...")
    dirty = step_diff(vault, topic)
    if not dirty:
        print("  Nothing to compile. All sources up to date.")
        report = CompileReport(0, 0, 0, 0, 0, 0)
        _print_report(report)
        return
    print(f"  {len(dirty)} file(s) to compile: {dirty}")

    # 2. chunk
    print("\n[2/7] chunk -- splitting files...")
    all_chunks = list(step_chunk(vault, topic, dirty, args.chunk_size, args.chunk_overlap))
    print(f"  Total chunks: {len(all_chunks)}")

    # 3. extract
    print("\n[3/7] extract -- calling LLM...")
    concepts_dir = Path(vault) / topic / "wiki" / "concepts"
    existing_concepts: list[str] = _load_existing_concept_names(concepts_dir)
    extractions = step_extract(
        all_chunks,
        existing_concepts,
        model=model,
        base_url=base_url,
        api_key=api_key,
        dry_run=args.dry_run,
    )
    print(f"  Extracted {len(extractions)} result(s)")

    # 4+5. merge + write
    print("\n[4/7] merge + [5/7] write -- updating wiki...")
    summaries_written, concepts_created, concepts_updated, contradictions_found, _ = (
        step_merge_write(extractions, vault, topic, args.dry_run)
    )

    # 6. update hashes
    print("\n[6/7] update-hash -- marking sources compiled...")
    step_update_hashes(vault, topic, dirty, args.dry_run)

    # 7. index + links
    print("\n[7/7] index + check-links...")
    broken_links = step_index(vault, topic, args.dry_run)

    # report
    report = CompileReport(
        sources_compiled=len(dirty),
        summaries_written=summaries_written,
        concepts_created=concepts_created,
        concepts_updated=concepts_updated,
        contradictions_found=contradictions_found,
        broken_links=broken_links,
    )
    _print_report(report)


def _load_existing_concept_names(concepts_dir: Path) -> list[str]:
    if not concepts_dir.exists():
        return []
    names = []
    for f in concepts_dir.iterdir():
        if f.suffix == ".md" and not f.name.startswith("_"):
            # read first heading as canonical name
            text = f.read_text("utf-8-sig", errors="replace")
            for line in text.splitlines():
                if line.startswith("# "):
                    names.append(line[2:].strip())
                    break
            else:
                names.append(f.stem)
    return names


def _print_report(report: CompileReport) -> None:
    print("\n=== Compilation Report ===")
    print(f"  Sources compiled  : {report.sources_compiled}")
    print(f"  Summaries written : {report.summaries_written}")
    print(f"  Concepts created  : {report.concepts_created}")
    print(f"  Concepts updated  : {report.concepts_updated}")
    print(f"  Contradictions    : {report.contradictions_found}")
    print(f"  Broken links      : {report.broken_links}")
    print()


if __name__ == "__main__":
    main()
