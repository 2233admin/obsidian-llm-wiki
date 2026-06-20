"""Write-Ahead Log for append-only change tracking.

Usage:
    from wal import WAL
    wal = WAL(vault_root)          # writes vault_root/.vault_wal.jsonl

    # Log operations
    wal.append("create", "path/to/file.md", "abc123")
    wal.append("update", "path/to/file.md", "def456")

    # Read all entries
    entries = WAL.read_all(vault_root)

    # Replay from a timestamp
    for entry in wal.replay():
        print(entry)
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

import orjson


@dataclass
class WALEntry:
    timestamp: str
    action: str  # "create" | "update" | "delete" | "read"
    path: str
    hash: str | None = None


class WAL:
    """Append-only Write-Ahead Log for change tracking and time-travel debugging."""

    def __init__(self, vault_root: Path | str):
        """Initialise WAL pointing at vault_root / '.vault_wal.jsonl'."""
        root = Path(vault_root)
        self.path = root / ".vault_wal.jsonl"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, action: str, path: str, hash: str | None = None) -> None:
        """Append a new entry to the WAL."""
        entry = WALEntry(
            timestamp=datetime.now(tz=timezone.utc).isoformat(),
            action=action,
            path=path,
            hash=hash,
        )
        with open(self.path, "ab") as f:
            f.write(orjson.dumps(asdict(entry)) + b"\n")

    def replay(self, from_timestamp: str | None = None) -> Iterator[WALEntry]:
        """Replay all WAL entries, optionally from a specific timestamp."""
        if not self.path.exists():
            return

        with open(self.path, "rb") as f:
            for line in f:
                if not line.strip():
                    continue
                entry = orjson.loads(line)
                if from_timestamp and entry["timestamp"] < from_timestamp:
                    continue
                yield WALEntry(**entry)

    def get_entries_since(self, since: str) -> list[WALEntry]:
        """Get all entries since a given ISO timestamp."""
        return list(self.replay(from_timestamp=since))

    def latest_hash(self, path: str) -> str | None:
        """Get the latest hash for a path, or None if not found."""
        latest: str | None = None
        for entry in self.replay():
            if entry.path == path:
                latest = entry.hash
        return latest

    def __len__(self) -> int:
        """Return number of entries in WAL."""
        if not self.path.exists():
            return 0
        with open(self.path, "rb") as f:
            return sum(1 for line in f if line.strip())

    def tail(self, n: int = 10) -> list[WALEntry]:
        """Get the last n entries."""
        entries = list(self.replay())
        return entries[-n:] if len(entries) > n else entries

    @classmethod
    def read_all(cls, vault_root: Path | str) -> list[WALEntry]:
        """Read every entry from the WAL at vault_root (classmethod reader)."""
        path = Path(vault_root) / ".vault_wal.jsonl"
        if not path.exists():
            return []
        entries: list[WALEntry] = []
        with open(path, "rb") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(WALEntry(**orjson.loads(line)))
                except (orjson.JSONDecodeError, TypeError):
                    continue
        return entries
