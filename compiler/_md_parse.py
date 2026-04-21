from __future__ import annotations

import re

FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
TILDE_FENCE_RE = re.compile(r"^~~~[^\n]*(?:\n.*?)*?\n~~~[^\n]*$", re.DOTALL | re.MULTILINE)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
FRONTMATTER_RE = re.compile(r"\A---\r?\n.*?\r?\n---\r?\n", re.DOTALL)
WIKILINK_TARGET_RE = re.compile(r"(?<!\[)\[\[([^\]\[|#\n]+)(?:#[^\]\n]+)?(?:\|[^\]\n]+)?\]\]")
WIKILINK_ANY_RE = re.compile(r"(?<!\[)\[\[[^\]\[]+\]\]")
BRACKET_RUN_RE = re.compile(r"\[{2,}.*?\]{2,}", re.DOTALL)
MDLINK_RE = re.compile(r"\[[^\]]*\]\([^)]+\)")


def split_quoted_list(value: str) -> list[str]:
    items: list[str] = []
    current: list[str] = []
    quote: str | None = None
    escaped = False
    for ch in value:
        if escaped:
            current.append(ch)
            escaped = False
            continue
        if ch == "\\" and quote:
            current.append(ch)
            escaped = True
            continue
        if ch in ("'", '"'):
            if quote == ch:
                quote = None
            elif quote is None:
                quote = ch
            current.append(ch)
            continue
        if ch == "," and quote is None:
            item = "".join(current).strip()
            if item:
                items.append(item)
            current = []
            continue
        current.append(ch)
    item = "".join(current).strip()
    if item:
        items.append(item)
    return items


def strip_bracket_list_comment(value: str) -> str:
    if not value.startswith("["):
        return value
    close = value.find("]")
    hash_pos = value.find("#")
    if close != -1 and hash_pos != -1 and close < hash_pos:
        return value[:hash_pos].rstrip()
    return value


def parse_frontmatter(text: str) -> dict:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}
    fm = m.group(0)
    out: dict = {}
    current_key: str | None = None
    for raw in fm.splitlines():
        if raw.strip() in ("", "---"):
            continue
        if re.match(r"^[A-Za-z_][\w-]*\s*:", raw):
            k, _, v = raw.partition(":")
            k = k.strip()
            v = strip_bracket_list_comment(v.strip())
            if v.startswith("[") and v.endswith("]"):
                out[k] = [x.strip().strip("'\"") for x in split_quoted_list(v[1:-1]) if x.strip()]
                current_key = None
            elif v:
                out[k] = v.strip("'\"")
                current_key = None
            else:
                out[k] = []
                current_key = k
        elif current_key and raw.lstrip().startswith("- "):
            val = raw.lstrip()[2:].strip().strip("'\"")
            lst = out.get(current_key)
            if isinstance(lst, list):
                lst.append(val)
    return out


def strip_indented_code_blocks(text: str) -> str:
    """Strip simple CommonMark-style indented code blocks.

    This intentionally removes blank-separated blocks where every nonblank line
    starts with 4+ spaces or a tab. Mixed paragraph continuation blocks are kept.
    """
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    block: list[str] = []

    def flush_block() -> None:
        nonlocal block
        if not block:
            return
        nonblank = [line for line in block if line.strip()]
        if nonblank and all(line.startswith("    ") or line.startswith("\t") for line in nonblank):
            block = []
            return
        out.extend(block)
        block = []

    for line in lines:
        if line.strip():
            block.append(line)
        else:
            flush_block()
            out.append(line)
    flush_block()
    return "".join(out)


def strip_noise(text: str, *, strip_wikilinks: bool = False, strip_mdlinks: bool = False) -> str:
    t = HTML_COMMENT_RE.sub("", text)
    t = FRONTMATTER_RE.sub("", t, count=1)
    t = FENCE_RE.sub("", t)
    t = TILDE_FENCE_RE.sub("", t)
    t = strip_indented_code_blocks(t)
    t = INLINE_CODE_RE.sub("", t)
    if strip_wikilinks:
        t = BRACKET_RUN_RE.sub("", t)
        t = WIKILINK_ANY_RE.sub("", t)
    if strip_mdlinks:
        t = MDLINK_RE.sub("", t)
    return t


def extract_wikilinks(text: str) -> list[str]:
    cleaned = strip_noise(text)
    return [m.group(1).strip() for m in WIKILINK_TARGET_RE.finditer(cleaned)]
