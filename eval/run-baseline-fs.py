#!/usr/bin/env python3
"""
Filesystem-only baseline for retrieval eval.

Runs ripgrep multi-token OR pattern over memory/*.md, ranks by hit count,
computes recall@5 + MRR per question and per group.

Zero external deps beyond stdlib + ripgrep on PATH.
"""

from __future__ import annotations
import json, re, os, sys, subprocess, pathlib, datetime
from collections import defaultdict

GOLD_PATH = pathlib.Path("D:/projects/obsidian-llm-wiki/eval/retrieval-gold.jsonl")
MEM_DIR = pathlib.Path(os.path.expanduser("~/.claude/projects/C--Users-Administrator/memory"))
OUT_DIR = pathlib.Path("D:/projects/obsidian-llm-wiki/eval")
TOP_K = 5

# Stopwords to drop from query tokens — keep retrieval signal-bearing terms.
STOPCHARS_ZH = set("我你他她它的是了吗呢啊吧在和或但因为所以这那有没已经"
                   "还都也就对错好不下上里面也都已也吧呢嘛个种它你们我们他们"
                   "为啥怎样如何可以能会要这样那样然后但是然而")
STOPWORDS_EN = {"a", "an", "the", "is", "are", "was", "were", "be", "been",
                "do", "does", "did", "have", "has", "had", "of", "in", "on",
                "at", "for", "to", "from", "with", "by", "and", "or", "but",
                "if", "then", "else", "what", "why", "how", "where", "when",
                "who", "which", "this", "that", "these", "those", "i", "you",
                "we", "they", "he", "she", "it", "can", "could", "should",
                "would", "shall", "will", "may", "might", "not", "no", "yes",
                "as", "so", "up", "down", "out", "into", "than", "just"}

# Files to exclude from retrieval — index/navigation hubs that aren't fact sources
EXCLUDE_FILES = {"MEMORY.md", "README.md"}


def tokenize(query: str) -> list[str]:
    """Split query into ASCII words + CJK bigrams (zero-dep zh segmentation)."""
    # Atomic blocks: ASCII alphanum runs OR CJK char runs
    blocks = re.findall(r"[A-Za-z0-9_]+|[一-鿿]+", query)
    tokens: list[str] = []
    seen: set[str] = set()

    def add(t: str) -> None:
        if t in seen:
            return
        seen.add(t)
        tokens.append(t)

    for b in blocks:
        if re.match(r"^[A-Za-z0-9_]+$", b):
            tl = b.lower()
            if tl in STOPWORDS_EN:
                continue
            if len(b) < 2:
                continue
            # Short numeric tokens (1-3 digits) are noise — they hit
            # skill-index numbering, version numbers, port numbers, etc.
            if b.isdigit() and len(b) <= 3:
                continue
            add(b)
        else:
            # CJK run — emit bigrams (drop bigrams where both chars are stopchars)
            chars = list(b)
            for i in range(len(chars) - 1):
                bg = chars[i] + chars[i + 1]
                if all(ch in STOPCHARS_ZH for ch in bg):
                    continue
                add(bg)
            # Also keep the full run if short (2-3 chars) — captures "obsidian" style entities written in zh
            if 2 <= len(chars) <= 4 and not all(ch in STOPCHARS_ZH for ch in chars):
                add(b)
    return tokens


def rg_search(query: str, top_k: int = TOP_K) -> list[tuple[str, int]]:
    tokens = tokenize(query)
    if not tokens:
        return []
    pattern = "|".join(re.escape(t) for t in tokens)
    try:
        proc = subprocess.run(
            ["rg", "--count-matches", "-i", "--no-heading", "--with-filename",
             "-e", pattern, str(MEM_DIR)],
            capture_output=True, text=True, encoding="utf-8", errors="ignore",
            timeout=15,
        )
    except FileNotFoundError:
        print("[err] ripgrep not on PATH", file=sys.stderr)
        return []
    except subprocess.TimeoutExpired:
        print(f"[warn] rg timeout on query: {query[:50]}", file=sys.stderr)
        return []

    hits: list[tuple[str, float]] = []
    for line in proc.stdout.splitlines():
        if ":" not in line:
            continue
        try:
            path, count = line.rsplit(":", 1)
            count = int(count.strip())
        except (ValueError, IndexError):
            continue
        p = pathlib.Path(path)
        if p.parent.resolve() != MEM_DIR.resolve():
            continue
        if p.name in EXCLUDE_FILES:
            continue
        # Density-based score: hits per KB. Small canonical docs (gitea.md)
        # win over large discussion files (project_nas_gitea_frontend.md)
        # that incidentally mention the term many times.
        try:
            size_kb = max(p.stat().st_size / 1024.0, 0.5)
        except OSError:
            size_kb = 1.0
        density = count / size_kb
        hits.append((p.name, density))
    hits.sort(key=lambda x: -x[1])
    return hits[:top_k]


