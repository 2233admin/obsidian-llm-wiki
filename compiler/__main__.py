"""compiler CLI — compile a vault into a context-core JSON artifact.

Usage:
    python -m compiler <vault_path> [-o output.json] [--tasks] [--stats]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m compiler",
        description="Compile an Obsidian vault into a context-core.json artifact.",
    )
    parser.add_argument("vault", type=Path, help="Path to the vault root directory")
    parser.add_argument(
        "-o", "--output", type=Path, default=Path("context-core.json"),
        help="Output path (default: context-core.json)",
    )
    parser.add_argument(
        "--tasks", action="store_true",
        help="Print knowledge-task summary after compile",
    )
    parser.add_argument(
        "--stats", action="store_true",
        help="Print holon count statistics",
    )
    parser.add_argument(
        "--indent", type=int, default=None,
        help="JSON indent for readable output (e.g. --indent 2)",
    )
    args = parser.parse_args()

    vault = args.vault.resolve()
    if not vault.is_dir():
        print(f"error: vault not found: {vault}", file=sys.stderr)
        return 1

    from .holons.concept_graph import attach_edges
    from .holons.extractor import extract_vault
    from .holons.serializer import dump_json
    from .ontology import load_domain_ontology

    print(f"[compile] vault: {vault}")
    ontology = load_domain_ontology(vault)
    print(f"[compile] ontology: {ontology.domain} ({len(ontology.entity_types)} types)")

    holon_set = extract_vault(vault, ontology)
    print(f"[compile] extracted {len(holon_set.holons)} holons")

    holon_set = attach_edges(holon_set)
    total_edges = sum(len(h.causal_edges) for h in holon_set.holons)
    print(f"[compile] attached {total_edges} causal edges")

    dump_json(holon_set, args.output, indent=args.indent)
    print(f"[compile] wrote {args.output}")

    if args.stats:
        from collections import Counter
        kinds = Counter(h.kind for h in holon_set.holons)
        print("\n--- kind stats ---")
        for kind, count in kinds.most_common():
            print(f"  {kind:20s} {count}")

    if args.tasks:
        from .tasks import task_stats
        ts = task_stats(holon_set)
        print(f"\n--- tasks: {ts.total} total ---")
        for status, count in sorted(ts.by_status.items()):
            print(f"  {status:12s} {count}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
