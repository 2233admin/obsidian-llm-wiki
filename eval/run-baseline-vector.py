#!/usr/bin/env python3
"""
Vault-file vector retrieval baseline.

Embeds every top-level memory/*.md via ollama qwen3-embedding:0.6b
(same model memU uses), then for each gold question embeds the query
and ranks files by cosine similarity. Computes recall@5 + MRR per
question and per group, compared against fs baseline.

Zero-dep beyond stdlib + ollama on localhost:11434.
"""

from __future__ import annotations
import json, os, sys, pathlib, urllib.request, time, math, datetime
from collections import defaultdict

OLLAMA = "http://localhost:11434/api/embeddings"
MODEL = "qwen3-embedding:0.6b"
MEM_DIR = pathlib.Path(os.path.expanduser("~/.claude/projects/C--Users-Administrator/memory"))
GOLD = pathlib.Path("D:/projects/obsidian-llm-wiki/eval/retrieval-gold.jsonl")
OUT_DIR = pathlib.Path("D:/projects/obsidian-llm-wiki/eval")
TOP_K = 5
EXCLUDE = {"MEMORY.md", "README.md"}
CHUNK_CHARS = 2000  # first N chars per file (frontmatter + lead content usually most informative)
FS_BASELINE = (0.400, 0.405)  # (recall@5, MRR) from baseline-fs-2026-04-25.md


def embed(text: str, retries: int = 2) -> list[float] | None:
    body = json.dumps({"model": MODEL, "prompt": text}).encode("utf-8")
    req = urllib.request.Request(
        OLLAMA, data=body, headers={"Content-Type": "application/json"}
    )
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read()).get("embedding")
        except Exception as e:
            if attempt == retries:
                print(f"[err] embed failed for text[:50]={text[:50]!r}: {e}", file=sys.stderr)
                return None
            time.sleep(1)
    return None


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def load_questions() -> list[dict]:
    """Load gold jsonl, tolerating inline annotations (Curry's 接受/修改 marks)."""
    decoder = json.JSONDecoder()
    out = []
    for line in GOLD.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj, _ = decoder.raw_decode(line)
            out.append(obj)
        except json.JSONDecodeError as e:
            print(f"[warn] skip bad line: {e}", file=sys.stderr)
    return out


def embed_corpus() -> list[tuple[str, list[float]]]:
    files = sorted(
        p for p in MEM_DIR.glob("*.md")
        if p.name not in EXCLUDE and p.is_file()
    )
    print(f"Embedding {len(files)} memory files (excluding {sorted(EXCLUDE)})...")
    out: list[tuple[str, list[float]]] = []
    t0 = time.time()
    for i, f in enumerate(files):
        text = f.read_text(encoding="utf-8", errors="ignore")[:CHUNK_CHARS]
        if not text.strip():
            continue
        vec = embed(text)
        if vec is None:
            print(f"[warn] no embed for {f.name}", file=sys.stderr)
            continue
        out.append((f.name, vec))
        if (i + 1) % 25 == 0 or i + 1 == len(files):
            elapsed = time.time() - t0
            print(f"  {i+1}/{len(files)} ({elapsed:.1f}s, {(i+1)/elapsed:.1f}/s)")
    return out


def evaluate(file_vecs: list[tuple[str, list[float]]], questions: list[dict]) -> list[dict]:
    results: list[dict] = []
    t0 = time.time()
    for item in questions:
        q_vec = embed(item["q"])
        if q_vec is None:
            top: list[str] = []
        else:
            scored = [(name, cosine(q_vec, v)) for name, v in file_vecs]
            scored.sort(key=lambda x: -x[1])
            top = [n for n, _ in scored[:TOP_K]]
        gold = set(item["gold"])
        hit = sum(1 for f in top if f in gold)
        recall = hit / len(gold) if gold else 0.0
        mrr = 0.0
        for i, n in enumerate(top):
            if n in gold:
                mrr = 1.0 / (i + 1)
                break
        results.append({
            "qid": item["id"],
            "q": item["q"],
            "gold": item["gold"],
            "group": item.get("group", "?"),
            "ranked": top,
            "recall@5": recall,
            "mrr": mrr,
        })
    print(f"Ranked {len(questions)} queries in {time.time()-t0:.1f}s")
    return results