def evaluate() -> dict:
    if not GOLD_PATH.exists():
        print(f"[err] {GOLD_PATH} not found", file=sys.stderr)
        sys.exit(2)
    if not MEM_DIR.is_dir():
        print(f"[err] {MEM_DIR} not found", file=sys.stderr)
        sys.exit(2)

    # raw_decode tolerates trailing non-JSON garbage (Curry's inline 接受/修改 marks)
    decoder = json.JSONDecoder()
    questions = []
    for l in GOLD_PATH.read_text(encoding="utf-8").splitlines():
        l = l.strip()
        if not l:
            continue
        try:
            obj, _ = decoder.raw_decode(l)
            questions.append(obj)
        except json.JSONDecodeError as e:
            print(f"[warn] skip bad line: {e}", file=sys.stderr)

    results = []
    for item in questions:
        gold = set(item["gold"])
        ranked = rg_search(item["q"])
        ranked_files = [p for p, _ in ranked]
        # recall@5
        hit = sum(1 for f in ranked_files if f in gold)
        recall = hit / len(gold) if gold else 0.0
        # MRR
        mrr = 0.0
        for i, f in enumerate(ranked_files):
            if f in gold:
                mrr = 1.0 / (i + 1)
                break
        results.append({
            "qid": item["id"],
            "q": item["q"],
            "gold": item["gold"],
            "group": item.get("group", "unknown"),
            "ranked": ranked_files,
            "recall@5": recall,
            "mrr": mrr,
            "tokens": tokenize(item["q"]),
        })
    return {"results": results}


def write_report(eval_out: dict) -> pathlib.Path:
    rs = eval_out["results"]
    n = len(rs)
    overall_recall = sum(r["recall@5"] for r in rs) / n if n else 0
    overall_mrr = sum(r["mrr"] for r in rs) / n if n else 0

    groups: dict[str, list] = defaultdict(list)
    for r in rs:
        groups[r["group"]].append(r)

    today = datetime.datetime.now().strftime("%Y-%m-%d")
    out_path = OUT_DIR / f"baseline-fs-{today}.md"
    OUT_DIR.mkdir(exist_ok=True, parents=True)

    lines = []
    lines.append(f"# Filesystem-only Retrieval Baseline")
    lines.append(f"")
    lines.append(f"- **Date**: {today}")
    lines.append(f"- **Adapter**: ripgrep over `memory/*.md` (top-level only), multi-token OR, rank by hit count")
    lines.append(f"- **Gold set**: {n} queries from `retrieval-gold.jsonl`")
    lines.append(f"- **Top-K**: {TOP_K}")
    lines.append(f"")
    lines.append(f"## Overall")
    lines.append(f"")
    lines.append(f"| metric | value |")
    lines.append(f"|---|---|")
    lines.append(f"| recall@{TOP_K} | **{overall_recall:.3f}** |")
    lines.append(f"| MRR | **{overall_mrr:.3f}** |")
    lines.append(f"")
    lines.append(f"## Per group")
    lines.append(f"")
    lines.append(f"| group | n | recall@{TOP_K} | MRR |")
    lines.append(f"|---|---|---|---|")
    for g in ("entity", "concept", "hybrid"):
        gs = groups.get(g, [])
        if not gs:
            continue
        gr = sum(r["recall@5"] for r in gs) / len(gs)
        gm = sum(r["mrr"] for r in gs) / len(gs)
        lines.append(f"| {g} | {len(gs)} | {gr:.3f} | {gm:.3f} |")
    lines.append(f"")
    lines.append(f"## Per query")
    lines.append(f"")
    lines.append(f"| qid | grp | r@{TOP_K} | MRR | gold | top-{TOP_K} ranked |")
    lines.append(f"|---|---|---|---|---|---|")
    for r in rs:
        gold_short = ", ".join(g.replace(".md", "") for g in r["gold"][:3])
        if len(r["gold"]) > 3:
            gold_short += f" (+{len(r['gold']) - 3})"
        ranked_short = ", ".join(p.replace(".md", "") for p in r["ranked"][:TOP_K])
        if not ranked_short:
            ranked_short = "—"
        # truncate long values for table readability
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
    failures = [r for r in rs if r["recall@5"] == 0]
    if not failures:
        lines.append(f"None — every query hit at least one gold doc in top-{TOP_K}.")
    else:
        for r in failures:
            lines.append(f"### {r['qid']} ({r['group']})")
            lines.append(f"- **Q**: {r['q']}")
            lines.append(f"- **Tokens**: `{', '.join(r['tokens'])}`")
            lines.append(f"- **Gold**: {', '.join(r['gold'])}")
            lines.append(f"- **Got**: {', '.join(r['ranked']) if r['ranked'] else '(empty)'}")
            lines.append(f"")

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_path


def main() -> int:
    print("Running ripgrep over memory/*.md for each query...")
    out = evaluate()
    report_path = write_report(out)
    rs = out["results"]
    n = len(rs)
    overall_recall = sum(r["recall@5"] for r in rs) / n if n else 0
    overall_mrr = sum(r["mrr"] for r in rs) / n if n else 0
    failures = sum(1 for r in rs if r["recall@5"] == 0)
    print(f"\n--- Filesystem baseline ---")
    print(f"Queries: {n}")
    print(f"Overall recall@{TOP_K}: {overall_recall:.3f}")
    print(f"Overall MRR: {overall_mrr:.3f}")
    print(f"Failures (recall=0): {failures}")
    print(f"Report: {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
