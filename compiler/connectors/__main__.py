"""CLI entry point for running a single connector standalone.

Usage (run from the compiler/ directory so `connectors` resolves as a
top-level package, matching how compile.py etc. are invoked):

    python -m connectors hackernews
    python -m connectors hackernews --limit 5
    python -m connectors hackernews --output-dir ../examples/collab-vault/research-compiler/raw/hackernews
    python -m connectors gmail        # scaffold -- logs "skipping", writes nothing
    python -m connectors x            # scaffold -- logs "skipping", writes nothing
    python -m connectors web_search   # scaffold -- logs "skipping", writes nothing

This is a standalone runner for developing/verifying one connector at a
time. It does not go through scheduler.py's tick/state-machine dispatch --
that integration is a separate step.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import gmail, hackernews, web_search, x

CONNECTORS = {
    "hackernews": hackernews,
    "gmail": gmail,
    "x": x,
    "web_search": web_search,
}

# Default landing spot when --output-dir isn't given: ./raw/<connector>/
# relative to the current working directory, mirroring how compile.py
# takes an explicit <vault_topic_path> rather than assuming one.
DEFAULT_RAW_DIRNAME = "raw"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m connectors",
        description="Run a single data-source connector and write raw/ markdown files.",
    )
    parser.add_argument("connector", choices=sorted(CONNECTORS), help="Connector to run")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory to write markdown files into "
        "(default: ./raw/<connector>/ relative to cwd)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max records to fetch (connector-specific; hackernews default: 15)",
    )
    args = parser.parse_args(argv)

    module = CONNECTORS[args.connector]
    output_dir = args.output_dir or (Path.cwd() / DEFAULT_RAW_DIRNAME / args.connector)

    kwargs = {}
    if args.limit is not None:
        kwargs["limit"] = args.limit

    print(f"[connectors] running '{args.connector}' -> {output_dir}")
    written = module.fetch(output_dir, **kwargs)
    print(f"[connectors] wrote {len(written)} file(s)")
    for path in written:
        print(f"  - {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
