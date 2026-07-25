#!/usr/bin/env python3
"""Verify the Obsidian community-plugin distribution contract."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
ASSETS = ("main.js", "manifest.json", "styles.css")


def verify(root: Path, tag: str | None = None, assets: Path | None = None) -> None:
    manifest = json.loads((root / "obsidian-plugin/manifest.json").read_text())
    root_manifest = json.loads((root / "manifest.json").read_text())
    versions = json.loads((root / "obsidian-plugin/versions.json").read_text())
    root_versions = json.loads((root / "versions.json").read_text())

    assert root_manifest == manifest, "root manifest.json must match obsidian-plugin/manifest.json"
    assert root_versions == versions, "root versions.json must match obsidian-plugin/versions.json"
    assert SEMVER.fullmatch(manifest["version"]), "manifest version must be semantic"
    assert versions.get(manifest["version"]) == manifest["minAppVersion"], (
        "versions.json must map the current version to minAppVersion"
    )
    if tag:
        assert tag == manifest["version"], "release tag must exactly match manifest version"
    if assets:
        for name in ASSETS:
            assert (assets / name).is_file(), f"missing release asset: {name}"
        assert json.loads((assets / "manifest.json").read_text()) == manifest, (
            "release manifest.json must match the canonical manifest"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--tag")
    parser.add_argument("--assets", type=Path)
    args = parser.parse_args()
    verify(args.root, args.tag, args.assets)
    print("Obsidian distribution contract: OK")


if __name__ == "__main__":
    main()