def write_report(results: list[dict], n_files: int) -> pathlib.Path:
    n = len(results)
    overall_r = sum(r["recall@5"] for r in results) / n if n else 0
    overall_m = sum(r["mrr"] for r in results) / n if n else 0
    by_group: dict[str, list] = defaultdict(list)
    for r in results:
        by_group[r["group"]].append(r)

    today = datetime.datetime.now().strftime("%Y-%m-%d")
    out_path = OUT_DIR / f"baseline-vector-{today}.md"

    fs_r, fs_m = FS_BASELINE
    lines = [
        f"# Vault-file Vector Baseline",
        f"",
        f"- **Date**: {today}",
        f"- **Embedding model**: `{MODEL}` (1024-dim, ollama localhost:11434, same as memU)",
        f"- **Corpus**: {n_files} files in `memory/*.md` top-level (excludes {sorted(EXCLUDE)})",
        f"- **Chunking**: first {CHUNK_CHARS} chars per file (single-chunk, no overlap)",
        f"- **Gold**: {n} queries from `retrieval-gold.jsonl`",
        f"- **Ranking**: cosine similarity, top-{TOP_K}",
        f"",
        f"## Overall vs filesystem baseline",
        f"",
        f"| metric | vector | fs (ripgrep+density) | delta |",
        f"|---|---|---|---|",
        f"| recall@{TOP_K} | **{overall_r:.3f}** | {fs_r:.3f} | {overall_r-fs_r:+.3f} |",
        f"| MRR | **{overall_m:.3f}** | {fs_m:.3f} | {overall_m-fs_m:+.3f} |",
        f"",
        f"## Per group",
        f"",
        f"| group | n | vector r@{TOP_K} | vector MRR |",
        f"|---|---|---|---|",
    ]
    for g in ("entity", "concept", "hybrid"):
        gs = by_group.get(g, [])
        if not gs:
            continue
        gr = sum(r["recall@5"] for r in gs) / len(gs)
        gm = sum(r["mrr"] for r in gs) / len(gs)
        lines.append(f"| {g} | {len(gs)} | {gr:.3f} | {gm:.3f} |")
    lines.append(f"")
    lines.append(f"## Per query")
    lines.append(f"")
    lines.append(f"| qid | grp | r@{TOP_K} | MRR | gold | top-{TOP_K} |")
    lines.append(f"|---|---|---|---|---|---|")
    for r in results:
        gold_short = ", ".join(g.replace(".md", "") for g in r["gold"][:3])
        if len(r["gold"]) > 3:
            gold_short += f" (+{len(r['gold'])-3})"
        ranked_short = ", ".join(p.replace(".md", "") for p in r["ranked"][:TOP_K])
        if not ranked_short:
            ranked_short = "—"
        if len(gold_short) > 60:
            gold_short = gold_short[:57] + "..."
        if len(ranked_short) > 80:
            ranked_short = ranked_short[:77] + "..."
        lines.append(
            f"| {r['qid']} | {r['group'][:3]} | {r['recall@5']:.2f} | "
            f"{r['mrr']:.2f} | {gold_short} | {ranked_short} |"
        )
    lines.append(f"")
    lines.append(f"## Failures (recall@{TOP_K} = 0)")
    lines.append(f"")
    failures = [r for r in results if r["recall@5"] == 0]
    if not failures:
        lines.append(f"None.")
    else:
        for r in failures:
            lines.append(f"### {r['qid']} ({r['group']})")
            lines.append(f"- **Q**: {r['q']}")
            lines.append(f"- **Gold**: {', '.join(r['gold'])}")
            lines.append(f"- **Got**: {', '.join(r['ranked']) if r['ranked'] else '(empty)'}")
            lines.append(f"")

    OUT_DIR.mkdir(exist_ok=True, parents=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_path


def main() -> int:
    if not MEM_DIR.is_dir():
        print(f"[err] {MEM_DIR} not found", file=sys.stderr)
        return 2
    if not GOLD.exists():
        print(f"[err] {GOLD} not found", file=sys.stderr)
        return 2

    file_vecs = embed_corpus()
    if not file_vecs:
        print("[err] no file embeddings produced", file=sys.stderr)
        return 3

    questions = load_questions()
    print(f"Loaded {len(questions)} gold questions")

    results = evaluate(file_vecs, questions)
    out_path = write_report(results, len(file_vecs))

    n = len(results)
    overall_r = sum(r["recall@5"] for r in results) / n if n else 0
    overall_m = sum(r["mrr"] for r in results) / n if n else 0
    failures = sum(1 for r in results if r["recall@5"] == 0)
    fs_r, fs_m = FS_BASELINE
    print(f"\n--- Vector baseline ---")
    print(f"recall@{TOP_K}: {overall_r:.3f}  (fs: {fs_r:.3f}, delta: {overall_r-fs_r:+.3f})")
    print(f"MRR:           {overall_m:.3f}  (fs: {fs_m:.3f}, delta: {overall_m-fs_m:+.3f})")
    print(f"Failures: {failures}/{n}")
    print(f"Report: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
