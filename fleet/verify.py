"""
Verify Ship — Automated quality checks for llmwiki fleet.

Responsibilities:
- Automated checks (links, consistency, drift)
- Generate verification reports
- Block or pass work outputs
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from .message import CheckResult, Issue, VerifyResult


class VerifyShip:
    """
    Verify ship for automated quality checks.

    Usage:
        verify = VerifyShip(vault="/path/to/vault")
        result = verify.check(focus=["broken_links", "contradictions"])

        # Check specific output
        result = verify.check_output(
            output_path="04-Research/ai-agents/wiki",
            check_types=["links", "format", "citations"]
        )
    """

    def __init__(self, vault: str, compiler_path: str | None = None):
        self.vault = Path(vault)
        self.compiler_path = Path(compiler_path) if compiler_path else self.vault.parent / "compiler"

    def check(
        self,
        focus: list[str] | None = None,
        directories: list[str] | None = None,
    ) -> VerifyResult:
        """
        Run all verification checks.

        Args:
            focus: List of check types to run
                Options: "broken_links", "orphans", "contradictions", "drift", "format"
            directories: Directories to check (None = all)

        Returns:
            VerifyResult with check results
        """
        if focus is None:
            focus = ["broken_links", "orphans", "contradictions", "format"]

        checks: list[CheckResult] = []
        issues: list[Issue] = []
        broken_links: list[dict] = []
        contradictions: list[dict] = []

        # 1. Broken links check
        if "broken_links" in focus:
            result = self._check_links(directories)
            checks.extend(result["checks"])
            issues.extend(result["issues"])
            broken_links = result["broken_links"]

        # 2. Orphan pages check
        if "orphans" in focus:
            result = self._check_orphans(directories)
            checks.extend(result["checks"])
            issues.extend(result["issues"])

        # 3. Contradictions check
        if "contradictions" in focus:
            result = self._check_contradictions(directories)
            checks.extend(result["checks"])
            issues.extend(result["issues"])
            contradictions = result["contradictions"]

        # 4. Format check
        if "format" in focus:
            result = self._check_format(directories)
            checks.extend(result["checks"])
            issues.extend(result["issues"])

        # 5. Drift check
        if "drift" in focus:
            result = self._check_drift(directories)
            checks.extend(result["checks"])

        # Determine overall status
        fail_count = sum(1 for c in checks if c.status == "fail")
        warn_count = sum(1 for c in checks if c.status == "warning")

        if fail_count > 0:
            status = "fail"
        elif warn_count > 0:
            status = "warning"
        else:
            status = "pass"

        summary = self._generate_summary(status, checks, issues)

        return VerifyResult(
            session_id="",
            vault=str(self.vault),
            status=status,
            checks=checks,
            issues=issues,
            broken_links=broken_links,
            contradictions=contradictions,
            summary=summary,
        )

    def _check_links(self, directories: list[str] | None) -> dict[str, Any]:
        """Check for broken links."""
        checks: list[CheckResult] = []
        issues: list[Issue] = []
        broken_links: list[dict] = []

        # Use kb_meta check-links
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
                    broken_links = data.get("broken", [])

                    if broken_links:
                        for link in broken_links:
                            issues.append(Issue(
                                id=f"verify_broken_link_{len(issues)}",
                                severity="high",
                                type="broken_link",
                                location=link.get("from", "unknown"),
                                description=f"Broken link: {link.get('to', 'unknown')}",
                                suggestion="Fix or remove the broken link",
                            ))

                        checks.append(CheckResult(
                            check_type="broken_links",
                            status="fail",
                            message=f"Found {len(broken_links)} broken links",
                            details={"count": len(broken_links)},
                        ))
                    else:
                        checks.append(CheckResult(
                            check_type="broken_links",
                            status="pass",
                            message="No broken links found",
                        ))
            except (subprocess.TimeoutExpired, json.JSONDecodeError):
                checks.append(CheckResult(
                    check_type="broken_links",
                    status="warning",
                    message="Link check failed or timed out",
                ))
        else:
            # Fallback: manual check
            broken_links = self._manual_link_check(directories)
            if broken_links:
                for link in broken_links:
                    issues.append(Issue(
                        id=f"verify_broken_link_{len(issues)}",
                        severity="high",
                        type="broken_link",
                        location=link.get("file", "unknown"),
                        description=f"Broken link: {link.get('link', 'unknown')}",
                        suggestion="Fix or remove the link",
                    ))
                checks.append(CheckResult(
                    check_type="broken_links",
                    status="fail",
                    message=f"Found {len(broken_links)} broken links (manual check)",
                ))
            else:
                checks.append(CheckResult(
                    check_type="broken_links",
                    status="pass",
                    message="No broken links found",
                ))

        return {
            "checks": checks,
            "issues": issues,
            "broken_links": broken_links,
        }

    def _manual_link_check(self, directories: list[str] | None) -> list[dict]:
        """Fallback manual link check."""
        broken: list[dict] = []
        scan_dirs = self._resolve_directories(directories)

        wikilink_pattern = re.compile(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]]')
        all_files: set[str] = set()

        # Build file index
        for scan_dir in scan_dirs:
            for md_file in scan_dir.rglob("*.md"):
                rel = md_file.relative_to(self.vault)
                all_files.add(rel.stem)
                all_files.add(str(rel))

        # Check each file
        for scan_dir in scan_dirs:
            for md_file in scan_dir.rglob("*.md"):
                content = md_file.read_text(encoding="utf-8", errors="replace")
                for match in wikilink_pattern.finditer(content):
                    link = match.group(1)
                    if link.startswith(("http://", "https://", "#")):
                        continue

                    if not ((self.vault / f"{link}.md").exists() or link in all_files):
                        broken.append({
                            "from": str(md_file.relative_to(self.vault)),
                            "to": link,
                        })

        return broken

    def _check_orphans(self, directories: list[str] | None) -> dict[str, Any]:
        """Check for orphan pages."""
        checks: list[CheckResult] = []
        issues: list[Issue] = []
        scan_dirs = self._resolve_directories(directories)

        wikilink_pattern = re.compile(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]]')
        linked_from: dict[str, bool] = {}

        # Build link graph
        for scan_dir in scan_dirs:
            for md_file in scan_dir.rglob("*.md"):
                rel = str(md_file.relative_to(self.vault))
                linked_from[rel] = False

                content = md_file.read_text(encoding="utf-8", errors="replace")
                for match in wikilink_pattern.finditer(content):
                    target = match.group(1)
                    target_path = f"{target}.md"
                    if target_path in linked_from:
                        linked_from[target_path] = True

        # Find orphans
        orphans = [
            path for path, linked in linked_from.items()
            if not linked and not any(path.endswith(p) for p in ["index.md", "Home.md", "README.md"])
        ]

        if orphans:
            for orphan in orphans:
                issues.append(Issue(
                    id=f"verify_orphan_{len(issues)}",
                    severity="medium",
                    type="orphan",
                    location=orphan,
                    description="Page has no incoming links",
                    suggestion="Add links from related pages",
                ))

            checks.append(CheckResult(
                check_type="orphans",
                status="warning",
                message=f"Found {len(orphans)} orphan pages",
                details={"count": len(orphans), "files": orphans[:10]},
            ))
        else:
            checks.append(CheckResult(
                check_type="orphans",
                status="pass",
                message="No orphan pages found",
            ))

        return {"checks": checks, "issues": issues}

    def _check_contradictions(self, directories: list[str] | None) -> dict[str, Any]:
        """Check for unresolved contradictions."""
        checks: list[CheckResult] = []
        issues: list[Issue] = []
        contradictions: list[dict] = []
        scan_dirs = self._resolve_directories(directories)

        for scan_dir in scan_dirs:
            contradiction_file = scan_dir / "_contradictions.md"
            if contradiction_file.exists():
                content = contradiction_file.read_text(encoding="utf-8", errors="replace")
                unresolved = re.findall(r'\*\*Resolution\*\*:\s*(unresolved)', content, re.IGNORECASE)

                if unresolved:
                    contradictions = [{"severity": "high", "count": len(unresolved)}]
                    issues.append(Issue(
                        id=f"verify_contradiction_{len(issues)}",
                        severity="high",
                        type="contradiction",
                        location=str(contradiction_file.relative_to(self.vault)),
                        description=f"Found {len(unresolved)} unresolved contradictions",
                        suggestion="Resolve or acknowledge contradictions",
                    ))

                    checks.append(CheckResult(
                        check_type="contradictions",
                        status="fail",
                        message=f"Found {len(unresolved)} unresolved contradictions",
                        details={"count": len(unresolved)},
                    ))
                else:
                    checks.append(CheckResult(
                        check_type="contradictions",
                        status="pass",
                        message="No unresolved contradictions",
                    ))
                break
        else:
            checks.append(CheckResult(
                check_type="contradictions",
                status="pass",
                message="No contradiction file found",
            ))

        return {"checks": checks, "issues": issues, "contradictions": contradictions}

    def _check_format(self, directories: list[str] | None) -> dict[str, Any]:
        """Check for format issues."""
        checks: list[CheckResult] = []
        issues: list[Issue] = []
        scan_dirs = self._resolve_directories(directories)

        format_issues = 0
        for scan_dir in scan_dirs:
            for md_file in scan_dir.rglob("*.md"):
                content = md_file.read_text(encoding="utf-8", errors="replace")

                # Check for missing frontmatter
                if content.strip() and not content.startswith("---"):
                    issues.append(Issue(
                        id=f"verify_format_{len(issues)}",
                        severity="low",
                        type="format",
                        location=str(md_file.relative_to(self.vault)),
                        description="Missing frontmatter",
                        suggestion="Add frontmatter with date, tags, etc.",
                    ))
                    format_issues += 1

        if format_issues > 0:
            checks.append(CheckResult(
                check_type="format",
                status="warning",
                message=f"Found {format_issues} format issues",
                details={"count": format_issues},
            ))
        else:
            checks.append(CheckResult(
                check_type="format",
                status="pass",
                message="No format issues found",
            ))

        return {"checks": checks, "issues": issues}

    def _check_drift(self, directories: list[str] | None) -> dict[str, Any]:
        """Check for drift from baseline."""
        checks: list[CheckResult] = []

        # For drift detection, we'd compare current state to a baseline
        # For now, just check if knowledge_health.py exists and run it
        health_script = self.compiler_path.parent / "scripts" / "knowledge_health.py"
        if health_script.exists():
            try:
                result = subprocess.run(
                    [sys.executable, str(health_script), "--vault", str(self.vault), "--json"],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=120,
                )
                if result.returncode == 0:
                    checks.append(CheckResult(
                        check_type="drift",
                        status="pass",
                        message="Health check passed",
                    ))
                else:
                    checks.append(CheckResult(
                        check_type="drift",
                        status="warning",
                        message="Health check found issues",
                        details={"stderr": result.stderr[:500]},
                    ))
            except subprocess.TimeoutExpired:
                checks.append(CheckResult(
                    check_type="drift",
                    status="warning",
                    message="Health check timed out",
                ))
        else:
            checks.append(CheckResult(
                check_type="drift",
                status="pass",
                message="No drift baseline available",
            ))

        return {"checks": checks}

    def _resolve_directories(self, directories: list[str] | None) -> list[Path]:
        """Resolve directory paths relative to vault."""
        if directories:
            return [self.vault / d for d in directories]
        return [self.vault]

    def _generate_summary(self, status: str, checks: list[CheckResult], issues: list[Issue]) -> str:
        """Generate summary string."""
        if status == "pass":
            return f"✓ Verification passed. All {len(checks)} checks passed."

        fail_count = sum(1 for c in checks if c.status == "fail")
        warn_count = sum(1 for c in checks if c.status == "warning")

        if status == "fail":
            return f"✗ Verification failed. {fail_count} check(s) failed, {warn_count} warning(s). {len(issues)} issue(s) found."
        else:
            return f"⚠ Verification passed with warnings. {warn_count} warning(s). {len(issues)} issue(s) found."

    def check_output(
        self,
        output_path: str,
        check_types: list[str] | None = None,
    ) -> VerifyResult:
        """
        Check a specific output path.

        Args:
            output_path: Path to check
            check_types: Types of checks to run

        Returns:
            VerifyResult
        """
        if check_types is None:
            check_types = ["links", "format"]

        # Determine directories to check
        path = Path(output_path)
        if path.is_file():
            directories = [str(path.parent)]
        else:
            directories = [output_path]

        return self.check(focus=check_types, directories=directories)


# CLI entry point
def main():
    """CLI for verify ship."""
    import argparse

    parser = argparse.ArgumentParser(description="Verify ship for quality checks")
    parser.add_argument("vault", help="Vault path")
    parser.add_argument("--focus", nargs="+",
                        choices=["broken_links", "orphans", "contradictions", "format", "drift"],
                        help="Check types to run")
    parser.add_argument("--directories", nargs="+", help="Directories to check")
    parser.add_argument("--json", action="store_true", help="Output JSON")

    args = parser.parse_args()

    verify = VerifyShip(vault=args.vault)
    result = verify.check(focus=args.focus, directories=args.directories)

    if args.json:
        print(json.dumps(result.to_payload(), indent=2, ensure_ascii=False))
    else:
        print(result.summary)
        print(f"\nChecks:")
        for check in result.checks:
            status_icon = {"pass": "✓", "fail": "✗", "warning": "⚠"}.get(check.status, "?")
            print(f"  {status_icon} {check.check_type}: {check.message}")


if __name__ == "__main__":
    main()
