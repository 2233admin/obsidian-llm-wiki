"""
Context Management — Multi-agent context trimming and isolation.

Solves the context explosion problem by:
1. Task-specific context trimming
2. Session isolation
3. Briefing-based context injection
4. Result summarization
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class ContextWindow:
    """Represents a context window with budget tracking."""
    budget: int = 100_000  # tokens
    used: int = 0
    remaining: int = 100_000

    def can_fit(self, tokens: int) -> bool:
        """Check if tokens can fit in remaining budget."""
        return self.remaining >= tokens

    def reserve(self, tokens: int) -> bool:
        """Reserve tokens. Returns True if successful."""
        if not self.can_fit(tokens):
            return False
        self.used += tokens
        self.remaining -= tokens
        return True


@dataclass
class TrimmedContext:
    """A context that has been trimmed for a specific task."""
    content: str
    tokens_estimate: int
    sources: list[str] = field(default_factory=list)
    trimmed: bool = False
    reason: str = ""


class ContextTrimmer:
    """
    Trims context for task-specific sessions.

    Usage:
        trimmer = ContextTrimmer(vault="/path/to/vault")

        # Trim full context for a specific task
        trimmed = trimmer.trim(
            full_context=vault_content,
            task_type="scout",
            task_id="issue_123"
        )

        # Generate task-specific briefing
        briefing = trimmer.generate_briefing(
            task=task,
            ship=ShipType.SCOUT,
            vault_state=vault_state
        )
    """

    def __init__(self, vault: str, max_tokens: int = 100_000):
        self.vault = Path(vault)
        self.max_tokens = max_tokens
        # Rough estimate: 1 token ≈ 4 characters
        self.chars_per_token = 4

    def estimate_tokens(self, text: str) -> int:
        """Estimate token count from text."""
        return len(text) // self.chars_per_token

    def trim(
        self,
        full_context: str,
        task_type: str,
        task_id: str,
        max_tokens: int | None = None,
    ) -> TrimmedContext:
        """
        Trim context for a specific task.

        Args:
            full_context: The full context to trim
            task_type: Type of task (scout, worker, verify)
            task_id: ID of the task
            max_tokens: Maximum tokens to keep

        Returns:
            TrimmedContext with trimmed content
        """
        budget = max_tokens or self.max_tokens
        current_tokens = self.estimate_tokens(full_context)

        if current_tokens <= budget and not (task_type == "scout" and ("index.md" in full_context or "Home.md" in full_context or re.search(r"\d{4}-\d{2}-\d{2}", full_context))):
            return TrimmedContext(
                content=full_context,
                tokens_estimate=current_tokens,
                trimmed=False,
                reason="Within budget",
            )

        # Strategies for trimming based on task type
        if task_type == "scout":
            return self._trim_for_scout(full_context, budget)
        elif task_type == "worker":
            return self._trim_for_worker(full_context, budget)
        elif task_type == "verify":
            return self._trim_for_verify(full_context, budget)
        else:
            return self._trim_generic(full_context, budget)

    def _trim_for_scout(self, content: str, budget: int) -> TrimmedContext:
        """Trim context specifically for scout tasks."""
        # For scout, keep: index files, frontmatter, recent changes
        lines = content.split("\n")
        kept_lines = []
        tokens = 0

        for line in lines:
            line_tokens = self.estimate_tokens(line)

            # Always keep index files
            if "index.md" in line or "Home.md" in line:
                kept_lines.append(line)
                tokens += line_tokens
                continue

            # Keep frontmatter
            if line.strip() in ("---", "---"):
                kept_lines.append(line)
                tokens += line_tokens
                continue

            # Keep recent dates
            if re.search(r"\d{4}-\d{2}-\d{2}", line):
                kept_lines.append(line)
                tokens += line_tokens
                continue

            # Check budget
            if tokens + line_tokens <= budget:
                kept_lines.append(line)
                tokens += line_tokens

        return TrimmedContext(
            content="\n".join(kept_lines),
            tokens_estimate=tokens,
            trimmed=True,
            reason="Trimmed for scout task (kept indexes, frontmatter, recent)",
        )

    def _trim_for_worker(self, content: str, budget: int) -> TrimmedContext:
        """Trim context specifically for worker tasks."""
        # For worker, keep: task spec, constraints, recent outputs
        lines = content.split("\n")
        kept_lines = []
        tokens = 0

        in_spec = False
        in_constraints = False

        for line in lines:
            line_tokens = self.estimate_tokens(line)

            # Look for task specification
            if "## Task" in line or "## Spec" in line:
                in_spec = True
                kept_lines.append(line)
                tokens += line_tokens
                continue

            if "## Constraints" in line:
                in_constraints = True
                kept_lines.append(line)
                tokens += line_tokens
                continue

            # Keep spec and constraints sections
            if in_spec or in_constraints:
                kept_lines.append(line)
                tokens += line_tokens
                # Exit section on next header
                if line.startswith("# ") and "## " not in line:
                    in_spec = False
                    in_constraints = False
                continue

            # Keep recent outputs (last modified)
            if "output_path:" in line or "created:" in line:
                kept_lines.append(line)
                tokens += line_tokens
                continue

            # Check budget
            if tokens + line_tokens <= budget:
                kept_lines.append(line)
                tokens += line_tokens

        return TrimmedContext(
            content="\n".join(kept_lines),
            tokens_estimate=tokens,
            trimmed=True,
            reason="Trimmed for worker task (kept spec, constraints, outputs)",
        )

    def _trim_for_verify(self, content: str, budget: int) -> TrimmedContext:
        """Trim context specifically for verify tasks."""
        # For verify, keep: issues, check results, links
        lines = content.split("\n")
        kept_lines = []
        tokens = 0

        for line in lines:
            line_tokens = self.estimate_tokens(line)

            # Keep check results
            if any(k in line.lower() for k in ["check", "verify", "pass", "fail", "warning"]):
                kept_lines.append(line)
                tokens += line_tokens
                continue

            # Keep link references
            if "[[" in line or "http" in line:
                kept_lines.append(line)
                tokens += line_tokens
                continue

            # Keep issue descriptions
            if any(k in line.lower() for k in ["issue", "error", "broken", "orphan"]):
                kept_lines.append(line)
                tokens += line_tokens
                continue

            # Check budget
            if tokens + line_tokens <= budget:
                kept_lines.append(line)
                tokens += line_tokens

        return TrimmedContext(
            content="\n".join(kept_lines),
            tokens_estimate=tokens,
            trimmed=True,
            reason="Trimmed for verify task (kept checks, links, issues)",
        )

    def _trim_generic(self, content: str, budget: int) -> TrimmedContext:
        """Generic trimming: keep beginning and important sections."""
        current_tokens = self.estimate_tokens(content)

        if current_tokens <= budget:
            return TrimmedContext(
                content=content,
                tokens_estimate=current_tokens,
                trimmed=False,
                reason="Within budget",
            )

        # Keep first portion + important headers
        lines = content.split("\n")
        kept_lines = []
        tokens = 0
        budget_tokens = int(budget * 0.3)  # 30% for header

        # Keep all headers and first section
        for line in lines:
            line_tokens = self.estimate_tokens(line)

            if line.startswith("# ") or tokens < budget_tokens:
                kept_lines.append(line)
                tokens += line_tokens
            elif tokens + line_tokens <= budget:
                kept_lines.append(line)
                tokens += line_tokens

        return TrimmedContext(
            content="\n".join(kept_lines),
            tokens_estimate=tokens,
            trimmed=True,
            reason="Generic trim (kept headers and first portion)",
        )

    def generate_briefing(
        self,
        task: dict[str, Any],
        ship_type: str,
        vault_state: dict[str, Any] | None = None,
    ) -> str:
        """
        Generate a task-specific briefing.

        This is the key to context efficiency: generate a minimal briefing
        that contains only what's needed for the task.
        """
        lines = [
            f"# Briefing — {ship_type.upper()}",
            f"",
            f"## Task",
            f"- ID: {task.get('id', 'N/A')}",
            f"- Entity: {task.get('entity', 'N/A')}",
            f"- Type: {task.get('type', 'N/A')}",
            f"",
        ]

        # Ship-specific instructions
        if ship_type == "scout":
            lines.extend([
                f"## Your Mission",
                f"",
                f"Scan the vault for issues. Be thorough but efficient.",
                f"",
                f"### Focus Areas",
                f"- Broken wikilinks",
                f"- Orphan pages (no incoming links)",
                f"- Stale content (>6 months old)",
                f"- Unresolved contradictions",
                f"",
                f"### Output",
                f"Return JSON with:",
                f'- issues: list of {{id, severity, type, location, description}}',
                f'- stats: counts by severity and type',
                f'- summary: one-line summary',
            ])

        elif ship_type == "worker":
            input_spec = task.get("input", {})
            output_spec = task.get("output", {})

            lines.extend([
                f"## Your Mission",
                f"",
                f"Execute the task and produce the required output.",
                f"",
                f"### Input",
                f"- Source: {input_spec.get('source', 'N/A')}",
                f"- Spec: {input_spec.get('spec', 'N/A')}",
                f"",
                f"### Output Target",
                f"- Path: {output_spec.get('path', 'N/A')}",
                f"- Format: {output_spec.get('format', 'markdown')}",
                f"",
            ])

            constraints = task.get("constraints", [])
            if constraints:
                lines.append(f"### Constraints")
                for c in constraints:
                    lines.append(f"- {c}")
                lines.append("")

            lines.extend([
                f"### Output Format",
                f"Return JSON with:",
                f'- success: boolean',
                f'- files_created/modified/deleted: lists',
                f'- summary: description of what was done',
            ])

        elif ship_type == "verify":
            lines.extend([
                f"## Your Mission",
                f"",
                f"Verify the work output and check quality.",
                f"",
                f"### Checks to Run",
                f"- Broken links",
                f"- Orphan pages",
                f"- Contradictions",
                f"- Format compliance",
                f"",
                f"### Output Format",
                f"Return JSON with:",
                f'- status: "pass" | "fail" | "warning"',
                f'- checks: list of {{check_type, status, message}}',
                f'- issues: any problems found',
                f'- summary: overall assessment',
            ])

        # Add vault state summary if available
        if vault_state:
            lines.extend([
                f"",
                f"## Vault State",
                f"- Files: {vault_state.get('file_count', 'N/A')}",
                f"- Directories: {vault_state.get('dir_count', 'N/A')}",
                f"- Last scan: {vault_state.get('last_scan', 'N/A')}",
            ])

        lines.extend([
            f"",
            f"---",
            f"*Context trimmed for efficiency. Focus on your mission.*",
        ])

        return "\n".join(lines)

    def summarize_result(self, result: dict[str, Any], max_tokens: int = 2000) -> str:
        """
        Summarize a result for return to hub.

        Instead of returning full content, return a structured summary.
        """
        summary = {
            "status": result.get("status", "unknown"),
            "item_count": 0,
            "key_findings": [],
            "needs_attention": [],
        }

        # Count items
        if "issues" in result:
            summary["item_count"] = len(result["issues"])
        elif "checks" in result:
            summary["item_count"] = len(result["checks"])

        # Extract key findings
        if "summary" in result:
            summary["key_findings"].append(result["summary"][:500])

        if "issues" in result and result["issues"]:
            # Top 3 by severity
            by_severity = {}
            for issue in result["issues"]:
                sev = issue.get("severity", "medium")
                if sev not in by_severity:
                    by_severity[sev] = []
                by_severity[sev].append(issue)

            for sev in ["critical", "high"]:
                if sev in by_severity:
                    for issue in by_severity[sev][:2]:
                        summary["needs_attention"].append({
                            "severity": sev,
                            "type": issue.get("type"),
                            "location": issue.get("location"),
                        })

        # Estimate tokens
        summary_tokens = self.estimate_tokens(json.dumps(summary))

        if summary_tokens > max_tokens:
            # Further trim
            return json.dumps(summary, indent=2)[:max_tokens * self.chars_per_token]

        return json.dumps(summary, indent=2, ensure_ascii=False)


class SessionManager:
    """
    Manages multiple isolated sessions for multi-agent execution.

    Each session has its own context and state.
    """

    def __init__(self, vault: str, max_tokens: int = 100_000):
        self.vault = Path(vault)
        self.sessions: dict[str, dict[str, Any]] = {}
        self.trimmer = ContextTrimmer(vault, max_tokens)

    def create_session(
        self,
        session_id: str,
        task: dict[str, Any],
        ship_type: str,
    ) -> dict[str, Any]:
        """Create a new isolated session."""
        session = {
            "id": session_id,
            "task": task,
            "ship_type": ship_type,
            "status": "created",
            "context_budget": self.trimmer.max_tokens,
            "context_used": 0,
            "created_at": None,  # Set by caller
        }

        self.sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        """Get a session by ID."""
        return self.sessions.get(session_id)

    def update_session(self, session_id: str, updates: dict[str, Any]) -> None:
        """Update session state."""
        if session_id in self.sessions:
            self.sessions[session_id].update(updates)

    def close_session(self, session_id: str) -> dict[str, Any] | None:
        """Close session, remove it from active storage, and return final state."""
        session = self.sessions.pop(session_id, None)
        if session:
            session["status"] = "closed"
        return session

    def get_active_sessions(self) -> list[dict[str, Any]]:
        """Get all active sessions."""
        return [
            s for s in self.sessions.values()
            if s.get("status") in ("created", "running")
        ]
