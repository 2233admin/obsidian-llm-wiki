#!/usr/bin/env python
"""Report-only knowledge health checks for an LLMwiki vault."""
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path


WIKILINK_RE = re.compile(r"\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]")


@dataclass
class Finding:
    severity: str
    code: str
    path: str
    message: str


def slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug)
    return slug.strip("-")[:80]


def rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def markdown_files(vault: Path) -> list[Path]:
    return [
        p for p in vault.rglob("*.md")
        if ".git" not in p.parts and ".obsidian" not in p.parts and ".trash" not in p.parts
    ]


def note_targets(files: list[Path], vault: Path) -> set[str]:
    targets: set[str] = set()
    for path in files:
        rel_path = rel(path, vault)
        no_ext = rel_path[:-3]
        targets.add(no_ext)
        targets.add(path.stem)
    return targets


def parse_frontmatter(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end == -1:
        return {}
    fm: dict[str, object] = {}
    current_key: str | None = None
    current_items: list[str] = []
    for raw_line in text[4:end].splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue
        if line.startswith("  - ") and current_key:
            current_items.append(line[4:].strip().strip('"'))
            fm[current_key] = current_items
            continue
        current_key = None
        current_items = []
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not value:
            current_key = key
            current_items = []
            fm[key] = current_items
        elif value.startswith("[") and value.endswith("]"):
            fm[key] = [item.strip().strip('"') for item in value[1:-1].split(",") if item.strip()]
        else:
            fm[key] = value.strip('"')
    return fm


def as_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]


def wikilink_target(value: str) -> str:
    match = WIKILINK_RE.search(value)
    target = match.group(1) if match else value
    return target.strip().replace("\\", "/").removesuffix(".md")


def target_exists(target: str, targets: set[str]) -> bool:
    normalized = wikilink_target(target)
    return bool(normalized and normalized in targets)


def check_uncompiled_raw(vault: Path, findings: list[Finding]) -> None:
    for raw_dir in [p for p in vault.rglob("raw") if p.is_dir()]:
        topic = raw_dir.parent
        summaries = topic / "wiki" / "summaries"
        for source in raw_dir.rglob("*.md"):
            expected = summaries / f"{slugify(source.stem)}.md"
            if not expected.exists():
                findings.append(Finding(
                    "warn",
                    "uncompiled-raw",
                    rel(source, vault),
                    f"no compiled summary at {rel(expected, vault)}",
                ))


def check_broken_wikilinks(vault: Path, files: list[Path], findings: list[Finding]) -> None:
    targets = note_targets(files, vault)
    for path in files:
        text = path.read_text(encoding="utf-8-sig", errors="replace")
        for target in WIKILINK_RE.findall(text):
            normalized = target.strip().replace("\\", "/").removesuffix(".md")
            if normalized and normalized not in targets:
                findings.append(Finding(
                    "warn",
                    "broken-wikilink",
                    rel(path, vault),
                    f"wikilink target not found: [[{target}]]",
                ))


def source_from_summary(summary: Path) -> str | None:
    text = summary.read_text(encoding="utf-8-sig", errors="replace")[:1000]
    match = re.search(r"> Source:\s*`([^`]+)`", text)
    return match.group(1) if match else None


def check_stale_summaries(vault: Path, findings: list[Finding]) -> None:
    for summaries in [p for p in vault.rglob("wiki/summaries") if p.is_dir()]:
        topic = summaries.parent.parent
        for summary in summaries.glob("*.md"):
            source_rel = source_from_summary(summary)
            if not source_rel:
                findings.append(Finding("warn", "summary-source-missing", rel(summary, vault), "compiled summary does not declare a source"))
                continue
            source = topic / source_rel
            if not source.exists():
                findings.append(Finding("warn", "summary-source-gone", rel(summary, vault), f"source no longer exists: {source_rel}"))
            elif source.stat().st_mtime > summary.stat().st_mtime:
                findings.append(Finding("warn", "stale-summary", rel(summary, vault), f"source is newer than summary: {source_rel}"))


def check_orphan_concepts(vault: Path, files: list[Path], findings: list[Finding]) -> None:
    all_text_by_path = {
        path: path.read_text(encoding="utf-8-sig", errors="replace")
        for path in files
    }
    for concepts in [p for p in vault.rglob("wiki/concepts") if p.is_dir()]:
        for concept in concepts.glob("*.md"):
            stem = concept.stem
            title = stem
            text = all_text_by_path.get(concept, "")
            for line in text.splitlines():
                if line.startswith("# "):
                    title = line[2:].strip()
                    break
            linked = False
            for path, body in all_text_by_path.items():
                if path == concept or "/wiki/concepts/" in rel(path, vault):
                    continue
                if f"[[{stem}]]" in body or f"[[{title}]]" in body:
                    linked = True
                    break
            if not linked:
                findings.append(Finding("warn", "orphan-concept", rel(concept, vault), "no non-concept note links to this concept"))


