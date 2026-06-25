#!/usr/bin/env python3
"""Plan a safe ChubbySkills + LLMwiki local knowledge workflow.

This helper intentionally does not clone repositories or install dependencies.
It prints reproducible commands and keeps external actions explicit.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from textwrap import dedent


REPO_URL = "https://github.com/chubbyguan/chubbyskills.git"


@dataclass(frozen=True)
class Skill:
    name: str
    platform: str
    purpose: str
    deps: str


SKILLS = [
    Skill("douyin-transcribe", "Douyin", "video to Markdown transcript", "ffmpeg, funasr stack"),
    Skill("bilibili-transcribe", "Bilibili", "subtitle-first video transcript", "ffmpeg, yt-dlp, funasr stack"),
    Skill("tiktok-transcribe", "TikTok", "video to Markdown transcript", "ffmpeg, yt-dlp, funasr stack"),
    Skill("weibo-transcribe", "Weibo", "video to Markdown transcript", "ffmpeg, yt-dlp, funasr stack"),
    Skill("zhihu-transcribe", "Zhihu", "video to Markdown transcript", "ffmpeg, yt-dlp, funasr stack"),
    Skill("youtube-transcribe", "YouTube", "subtitle-first transcript plus Chinese translation", "ffmpeg, yt-dlp, translation env"),
    Skill("podcast-transcribe", "Podcast", "podcast audio to Markdown transcript", "ffmpeg, faster-whisper"),
    Skill("wechat-article-ingest", "WeChat", "article to Markdown plus A/B insight extraction", "beautifulsoup4, markitdown, pymupdf"),
    Skill("xiaohongshu-ingest", "Xiaohongshu", "image/video note capture and topic analysis", "optional cookie, media tooling"),
    Skill("x-ingest", "X/Twitter", "single tweet to Markdown without login", "Python stdlib for text/images; optional ffmpeg/funasr for video"),
    Skill("content-enrich", "All captured notes", "summary, key points, tags, value judgment", "DeepSeek API env when used"),
    Skill("knowledge-base-management", "Vault", "lifecycle, health check, MCP query pattern", "Python stdlib for health check"),
]


def selected(names: list[str]) -> list[Skill]:
    if not names:
        return SKILLS
    wanted = set(names)
    known = {skill.name for skill in SKILLS}
    unknown = sorted(wanted - known)
    if unknown:
        raise SystemExit(f"Unknown skill(s): {', '.join(unknown)}")
    return [skill for skill in SKILLS if skill.name in wanted]


def print_list() -> None:
    width = max(len(skill.name) for skill in SKILLS)
    for skill in SKILLS:
        print(f"{skill.name:<{width}}  {skill.platform:<18}  {skill.purpose}")


def print_plan(vault: str, install_dir: str, names: list[str]) -> None:
    install_path = str(Path(install_dir).expanduser()).replace("\\", "/")
    skills = selected(names)
    skill_args = " ".join(skill.name for skill in skills)
    vault_path = str(Path(vault).expanduser()).replace("\\", "/") if vault else "/path/to/your/vault"

    print(dedent(f"""\
    # ChubbySkills + LLMwiki local knowledge plan

    # 1. Keep both systems pointed at the same vault.
    export VAULT_MIND_VAULT_PATH="{vault_path}"
    export VAULT_DIR="$VAULT_MIND_VAULT_PATH"

    # 2. Install upstream ChubbySkills outside the LLMwiki MCP bundle.
    git clone {REPO_URL} "{install_path}"
    cd "{install_path}"
    bash setup.sh {skill_args}

    # 3. Capture with the relevant upstream skill, then query with LLMwiki.
    # Example LLMwiki follow-up:
    #   query.unified: search the generated Markdown
    #   vault.writeAIOutput: file a source-backed synthesis
    #   memory.handoff.write: leave continuation state
    """))

    print("# Selected upstream skills")
    for skill in skills:
        print(f"- {skill.name}: {skill.platform}; {skill.purpose}; deps: {skill.deps}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Plan ChubbySkills integration for a LLMwiki vault.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="List known upstream ChubbySkills integrations.")

    plan = sub.add_parser("plan", help="Print safe install/env commands.")
    plan.add_argument("--vault", default="", help="Path to the LLMwiki/Obsidian vault.")
    plan.add_argument("--install-dir", default="~/chubbyskills", help="Where to clone upstream ChubbySkills.")
    plan.add_argument("--skills", nargs="*", default=[], help="Subset of upstream skill names.")

    args = parser.parse_args()
    if args.cmd == "list":
        print_list()
        return 0
    if args.cmd == "plan":
        print_plan(args.vault, args.install_dir, args.skills)
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
