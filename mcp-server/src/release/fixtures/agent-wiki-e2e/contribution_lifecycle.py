#!/usr/bin/env python3
"""E2E helper: revise/retract via public contribution_manifest API (no production edits)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--compiler-root", required=True)
    parser.add_argument("--topic-root", required=True)
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--mode", choices=("revise", "retract"), required=True)
    args = parser.parse_args()

    compiler_root = Path(args.compiler_root)
    sys.path.insert(0, str(compiler_root))
    from contribution_manifest import (  # noqa: E402
        apply_source_revision,
        build_contributions_for_source,
        build_manifest,
        remove_source,
        source_id_from_path,
        source_revision_from_bytes,
    )

    topic = Path(args.topic_root)
    topic.mkdir(parents=True, exist_ok=True)
    (topic / "wiki" / "concepts").mkdir(parents=True, exist_ok=True)
    source_path = args.source_path
    source_id = source_id_from_path(source_path)

    if args.mode == "revise":
        v1 = build_contributions_for_source(
            source_id=source_id,
            source_path=source_path,
            source_revision=source_revision_from_bytes(b"v1"),
            concepts=[{"name": "Lifecycle Alpha", "definition": "E2E concept"}],
            claims=[
                {
                    "content": "Alpha depends on durable maintenance",
                    "conceptKeys": ["lifecycle-alpha"],
                },
                {
                    "content": "Shared support remains after revision",
                    "conceptKeys": ["lifecycle-alpha"],
                },
            ],
            summary_sections=[{"heading": "Overview", "text": "v1 summary"}],
        )
        m1 = build_manifest(
            source_id=source_id,
            source_revision=source_revision_from_bytes(b"v1"),
            contributions=v1,
        )
        apply_source_revision(topic, m1, force_full_rebuild=False)

        v2 = build_contributions_for_source(
            source_id=source_id,
            source_path=source_path,
            source_revision=source_revision_from_bytes(b"v2"),
            concepts=[{"name": "Lifecycle Alpha", "definition": "E2E concept revised"}],
            claims=[
                {
                    "content": "Shared support remains after revision",
                    "conceptKeys": ["lifecycle-alpha"],
                },
            ],
            summary_sections=[{"heading": "Overview", "text": "v2 summary"}],
        )
        m2 = build_manifest(
            source_id=source_id,
            source_revision=source_revision_from_bytes(b"v2"),
            contributions=v2,
        )
        result = apply_source_revision(topic, m2, force_full_rebuild=False)
        page = topic / "wiki" / "concepts" / "lifecycle-alpha.md"
        text = page.read_text("utf-8") if page.exists() else ""
        print(
            json.dumps(
                {
                    "activated": result.activated_manifest_id,
                    "deactivated": result.deactivated_manifest_ids,
                    "conceptExists": page.exists(),
                    "hasObsolete": "Alpha depends on durable maintenance" in text,
                    "hasShared": "Shared support remains after revision" in text,
                }
            )
        )
        return 0

    result = remove_source(topic, source_id, force_full_rebuild=False)
    page = topic / "wiki" / "concepts" / "lifecycle-alpha.md"
    print(
        json.dumps(
            {
                "deactivated": result.deactivated_manifest_ids,
                "conceptExists": page.exists(),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
