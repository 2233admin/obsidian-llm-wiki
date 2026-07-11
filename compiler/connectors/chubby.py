"""ChubbySkills connector -- wraps the upstream chubbyguan/chubbyskills pack.

Integration model follows the chubbyskills SKILL.md
(~/.claude/skills/chubbyskills/SKILL.md): the upstream repo is installed
separately -- default ``~/chubbyskills``, override with the
``CHUBBYSKILLS_HOME`` env var -- and this connector shells out to its
scripts. Heavy dependencies (yt-dlp / ffmpeg / funasr / faster-whisper /
bs4) stay upstream; nothing is vendored into vault-mind.

Channels:

    radar    -- industry-intelligence-radar ``scripts/scan.py``: stdlib-only
                multi-source scan (Hacker News Algolia + V2EX hot + arbitrary
                Chinese RSS feeds such as ithome / sspai / 36kr). No
                credentials required; works end-to-end today. The generated
                intelligence briefing markdown is wrapped in the standard
                raw/ frontmatter and written to output_dir.

    wechat / bilibili / xiaohongshu / x / douyin / podcast / youtube / ...
             -- URL-queue driven capture channels (``tools/chubby.py ingest``
                upstream). They need per-run source URLs plus upstream deps
                and, for some platforms, credentials (e.g. XHS_COOKIE for
                xiaohongshu). HITL: until those are provisioned this
                connector logs what is missing and returns [] -- it never
                fabricates output and never hard-fails the sweep.

Install upstream (once):

    git clone https://github.com/chubbyguan/chubbyskills.git ~/chubbyskills
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .base import write_markdown_entry

HOME_ENV_VAR = "CHUBBYSKILLS_HOME"
DEFAULT_HOME = Path.home() / "chubbyskills"
RADAR_SCRIPT = Path("industry-intelligence-radar") / "scripts" / "scan.py"
DEFAULT_HOURS = 24
DEFAULT_TIMEOUT = 300  # seconds

# Queue-driven upstream channels that need URLs + deps/credentials before
# they can run unattended. Kept here so yaml can register them (disabled)
# and the sweep prints an honest HITL message instead of guessing.
HITL_CHANNELS = {
    "wechat": "needs bs4 upstream + an article URL queue (inbox/links.txt)",
    "bilibili": "needs yt-dlp upstream + a video URL queue",
    "xiaohongshu": "needs XHS_COOKIE credential + a note URL queue",
    "x": "needs a tweet URL queue (syndication endpoint, no login)",
    "douyin": "needs ffmpeg+funasr upstream + a video URL queue",
    "tiktok": "needs yt-dlp+ffmpeg+funasr upstream + a video URL queue",
    "weibo": "needs yt-dlp+ffmpeg+funasr upstream + a video URL queue",
    "zhihu": "needs yt-dlp+ffmpeg+funasr upstream + a video URL queue",
    "podcast": "needs ffmpeg+faster-whisper upstream + an audio URL queue",
    "youtube": "needs yt-dlp upstream + a video URL queue",
}

_HIT_COUNT_RE = re.compile(r"命中条目：(\d+)")


def _chubbyskills_home() -> Path:
    override = os.environ.get(HOME_ENV_VAR)
    return Path(override) if override else DEFAULT_HOME


def _fetch_radar(
    output_dir: Path,
    home: Path,
    hours: int,
    rss: str,
    timeout: int,
) -> list[Path]:
    script = home / RADAR_SCRIPT
    if not script.exists():
        print(
            f"[chubby] radar script not found at {script} -- install upstream "
            "with: git clone https://github.com/chubbyguan/chubbyskills.git "
            f"{home}",
            file=sys.stderr,
        )
        return []

    rss_urls = [url.strip() for url in str(rss or "").split(",") if url.strip()]

    with tempfile.TemporaryDirectory(prefix="chubby-radar-") as tmp:
        tmp_dir = Path(tmp)
        report_path = tmp_dir / "report.md"
        cmd = [sys.executable, str(script), "--hours", str(hours), "--output", str(report_path)]
        if rss_urls:
            config_path = tmp_dir / "keywords.json"
            config_path.write_text(json.dumps({"rss": rss_urls}), encoding="utf-8")
            cmd.extend(["--config", str(config_path)])

        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=timeout, env=env)
        except (subprocess.SubprocessError, OSError) as exc:
            print(f"[chubby] radar scan failed to run: {exc}", file=sys.stderr)
            return []

        if proc.returncode != 0 or not report_path.exists():
            stderr_tail = proc.stderr.decode("utf-8", errors="replace").strip().splitlines()[-3:]
            print(
                f"[chubby] radar scan exited {proc.returncode}: {' | '.join(stderr_tail)}",
                file=sys.stderr,
            )
            return []

        body = report_path.read_text(encoding="utf-8")

    hit_match = _HIT_COUNT_RE.search(body)
    hits = hit_match.group(1) if hit_match else "?"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = write_markdown_entry(
        output_dir,
        filename=f"radar-{stamp}.md",
        source_type="chubby-radar",
        origin="chubbyskills:industry-intelligence-radar",
        body=body,
    )
    print(f"[chubby] radar briefing written ({hits} hits): {path}")
    return [path]


def fetch(
    output_dir: Path,
    channel: str = "radar",
    hours: int = DEFAULT_HOURS,
    rss: str = "",
    timeout: int = DEFAULT_TIMEOUT,
    **kwargs,
) -> list[Path]:
    """Run one chubbyskills channel and write raw/ markdown under output_dir.

    Only the ``radar`` channel runs unattended today. Queue-driven channels
    log a HITL message and return [] until their upstream deps/credentials
    are provisioned. Never raises for missing installs or channel problems.
    """
    home = _chubbyskills_home()

    if channel == "radar":
        return _fetch_radar(output_dir, home, hours=int(hours), rss=rss, timeout=int(timeout))

    reason = HITL_CHANNELS.get(channel, "unknown channel")
    print(
        f"[chubby] channel '{channel}' is HITL-gated ({reason}) -- skipping. "
        "Run the upstream skill manually via tools/chubby.py once provisioned.",
        file=sys.stderr,
    )
    return []
