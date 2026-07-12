"""
Scout Ship — Vault discovery and significance assessment.

Responsibilities:
- Scan vault for issues (broken links, orphans, stale, contradictions)
- Assess significance of each issue
- Generate prioritized report
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from .message import Issue, SignificanceScore


class ScoutShip:
    """
    Scout ship for vault discovery.

    Usage:
        scout = ScoutShip(vault="/path/to/vault")
        report = scout.scan(scope=["01-Projects", "02-Infrastructure"])

        # Or use the CLI adapter
        scout = ScoutShip(vault="/path/to/vault")
        result = scout.run(scope={"directories": ["01-Projects"]})
    """

    def __init__(self, vault: str, compiler_path: str | None = None):
        self.vault = Path(vault)
        self.compiler_path = Path(compiler_path) if compiler_path else self.vault.parent / "compiler"

    def scan(
        self,
        directories: list[str] | None = None,
        issue_types: list[str] | None = None,
    ) -> dict[str, Any]:
        """
        Scan vault for issues.

        Args:
            directories: List of directories to scan (None = all)
            issue_types: Types to check (None = all)
                Options: "broken_link", "orphan", "stale", "contradiction"

        Returns:
            dict with issues, significance_scores, summary, stats
        """
        if issue_types is None:
            issue_types = ["broken_link", "orphan", "stale", "contradiction"]

        issues: list[Issue] = []
        all_scores: list[SignificanceScore] = []

        # 1. Broken links check
        if "broken_link" in issue_types:
            broken_links = self._check_broken_links(directories)
            issues.extend(broken_links)

        # 2. Orphan pages check
        if "orphan" in issue_types:
            orphans = self._check_orphans(directories)
            issues.extend(orphans)

        # 3. Stale content check
        if "stale" in issue_types:
            stale = self._check_stale(directories)
            issues.extend(stale)

        # 4. Contradictions check
        if "contradiction" in issue_types:
            contradictions = self._check_contradictions(directories)
            issues.extend(contradictions)

        # 5. Assess significance for each issue
        for issue in issues:
            score = self._assess_significance(issue)
            all_scores.append(score)

        # 6. Generate summary
        summary = self._generate_summary(issues, all_scores)

        # 7. Stats
        stats = {
            "total_issues": len(issues),
            "by_severity": self._count_by_severity(issues),
            "by_type": self._count_by_type(issues),
        }

        return {
            "issues": [i.to_dict() for i in issues],
            "significance_scores": [s.to_dict() for s in all_scores],
            "summary": summary,
            "stats": stats,
        }

    def _check_broken_links(self, directories: list[str] | None) -> list[Issue]:
        """Check for broken wikilinks."""
        issues: list[Issue] = []

        # Use kb_meta check-links if available
        kb_meta = self.compiler_path / "kb_meta.py"
        if kb_meta.exists():
            try:
                result = subprocess.run(
                    [sys.executable, str(kb_meta), "check-links", str(self.vault)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=60,
                )
                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    for broken in data.get("broken", []):
                        issues.append(Issue(
                            id=f"broken_link_{len(issues)}",
                            severity="high",
                            type="broken_link",
                            location=broken.get("from", "unknown"),
                            description=f"Broken link: {broken.get('to', 'unknown')}",
                            suggestion="Fix or remove the broken link",
                        ))
            except (subprocess.TimeoutExpired, json.JSONDecodeError):
                pass

        # Fallback: manual scan
        if not issues:
            issues = self._manual_broken_link_check(directories)

        return issues

    def _manual_broken_link_check(self, directories: list[str] | None) -> list[Issue]:
        """Fallback manual broken link check with relative path support."""
        issues: list[Issue] = []

        scan_dirs = self._resolve_directories(directories)
        wikilink_pattern = re.compile(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]')

        all_files: set[str] = set()
        all_dirs: set[str] = set()
        for scan_dir in scan_dirs:
            # Add all subdirectories (统一用 /)
            for dir_path in scan_dir.rglob("*"):
                if dir_path.is_dir():
                    rel = str(dir_path.relative_to(self.vault)).replace("\\", "/")
                    all_dirs.add(rel)
            for md_file in scan_dir.rglob("*.md"):
                rel = str(md_file.relative_to(self.vault)).replace("\\", "/")
                all_files.add(Path(rel).stem)
                all_files.add(rel)
                all_files.add(rel.removesuffix(".md"))
                # Also add parent dir path
                if Path(rel).parent != Path("."):
                    all_files.add(str(Path(rel).parent))

        for scan_dir in scan_dirs:
            for md_file in scan_dir.rglob("*.md"):
                content = md_file.read_text(encoding="utf-8", errors="replace")
                # Get source file's directory
                source_dir = str(md_file.parent.relative_to(self.vault)).replace("\\", "/")
                
                for match in wikilink_pattern.finditer(content):
                    link = match.group(1)
                    if link.startswith(("http://", "https://", "#")):
                        continue

                    # Simple relative resolution
                    resolved = link
                    if link.startswith("../"):
                        # Count ../ and strip from source dir
                        parts = link.split("/")
                        depth = parts.count("..")
                        up_parts = source_dir.split("/")
                        base = up_parts[:-depth] if depth <= len(up_parts) else []
                        resolved = "/".join(base + [p for p in parts[depth:] if p])
                    elif "/" not in link:
                        # Same dir link without path - check if it's a file or dir
                        # For now, don't prepend - assume it's relative to vault
                        # (most Obsidian vaults use this convention)
                        resolved = link

                    # Normalize - strip anchor first
                    normalized = resolved.strip("/").rstrip(".md")
                    # Remove anchor if present
                    if "#" in normalized:
                        normalized = normalized.split("#")[0]
                    normalized = normalized.replace("\\", "/")

                    # Try both vault-root and source-dir relative paths
                    candidates = [normalized]
                    if "/" not in normalized and source_dir != ".":
                        # Same-dir link without path - also try relative to source
                        candidates.append(f"{source_dir}/{normalized}")
                    
                    target_exists = False
                    for cand in candidates:
                        if (
                            (self.vault / f"{cand}.md").exists() or
                            (self.vault / cand).exists() or
                            (self.vault / cand / "index.md").exists() or
                            cand in all_files or
                            cand in all_dirs or
                            f"{cand}/index" in all_files
                        ):
                            target_exists = True
                            break

                    if not target_exists:
                        issues.append(Issue(
                            id=f"broken_link_{len(issues)}",
                            severity="high",
                            type="broken_link",
                            location=str(md_file.relative_to(self.vault)),
                            description=f"Broken wikilink: [[{link}]]",
                            suggestion=f"Fix or remove link to {link}",
                        ))

        return issues

    def _check_orphans(self, directories: list[str] | None) -> list[Issue]:
        """Check for orphan pages (no incoming links)."""
        issues: list[Issue] = []

        scan_dirs = self._resolve_directories(directories)
        wikilink_pattern = re.compile(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]]')

        # Build link graph
        links_to: dict[str, set[str]] = {}  # file -> files it links to
        linked_from: dict[str, set[str]] = {}  # file -> files that link to it

        for scan_dir in scan_dirs:
            for md_file in scan_dir.rglob("*.md"):
                rel = str(md_file.relative_to(self.vault))
                links_to[rel] = set()
                linked_from.setdefault(rel, set())

                content = md_file.read_text(encoding="utf-8", errors="replace")
                for match in wikilink_pattern.finditer(content):
                    target = match.group(1)
                    links_to[rel].add(target)

                    # Track reverse link
                    target_path = f"{target}.md"
                    linked_from.setdefault(target_path, set()).add(rel)

        # Find orphans (no incoming links, not index files)
        skip_patterns = ("index.md", "Home.md", "README.md", "_index.md")
        for file_path, from_files in linked_from.items():
            if not from_files:
                # Skip index files
                if any(file_path.endswith(p) for p in skip_patterns):
                    continue

                # Skip root-level files
                if "/" not in file_path and "\\" not in file_path:
                    continue

                issues.append(Issue(
                    id=f"orphan_{len(issues)}",
                    severity="medium",
                    type="orphan",
                    location=file_path,
                    description="Page has no incoming links (orphan)",
                    suggestion="Add links from related pages or consider archiving",
                ))

        return issues

    def _check_stale(self, directories: list[str] | None) -> list[Issue]:
        """Check for stale content."""
        from datetime import datetime, timezone, timedelta

        issues: list[Issue] = []
        scan_dirs = self._resolve_directories(directories)

        # Content older than 6 months is considered stale
        stale_threshold = timedelta(days=180)
        now = datetime.now(timezone.utc)

        for scan_dir in scan_dirs:
            for md_file in scan_dir.rglob("*.md"):
                # Skip special files
                if md_file.name.startswith("_") or md_file.name.startswith("."):
                    continue

                mtime = datetime.fromtimestamp(md_file.stat().st_mtime, tz=timezone.utc)
                age = now - mtime

                if age > stale_threshold:
                    issues.append(Issue(
                        id=f"stale_{len(issues)}",
                        severity="low",
                        type="stale",
                        location=str(md_file.relative_to(self.vault)),
                        description=f"Content is {age.days} days old",
                        suggestion="Review and update if still relevant",
                    ))

        return issues

    def _check_contradictions(self, directories: list[str] | None) -> list[Issue]:
        """Check for contradictions in wiki/_contradictions.md."""
        issues: list[Issue] = []

        scan_dirs = self._resolve_directories(directories)
        contradiction_file = None

        for scan_dir in scan_dirs:
            if (scan_dir / "_contradictions.md").exists():
                contradiction_file = scan_dir / "_contradictions.md"
                break

        if contradiction_file and contradiction_file.exists():
            content = contradiction_file.read_text(encoding="utf-8", errors="replace")

            # Parse contradiction entries
            unresolved = re.findall(r'\*\*Resolution\*\*:\s*(unresolved)', content, re.IGNORECASE)

            for i, match in enumerate(unresolved):
                issues.append(Issue(
                    id=f"contradiction_{i}",
                    severity="high",
                    type="contradiction",
                    location=str(contradiction_file.relative_to(self.vault)),
                    description=f"Unresolved contradiction (total: {len(unresolved)})",
                    suggestion="Resolve the contradiction or mark as intentionally ambiguous",
                ))

        return issues

    def _assess_significance(self, issue: Issue) -> SignificanceScore:
        """Assess the significance of an issue."""
        # Severity mapping
        severity_map = {
            "critical": ("high", "Critical issue affects vault integrity"),
            "high": ("high", "High priority issue needs attention"),
            "medium": ("medium", "Medium priority, should fix eventually"),
            "low": ("low", "Low priority, optional to fix"),
        }

        effort_map = {
            "broken_link": "low",
            "orphan": "medium",
            "stale": "low",
            "contradiction": "high",
        }

        impact, reasoning = severity_map.get(
            issue.severity,
            ("medium", "Standard priority issue")
        )

        effort = effort_map.get(issue.type, "medium")

        return SignificanceScore(
            item=issue.id,
            entity=issue.location,
            severity=severity_map.get(issue.severity, ("medium", ""))[0],
            impact=reasoning,
            effort=effort,
            reasoning=f"{issue.type} at {issue.location}: {issue.description}",
        )

    def _generate_summary(self, issues: list[Issue], scores: list[SignificanceScore]) -> str:
        """Generate one-line summary."""
        if not issues:
            return "Vault scan complete. No issues found."

        by_severity = self._count_by_severity(issues)
        critical = by_severity.get("critical", 0)
        high = by_severity.get("high", 0)

        if critical > 0:
            return f"⚠️ {len(issues)} issues found ({critical} critical, {high} high priority)"
        elif high > 0:
            return f"⚡ {len(issues)} issues found ({high} high priority)"
        else:
            return f"✓ {len(issues)} issues found (mostly low/medium priority)"

    def _count_by_severity(self, issues: list[Issue]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for issue in issues:
            counts[issue.severity] = counts.get(issue.severity, 0) + 1
        return counts

    def _count_by_type(self, issues: list[Issue]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for issue in issues:
            counts[issue.type] = counts.get(issue.type, 0) + 1
        return counts

    def _resolve_directories(self, directories: list[str] | None) -> list[Path]:
        """Resolve directory paths relative to vault."""
        if directories:
            return [self.vault / d for d in directories]
        return [self.vault]

    def run(self, scope: dict[str, Any] | None = None) -> dict[str, Any]:
        """
        Run scout as a standalone CLI.

        Usage:
            scout = ScoutShip(vault="/path/to/vault")
            result = scout.run(scope={"directories": ["01-Projects"]})
        """
        scope = scope or {}
        directories = scope.get("directories")
        issue_types = scope.get("types")

        return self.scan(directories=directories, issue_types=issue_types)


# CLI entry point
def main():
    """CLI for scout ship."""
    import argparse

    parser = argparse.ArgumentParser(description="Scout ship for vault scanning")
    parser.add_argument("vault", help="Vault path")
    parser.add_argument("--directories", nargs="+", help="Directories to scan")
    parser.add_argument("--types", nargs="+", choices=["broken_link", "orphan", "stale", "contradiction"],
                        help="Issue types to check")
    parser.add_argument("--json", action="store_true", help="Output JSON")

    args = parser.parse_args()

    scout = ScoutShip(vault=args.vault)
    result = scout.scan(directories=args.directories, issue_types=args.types)

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(result["summary"])
        print("\nIssues by type:")
        for issue_type, count in result["stats"]["by_type"].items():
            print(f"  {issue_type}: {count}")
        print("\nIssues by severity:")
        for severity, count in result["stats"]["by_severity"].items():
            print(f"  {severity}: {count}")


if __name__ == "__main__":
    main()