def check_contradictions(vault: Path, findings: list[Finding]) -> None:
    for path in vault.rglob("wiki/_contradictions.md"):
        text = path.read_text(encoding="utf-8-sig", errors="replace")
        unresolved = len(re.findall(r"(?im)^\*\*Resolution\*\*:\s*unresolved\b", text))
        if unresolved:
            findings.append(Finding("warn", "unresolved-contradictions", rel(path, vault), f"{unresolved} unresolved contradiction(s)"))


def check_query_output_chain(vault: Path, files: list[Path], findings: list[Finding]) -> None:
    targets = note_targets(files, vault)
    for query in vault.rglob("wiki/queries/*.md"):
        fm = parse_frontmatter(query)
        filed_output = str(fm.get("filed-output", "")).strip()
        promoted_to = str(fm.get("promoted-to", "")).strip()
        if not filed_output:
            findings.append(Finding("warn", "query-output-missing", rel(query, vault), "query note does not declare filed-output"))
        elif not target_exists(filed_output, targets):
            findings.append(Finding("warn", "query-output-broken", rel(query, vault), f"filed-output target not found: {filed_output}"))
        if promoted_to and not target_exists(promoted_to, targets):
            findings.append(Finding("warn", "query-promotion-broken", rel(query, vault), f"promoted-to target not found: {promoted_to}"))
        source_nodes = as_list(fm.get("source-nodes"))
        if not source_nodes:
            findings.append(Finding("warn", "query-sources-missing", rel(query, vault), "query note does not declare source-nodes"))
        for source in source_nodes:
            if not target_exists(source, targets):
                findings.append(Finding("warn", "query-source-broken", rel(query, vault), f"source-node target not found: {source}"))


def check_ai_output_chain(vault: Path, files: list[Path], findings: list[Finding]) -> None:
    targets = note_targets(files, vault)
    all_text = {rel(path, vault)[:-3]: path.read_text(encoding="utf-8-sig", errors="replace") for path in files}
    ai_root = vault / "00-Inbox" / "AI-Output"
    outputs = ai_root.rglob("*.md") if ai_root.exists() else []
    for output in outputs:
        fm = parse_frontmatter(output)
        output_rel = rel(output, vault)[:-3]
        source_nodes = as_list(fm.get("source-nodes"))
        for source in source_nodes:
            normalized = wikilink_target(source)
            if not target_exists(source, targets):
                findings.append(Finding("warn", "ai-output-source-broken", rel(output, vault), f"source-node target not found: {source}"))
            elif "/wiki/" not in normalized:
                findings.append(Finding("warn", "ai-output-source-not-compiled", rel(output, vault), f"source-node should cite compiled wiki output: {source}"))

        promoted = fm.get("quarantine-state") == "promoted"
        if promoted:
            linked_durable = [
                target for target in WIKILINK_RE.findall(output.read_text(encoding="utf-8-sig", errors="replace"))
                if target.startswith(("20-Decisions/", "30-Architecture/", "40-Runbooks/"))
            ]
            if not linked_durable:
                findings.append(Finding("warn", "promoted-output-missing-durable-link", rel(output, vault), "promoted AI output does not link to a durable reviewed note"))
                continue
            for durable in linked_durable:
                durable_text = all_text.get(wikilink_target(durable), "")
                if f"[[{output_rel}]]" not in durable_text:
                    findings.append(Finding("warn", "durable-missing-promotion-backlink", rel(output, vault), f"durable note does not backlink to promoted output: {durable}"))


def run(vault: Path) -> dict:
    files = markdown_files(vault)
    findings: list[Finding] = []
    check_uncompiled_raw(vault, findings)
    check_broken_wikilinks(vault, files, findings)
    check_stale_summaries(vault, findings)
    check_orphan_concepts(vault, files, findings)
    check_contradictions(vault, findings)
    check_query_output_chain(vault, files, findings)
    check_ai_output_chain(vault, files, findings)
    findings = sorted(findings, key=lambda f: (f.severity != "error", f.path, f.code, f.message))
    return {
        "vault": str(vault),
        "ok": not any(f.severity == "error" for f in findings),
        "findings": [f.__dict__ for f in findings],
        "summary": {
            "warn": sum(1 for f in findings if f.severity == "warn"),
            "error": sum(1 for f in findings if f.severity == "error"),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Report-only LLMwiki knowledge quality checks.")
    parser.add_argument("--vault", required=True, help="Path to the markdown vault")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    parser.add_argument("--fail-on-error", action="store_true", help="Return non-zero if error findings are present")
    args = parser.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    if not vault.exists():
        raise SystemExit(f"vault path does not exist: {vault}")
    data = run(vault)
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        if not data["findings"]:
            print("OK: no knowledge health findings")
        for item in data["findings"]:
            print(f"{item['severity'].upper()} {item['code']} {item['path']}: {item['message']}")
    return 1 if args.fail_on_error and data["summary"]["error"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
