"""
Worker Ship — Task execution for llmwiki fleet.

Responsibilities:
- Execute work tasks (compile, fix, create, review)
- Respect boundaries (scope constraints)
- Validate outputs
- Report results
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from .message import CheckResult, WorkOutput


class WorkerShip:
    """
    Worker ship for task execution.

    Usage:
        worker = WorkerShip(vault="/path/to/vault")

        # Execute a compile task
        result = worker.execute(
            task_type="compile",
            input={"source": "04-Research/ai-agents", "model": "sonnet"},
            output={"path": "04-Research/ai-agents/wiki"},
        )

        # Execute a fix task
        result = worker.execute(
            task_type="fix",
            input={"broken_links": ["path/to/file.md"]},
            output={"path": "path/to/file.md"},
        )
    """

    def __init__(self, vault: str, compiler_path: str | None = None):
        self.vault = Path(vault)
        self.compiler_path = Path(compiler_path) if compiler_path else self.vault.parent / "compiler"

    def execute(
        self,
        task_type: str,
        input_spec: dict[str, Any],
        output_spec: dict[str, Any],
        constraints: list[str] | None = None,
    ) -> WorkOutput:
        """
        Execute a work task.

        Args:
            task_type: Type of task ("compile", "fix", "create", "review")
            input_spec: Input specification
            output_spec: Output specification
            constraints: List of constraints

        Returns:
            WorkOutput with results
        """
        constraints = constraints or []

        if task_type == "compile":
            return self._execute_compile(input_spec, output_spec, constraints)
        elif task_type == "fix":
            return self._execute_fix(input_spec, output_spec, constraints)
        elif task_type == "create":
            return self._execute_create(input_spec, output_spec, constraints)
        elif task_type == "review":
            return self._execute_review(input_spec, output_spec, constraints)
        else:
            return WorkOutput(
                session_id="",
                task_id="",
                task_type=task_type,
                success=False,
                errors=[f"Unknown task type: {task_type}"],
            )

    def _execute_compile(
        self,
        input_spec: dict[str, Any],
        output_spec: dict[str, Any],
        constraints: list[str],
    ) -> WorkOutput:
        """Execute a compile task."""
        compile_py = self.compiler_path / "compile.py"
        if not compile_py.exists():
            return WorkOutput(
                session_id="",
                task_id=input_spec.get("task_id", ""),
                task_type="compile",
                success=False,
                errors=["compile.py not found"],
            )

        # Build command
        topic = input_spec.get("topic", "")
        if not topic:
            return WorkOutput(
                session_id="",
                task_id=input_spec.get("task_id", ""),
                task_type="compile",
                success=False,
                errors=["topic is required for compile task"],
            )

        cmd = [
            sys.executable,
            str(compile_py),
            str(self.vault / topic),
            "--tier", input_spec.get("model", "haiku"),
        ]

        # Add dry-run if in constraints
        if "dry-run" in constraints:
            cmd.append("--dry-run")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=300,
            )

            output_path = str(self.vault / topic / "wiki")
            return WorkOutput(
                session_id="",
                task_id=input_spec.get("task_id", ""),
                task_type="compile",
                success=result.returncode == 0,
                files_created=[output_path] if result.returncode == 0 else [],
                output_path=output_path,
                summary=result.stdout if result.returncode == 0 else result.stderr,
                errors=[result.stderr] if result.returncode != 0 else [],
            )
        except subprocess.TimeoutExpired:
            return WorkOutput(
                session_id="",
                task_id=input_spec.get("task_id", ""),
                task_type="compile",
                success=False,
                errors=["Compile task timed out after 5 minutes"],
            )
        except Exception as e:
            return WorkOutput(
                session_id="",
                task_id=input_spec.get("task_id", ""),
                task_type="compile",
                success=False,
                errors=[str(e)],
            )

    def _execute_fix(
        self,
        input_spec: dict[str, Any],
        output_spec: dict[str, Any],
        constraints: list[str],
    ) -> WorkOutput:
        """Execute a fix task."""
        # For now, just mark as not implemented
        # In production, this would run actual fix logic
        return WorkOutput(
            session_id="",
            task_id=input_spec.get("task_id", ""),
            task_type="fix",
            success=False,
            errors=["Fix task implementation pending"],
        )

    def _execute_create(
        self,
        input_spec: dict[str, Any],
        output_spec: dict[str, Any],
        constraints: list[str],
    ) -> WorkOutput:
        """Execute a create task."""
        output_path = Path(output_spec.get("path", ""))
        content = input_spec.get("content", "")

        if not output_path:
            return WorkOutput(
                session_id="",
                task_id=input_spec.get("task_id", ""),
                task_type="create",
                success=False,
                errors=["output path is required"],
            )

        # Check constraints
        if not self._check_constraints(output_path, constraints):
            return WorkOutput(
                session_id="",
                task_id=input_spec.get("task_id", ""),
                task_type="create",
                success=False,
                errors=["Output path violates constraints"],
            )

        try:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(content, encoding="utf-8")

            return WorkOutput(
                session_id="",
                task_id=input_spec.get("task_id", ""),
                task_type="create",
                success=True,
                files_created=[str(output_path)],
                output_path=str(output_path),
                summary=f"Created {output_path}",
            )
        except Exception as e:
            return WorkOutput(
                session_id="",
                task_id=input_spec.get("task_id", ""),
                task_type="create",
                success=False,
                errors=[str(e)],
            )

    def _execute_review(
        self,
        input_spec: dict[str, Any],
        output_spec: dict[str, Any],
        constraints: list[str],
    ) -> WorkOutput:
        """Execute a review task."""
        # Review tasks are handled by Verify ship
        return WorkOutput(
            session_id="",
            task_id=input_spec.get("task_id", ""),
            task_type="review",
            success=False,
            errors=["Review tasks should be handled by Verify ship"],
        )

    def _check_constraints(self, output_path: Path, constraints: list[str]) -> bool:
        """Check if output path respects constraints."""
        # Default: output must be within vault
        if not str(output_path).startswith(str(self.vault)):
            return False

        # Check for protected paths
        protected_patterns = [
            ".git/",
            ".vault-mind/",
            "node_modules/",
        ]
        for pattern in protected_patterns:
            if pattern in str(output_path):
                return False

        # Check for constraint patterns
        for constraint in constraints:
            if constraint.startswith("no-modify:"):
                pattern = constraint.split(":", 1)[1]
                if pattern in str(output_path):
                    return False

        return True

    def validate(self, output: WorkOutput) -> list[CheckResult]:
        """
        Validate work output.

        Args:
            output: WorkOutput to validate

        Returns:
            List of CheckResult
        """
        checks: list[CheckResult] = []

        # Check success
        checks.append(CheckResult(
            check_type="success",
            status="pass" if output.success else "fail",
            message="Task completed successfully" if output.success else f"Task failed: {output.errors}",
        ))

        # Check output path exists
        if output.output_path:
            path = Path(output.output_path)
            if path.exists():
                checks.append(CheckResult(
                    check_type="output_exists",
                    status="pass",
                    message=f"Output path exists: {output.output_path}",
                ))
            else:
                checks.append(CheckResult(
                    check_type="output_exists",
                    status="fail",
                    message=f"Output path does not exist: {output.output_path}",
                ))

        # Check no errors
        if output.errors:
            checks.append(CheckResult(
                check_type="no_errors",
                status="fail",
                message=f"Task had errors: {output.errors}",
            ))

        return checks

    def check_boundary(
        self,
        proposed_path: str,
        constraints: list[str],
    ) -> dict[str, Any]:
        """
        Check if a proposed path is within boundaries.

        Args:
            proposed_path: Path to check
            constraints: List of constraints

        Returns:
            dict with "allowed" and "reason"
        """
        path = Path(proposed_path)

        # Must be within vault
        if not str(path).startswith(str(self.vault)):
            return {
                "allowed": False,
                "reason": f"Path must be within vault: {self.vault}",
            }

        # Check protected paths
        protected = [".git", ".vault-mind", "node_modules", ".claude"]
        for protected_name in protected:
            if protected_name in path.parts:
                return {
                    "allowed": False,
                    "reason": f"Path contains protected directory: {protected_name}",
                }

        # Check constraints
        for constraint in constraints:
            if constraint.startswith("read-only:"):
                region = constraint.split(":", 1)[1]
                if region in str(path):
                    return {
                        "allowed": False,
                        "reason": f"Path is in read-only region: {region}",
                    }

        return {
            "allowed": True,
            "reason": "Path is within boundaries",
        }


# CLI entry point
def main():
    """CLI for worker ship."""
    import argparse

    parser = argparse.ArgumentParser(description="Worker ship for task execution")
    parser.add_argument("vault", help="Vault path")
    parser.add_argument("--task-type", required=True, choices=["compile", "fix", "create", "review"],
                        help="Type of task")
    parser.add_argument("--input", required=True, help="Input JSON")
    parser.add_argument("--output", required=True, help="Output JSON")
    parser.add_argument("--constraints", nargs="*", help="Constraints")
    parser.add_argument("--json", action="store_true", help="Output JSON")

    args = parser.parse_args()

    worker = WorkerShip(vault=args.vault)

    input_spec = json.loads(args.input)
    output_spec = json.loads(args.output)

    result = worker.execute(
        task_type=args.task_type,
        input_spec=input_spec,
        output_spec=output_spec,
        constraints=args.constraints,
    )

    if args.json:
        print(json.dumps(result.to_payload(), indent=2, ensure_ascii=False))
    else:
        status = "✓" if result.success else "✗"
        print(f"{status} {result.task_type}: {result.summary}")


if __name__ == "__main__":
    main()
