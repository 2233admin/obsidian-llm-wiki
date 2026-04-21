#!/usr/bin/env python
"""probe_enforce.py -- call vault.enforceDiscipline in dry-run mode, print report."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    proc = subprocess.Popen(
        ["node", "mcp-server/dist/index.js"],
        cwd=ROOT,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", bufsize=1,
    )

    def rpc(rid, method, params=None):
        msg = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            msg["params"] = params
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()
        return json.loads(proc.stdout.readline())

    def notify(method, params):
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method, "params": params}) + "\n")
        proc.stdin.flush()

    rpc(1, "initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "probe_enforce", "version": "0.1"},
    })
    notify("notifications/initialized", {})

    resp = rpc(2, "tools/call", {
        "name": "vault.enforceDiscipline",
        "arguments": {"dryRun": True, "skipDirs": ["08-Templates"]},
    })
    content = resp.get("result", {}).get("content", [{}])[0].get("text", "")
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        print("(non-JSON response)")
        print(content[:1500])
        proc.kill()
        return 1

    print(f"dryRun={data['dryRun']}")
    print(f"inspected {data['summary']['dirsInspected']} dirs; "
          f"WOULD create {data['summary']['filesCreated']} files; "
          f"skip {data['summary']['filesSkipped']} existing; "
          f"errors {data['summary']['errorCount']}")
    print()
    print("Inspected dirs:")
    for d in data["inspectedDirs"]:
        print(f"  - {d}")
    print()
    print("Would create:")
    for f in data["created"]:
        print(f"  + {f}")
    if data["skipped"]:
        print()
        print("Skipped (already compliant):")
        for s in data["skipped"]:
            print(f"  = {s}")
    if data["errors"]:
        print()
        print("Errors:")
        for e in data["errors"]:
            print(f"  ! {e['path']}: {e['message']}")

    proc.stdin.close()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()
    stderr = proc.stderr.read()
    if stderr.strip():
        print("\n--- server stderr ---", file=sys.stderr)
        print(stderr[:1500], file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
