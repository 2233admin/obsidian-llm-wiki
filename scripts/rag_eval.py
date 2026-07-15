#!/usr/bin/env python3
"""Local RAG scorecard and export bridge for LLM Wiki.

The script intentionally has no third-party dependencies. It scores retrieval
and citation plumbing locally, then exports simple JSONL for Ragas or DeepEval
when LLM-as-judge metrics are desired.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def read_cases(path: Path) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            raw = line.strip()
            if not raw or raw.startswith("#"):
                continue
            try:
                case = json.loads(raw)
            except json.JSONDecodeError as e:
                raise SystemExit(f"{path}:{line_no}: invalid JSON: {e}") from e
            if not isinstance(case, dict):
                raise SystemExit(f"{path}:{line_no}: expected JSON object")
            cases.append(case)
    return cases


def as_str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if v is not None]
    return [str(value)]


def retrieved_paths(case: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for item in case.get("retrieved", []) or []:
        if isinstance(item, dict) and item.get("path") is not None:
            out.append(str(item["path"]))
        elif item is not None:
            out.append(str(item))
    return out


def retrieved_contexts(case: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for item in case.get("retrieved", []) or []:
        if isinstance(item, dict):
            content = item.get("content")
            if content is not None:
                out.append(str(content))
        elif item is not None:
            out.append(str(item))
    return out


def score_cases(cases: list[dict[str, Any]], k: int) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    hit_count = 0
    mrr_total = 0.0
    precision_total = 0.0
    precision_cases = 0
    citation_total = 0.0
    citation_cases = 0
    answer_count = 0

    for case in cases:
        expected = set(as_str_list(case.get("expected_paths")))
        paths = retrieved_paths(case)
        top_k = paths[:k]
        citations = as_str_list(case.get("citations"))

        first_rank = 0
        for idx, path in enumerate(paths, start=1):
            if path in expected:
                first_rank = idx
                break

        hit = bool(first_rank)
        if hit:
            hit_count += 1
            mrr_total += 1.0 / first_rank

        precision_at_k = None
        if expected:
            precision_cases += 1
            precision_at_k = sum(1 for p in top_k if p in expected) / max(k, 1)
            precision_total += precision_at_k

        citation_coverage = None
        if citations:
            citation_cases += 1
            retrieved = set(paths)
            citation_coverage = sum(1 for c in citations if c in retrieved) / len(citations)
            citation_total += citation_coverage

        if str(case.get("answer", "")).strip():
            answer_count += 1

        rows.append({
            "id": case.get("id"),
            "hit": hit,
            "first_rank": first_rank or None,
            "precision_at_k": precision_at_k,
            "citation_coverage": citation_coverage,
            "retrieved_count": len(paths),
        })

    n = len(cases)
    return {
        "cases": n,
        "hit_rate": hit_count / n if n else 0.0,
        "mrr": mrr_total / n if n else 0.0,
        "precision_at_k": precision_total / precision_cases if precision_cases else None,
        "citation_coverage": citation_total / citation_cases if citation_cases else None,
        "answer_presence": answer_count / n if n else 0.0,
        "rows": rows,
    }


def export_ragas(cases: list[dict[str, Any]], path: Path) -> None:
    with path.open("w", encoding="utf-8") as f:
        for case in cases:
            out = {
                "question": case.get("question", ""),
                "answer": case.get("answer", ""),
                "contexts": retrieved_contexts(case),
                "ground_truth": case.get("reference", ""),
            }
            f.write(json.dumps(out, ensure_ascii=False) + "\n")


def export_deepeval(cases: list[dict[str, Any]], path: Path) -> None:
    with path.open("w", encoding="utf-8") as f:
        for case in cases:
            out = {
                "input": case.get("question", ""),
                "actual_output": case.get("answer", ""),
                "retrieval_context": retrieved_contexts(case),
                "expected_output": case.get("reference", ""),
            }
            f.write(json.dumps(out, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Score LLM Wiki RAG retrieval cases")
    parser.add_argument("input", type=Path, help="JSONL evaluation cases")
    parser.add_argument("--k", type=int, default=5, help="precision@k cutoff")
    parser.add_argument("--json", action="store_true", help="print full JSON report")
    parser.add_argument("--export-ragas", type=Path, help="write Ragas-compatible JSONL")
    parser.add_argument("--export-deepeval", type=Path, help="write DeepEval-compatible JSONL")
    parser.add_argument("--min-hit-rate", type=float, help="fail if hit_rate is below threshold")
    parser.add_argument("--min-citation-coverage", type=float, help="fail if citation_coverage is below threshold")
    args = parser.parse_args()

    cases = read_cases(args.input)
    report = score_cases(cases, args.k)

    if args.export_ragas:
        export_ragas(cases, args.export_ragas)
    if args.export_deepeval:
        export_deepeval(cases, args.export_deepeval)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(
            "cases={cases} hit_rate={hit_rate:.3f} mrr={mrr:.3f} "
            "precision_at_k={precision} citation_coverage={coverage} answer_presence={answer:.3f}".format(
                cases=report["cases"],
                hit_rate=report["hit_rate"],
                mrr=report["mrr"],
                precision="n/a" if report["precision_at_k"] is None else f"{report['precision_at_k']:.3f}",
                coverage="n/a" if report["citation_coverage"] is None else f"{report['citation_coverage']:.3f}",
                answer=report["answer_presence"],
            )
        )

    failed = False
    if args.min_hit_rate is not None and report["hit_rate"] < args.min_hit_rate:
        print(f"FAIL: hit_rate {report['hit_rate']:.3f} < {args.min_hit_rate:.3f}", file=sys.stderr)
        failed = True
    coverage = report["citation_coverage"]
    if args.min_citation_coverage is not None:
        if coverage is None or coverage < args.min_citation_coverage:
            actual = "n/a" if coverage is None else f"{coverage:.3f}"
            print(f"FAIL: citation_coverage {actual} < {args.min_citation_coverage:.3f}", file=sys.stderr)
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
