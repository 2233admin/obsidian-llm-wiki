#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""frontmatter_generator — batch-generate YAML frontmatter for notes missing it.

Zero-dep (stdlib + curl subprocess). Reads a JSON config. Five subcommands:

    vocab     scan vault, compute general tag pool -> <work_dir>/general_tags.txt
    generate  pick N files missing frontmatter, call LLM, write previews -> <work_dir>/preview/
    apply     read previews, atomic prepend to source files, git commit, log
    retry     find files with minimum-only FM (no picks), regenerate with wider
              context + filename/folder hints, atomically replace the FM block
    audit     scan existing FM files, report non-canonical status/type values
              and missing concepts -> <work_dir>/legacy_audit_report.md

All write ops default to dry-run. Actual modification requires --execute.

Config schema (JSON) -- see fm_config.example.json for full example:
  vault_path, skip_dirs, folder_type_map, status_rules,
  tag_blacklist, tag_pool {min_folder_diversity, top_n},
  canonical_status (optional list, default [inbox,seed,active,archived]),
  canonical_types (optional list, default 8 per _CLAUDE.md),
  llm {endpoint, model, api_keys (env-substituted), max_tokens, max_concurrent, anthropic_version},
  work_dir, log_path, git_commit

Usage:
    python -m compiler.frontmatter_generator vocab --config fm.json
    python -m compiler.frontmatter_generator generate --config fm.json --folder 04-Research --limit 10
    python -m compiler.frontmatter_generator apply --config fm.json --execute
    python -m compiler.frontmatter_generator retry --config fm.json --execute
    python -m compiler.frontmatter_generator audit --config fm.json
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import subprocess
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

# ─── config loading ──────────────────────────────────────────────────

def _expand_env(value):
    """Substitute ${ENV_VAR} in strings (recursive on dict/list)."""
    if isinstance(value, str):
        return re.sub(r"\$\{(\w+)\}", lambda m: os.environ.get(m.group(1), ""), value)
    if isinstance(value, list):
        return [_expand_env(v) for v in value]
    if isinstance(value, dict):
        return {k: _expand_env(v) for k, v in value.items()}
    return value


def load_config(path: Path) -> dict:
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    cfg = _expand_env(cfg)
    # Normalize paths
    cfg["vault_path"] = Path(cfg["vault_path"]).resolve()
    cfg["work_dir"] = Path(cfg.get("work_dir", "./fm_work")).resolve()
    cfg["work_dir"].mkdir(parents=True, exist_ok=True)
    (cfg["work_dir"] / "preview").mkdir(exist_ok=True)
    return cfg


# ─── vault scanning ──────────────────────────────────────────────────

def iter_vault_notes(vault: Path, skip_dirs: set[str]):
    for p in vault.rglob("*.md"):
        if any(part in skip_dirs for part in p.parts):
            continue
        yield p


def has_frontmatter(path: Path) -> bool:
    try:
        head = path.read_text(encoding="utf-8", errors="ignore")[:8]
    except Exception:
        return False
    return head.startswith("---")


def extract_frontmatter_body(text: str) -> str | None:
    if not text.startswith("---"):
        return None
    m = re.match(r"---\s*\n(.*?)\n---", text, re.DOTALL)
    return m.group(1) if m else None


def parse_tag_list(fm_body: str) -> list[str]:
    """Extract list items under `tags:` key. Handles bullet and inline forms."""
    tags = []
    in_tags = False
    for line in fm_body.splitlines():
        s = line.rstrip()
        inline = re.match(r"^tags\s*:\s*\[(.*)\]", s)
        if inline:
            for item in inline.group(1).split(","):
                t = item.strip().strip('"').strip("'")
                if t:
                    tags.append(t)
            in_tags = False
            continue
        if s.startswith("tags"):
            in_tags = True
            continue
        if in_tags:
            m = re.match(r"^\s+-\s+(.+)$", s)
            if m:
                t = m.group(1).strip().strip('"').strip("'")
                if t:
                    tags.append(t)
            elif s and not s.startswith(" "):
                in_tags = False
    return tags


def normalize_tag(tag: str) -> str:
    t = tag.strip().lower()
    t = re.sub(r"[\s\-]+", "_", t)
    return t.strip("_#")


# ─── cmd: vocab ──────────────────────────────────────────────────────

def cmd_vocab(cfg: dict):
    vault = cfg["vault_path"]
    skip = set(cfg["skip_dirs"])
    blacklist = set(cfg.get("tag_blacklist", []))
    min_div = cfg["tag_pool"]["min_folder_diversity"]
    top_n = cfg["tag_pool"]["top_n"]

    tag_counts: Counter[str] = Counter()
    tag_folders: dict[str, set[str]] = defaultdict(set)
    scanned = 0
    with_fm = 0

    for path in iter_vault_notes(vault, skip):
        scanned += 1
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        body = extract_frontmatter_body(text)
        if body is None:
            continue
        with_fm += 1
        rel = path.relative_to(vault).as_posix()
        top = rel.split("/", 1)[0]
        for t in parse_tag_list(body):
            n = normalize_tag(t)
            if n:
                tag_counts[n] += 1
                tag_folders[n].add(top)

    general = [(t, c, sorted(tag_folders[t])) for t, c in tag_counts.items()
               if len(tag_folders[t]) >= min_div and t not in blacklist]
    general.sort(key=lambda x: -x[1])
    general = general[:top_n]

    out = cfg["work_dir"] / "general_tags.txt"
    with out.open("w", encoding="utf-8") as f:
        for tag, cnt, folders in general:
            f.write(f"{tag}\t{cnt}\t{','.join(folders)}\n")

    print(f"scanned={scanned} with_frontmatter={with_fm}")
    print(f"blacklisted={len(blacklist)} final_pool={len(general)}")
    print(f"top 15: {[t for t,_,_ in general[:15]]}")
    print(f"written: {out}")


def load_tag_pool(cfg: dict) -> list[str]:
    path = cfg["work_dir"] / "general_tags.txt"
    if not path.exists():
        raise SystemExit(f"run `vocab` first: {path} not found")
    return [line.split("\t", 1)[0] for line in path.read_text(encoding="utf-8").splitlines() if line]


# ─── cmd: generate ───────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are a structured metadata extractor. Output ONLY a YAML block between ```yaml and ```. "
    "No prose, no explanation. For TAGS: pick ONLY from the provided list. "
    "For CONCEPTS: extract proper nouns, project names, or technical terms that appear literally "
    "in the note content. Keep original casing. If unsure about any concept, omit it. Never invent."
)


def build_prompt(tag_pool: list[str], content: str, folder: str, title: str, ftype: str) -> str:
    tag_csv = ", ".join(tag_pool)
    return (
        f"Fill the YAML below for this note.\n\n"
        f"TAG POOL (pick 2-3, EXACT spelling, do NOT pick '{ftype}'):\n"
        f"{tag_csv}\n\n"
        f"CONCEPTS: extract 3-5 proper nouns, project names, or technical terms that appear literally "
        f"in the note. Preserve original casing. Omit anything you're unsure about.\n\n"
        f"Note folder={folder}, title=\"{title}\"\n"
        f"Content:\n{content}\n\n"
        f"Output:\n"
        f"```yaml\ntags:\n  - <tag_from_pool>\nconcepts:\n  - <term_from_content>\n```"
    )


def call_llm(llm_cfg: dict, keys: list[str], idx: int, prompt: str):
    key = keys[idx % len(keys)]
    payload = json.dumps({
        "model": llm_cfg["model"],
        "max_tokens": llm_cfg["max_tokens"],
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
    })
    t0 = time.monotonic()
    try:
        r = subprocess.run(
            ["curl", "-s", "-m", str(llm_cfg.get("timeout", 90)), "-X", "POST",
             llm_cfg["endpoint"],
             "-H", "Content-Type: application/json",
             "-H", f"x-api-key: {key}",
             "-H", f"anthropic-version: {llm_cfg.get('anthropic_version', '2023-06-01')}",
             "-d", payload],
            capture_output=True, text=True, timeout=llm_cfg.get("timeout", 90) + 5,
        )
    except subprocess.TimeoutExpired:
        return None, time.monotonic() - t0, "timeout"
    elapsed = time.monotonic() - t0
    if r.returncode != 0:
        return None, elapsed, f"curl:{r.returncode}"
    try:
        d = json.loads(r.stdout)
    except json.JSONDecodeError:
        return None, elapsed, "not_json"
    if d.get("type") == "error":
        return None, elapsed, str(d.get("error", {}).get("message", ""))[:80]
    text = ""
    for block in d.get("content", []):
        if block.get("type") == "text":
            text = block.get("text", "")
            break
    return text, elapsed, None


def _clean_concept(val: str, max_len: int = 50) -> bool:
    if not val or len(val) > max_len:
        return False
    if any(c in val for c in [":", ",", ";"]):
        return False
    if len(val.split()) > 5:
        return False
    return True


def parse_llm_output(text: str, tag_pool: list[str]):
    m = re.search(r"```ya?ml\s*(.*?)```", text, re.DOTALL)
    body = m.group(1) if m else text
    tags, concepts, rejected = [], [], []
    section = None
    pool_lower = {t.lower(): t for t in tag_pool}
    for line in body.splitlines():
        s = line.strip()
        if s.startswith("tags"):
            section = "tags"
        elif s.startswith("concepts"):
            section = "concepts"
        elif s.startswith("- "):
            val = s[2:].strip().strip('"').strip("'").strip("`")
            if section == "tags":
                if val.lower() in pool_lower:
                    tags.append(pool_lower[val.lower()])
                else:
                    rejected.append(val)
            elif section == "concepts" and _clean_concept(val):
                concepts.append(val)
    return tags[:3], concepts[:5], rejected


def folder_status(folder: str, rules: dict) -> str:
    return rules.get(folder, rules.get("_default", "seed"))


def render_frontmatter(date: str, status: str, ftype: str, tags: list[str], concepts: list[str]) -> str:
    all_tags = [ftype] + tags
    lines = ["---", f"date: {date}", f"status: {status}", "tags:"]
    for t in all_tags:
        lines.append(f"  - {t}")
    if concepts:
        lines.append("concepts:")
        for c in concepts:
            lines.append(f"  - {c}")
    lines.append("---")
    return "\n".join(lines)


def process_one(cfg: dict, tag_pool: list[str], keys: list[str], idx: int, file: Path):
    vault = cfg["vault_path"]
    rel = file.relative_to(vault).as_posix()
    folder = rel.split("/", 1)[0]
    ftype = cfg["folder_type_map"].get(folder, "knowledge")
    status = folder_status(folder, cfg["status_rules"])
    date = datetime.fromtimestamp(file.stat().st_mtime).strftime("%Y-%m-%d")
    content = file.read_text(encoding="utf-8", errors="ignore")[:1500]
    prompt = build_prompt(tag_pool, content, folder, file.stem, ftype)
    text, elapsed, err = call_llm(cfg["llm"], keys, idx, prompt)
    tags, concepts, rejected = [], [], []
    if text:
        tags, concepts, rejected = parse_llm_output(text, tag_pool)
    return {
        "rel": rel, "abs_path": str(file), "date": date, "status": status, "ftype": ftype,
        "picked_tags": tags, "concepts": concepts, "rejected_tags": rejected,
        "frontmatter": render_frontmatter(date, status, ftype, tags, concepts),
        "llm_elapsed": round(elapsed, 2), "llm_err": err,
        "llm_raw": (text or "")[:400],
    }


def cmd_generate(cfg: dict, folder_filter: str | None, limit: int, seed: int | None):
    vault = cfg["vault_path"]
    skip = set(cfg["skip_dirs"])
    tag_pool = load_tag_pool(cfg)
    keys = cfg["llm"]["api_keys"]
    if not keys:
        raise SystemExit("no api_keys configured (check env substitution)")

    # Find all no-FM files (optionally filtered)
    candidates = []
    for p in iter_vault_notes(vault, skip):
        rel = p.relative_to(vault).as_posix()
        if folder_filter and not rel.startswith(folder_filter.rstrip("/") + "/"):
            continue
        if has_frontmatter(p):
            continue
        candidates.append(p)

    if seed is not None:
        random.seed(seed)
        random.shuffle(candidates)
    if limit > 0:
        candidates = candidates[:limit]

    print(f"tag_pool={len(tag_pool)} keys={len(keys)} candidates={len(candidates)}")
    print(f"top tags: {tag_pool[:10]}")
    print()

    max_conc = cfg["llm"].get("max_concurrent", 10)
    results = []
    with ThreadPoolExecutor(max_workers=max_conc) as ex:
        futs = [ex.submit(process_one, cfg, tag_pool, keys, i, f)
                for i, f in enumerate(candidates)]
        for fut in as_completed(futs):
            results.append(fut.result())

    # Write preview files
    preview_dir = cfg["work_dir"] / "preview"
    manifest_path = cfg["work_dir"] / "generate_manifest.json"
    manifest = []
    results.sort(key=lambda x: x["rel"])
    ok = sum(1 for r in results if r["picked_tags"] or r["concepts"])
    fail = len(results) - ok
    for i, r in enumerate(results, 1):
        slug = re.sub(r"[^\w\-]", "_", Path(r["rel"]).stem)[:40]
        fname = f"{i:04d}_{slug}.yml"
        (preview_dir / fname).write_text(
            f"# source: {r['rel']}\n"
            f"# abs: {r['abs_path']}\n"
            f"# llm: {r['llm_elapsed']}s  err: {r['llm_err']}\n"
            f"# rejected_tags: {r['rejected_tags']}\n\n"
            f"{r['frontmatter']}\n\n"
            f"# raw: {r['llm_raw'][:400]}\n",
            encoding="utf-8",
        )
        manifest.append({
            "preview_file": str(preview_dir / fname),
            "source_rel": r["rel"],
            "source_abs": r["abs_path"],
            "frontmatter": r["frontmatter"],
            "llm_err": r["llm_err"],
        })
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"generate: ok={ok} fail={fail} total={len(results)}")
    print(f"previews: {preview_dir}")
    print(f"manifest: {manifest_path}")


# ─── cmd: apply ──────────────────────────────────────────────────────

def git_commit(vault: Path, message: str):
    try:
        subprocess.run(["git", "-C", str(vault), "add", "-A"],
                       check=True, capture_output=True, text=True)
        r = subprocess.run(["git", "-C", str(vault), "commit", "-m", message],
                           capture_output=True, text=True)
        if r.returncode == 0:
            print(f"  git commit: {message}")
        else:
            print("  git commit skipped (nothing to commit or not a repo)")
    except FileNotFoundError:
        print("  git not installed, skipping commit")


def atomic_prepend(source: Path, frontmatter_block: str) -> tuple[bool, str]:
    """Prepend frontmatter + blank line to source atomically. Returns (ok, msg)."""
    if not source.exists():
        return False, f"source missing: {source}"
    original = source.read_bytes()
    if original.startswith(b"---"):
        return False, "already has frontmatter, skipping"
    prepended = frontmatter_block.encode("utf-8") + b"\n\n" + original
    tmp = source.with_suffix(source.suffix + ".tmp_fm")
    tmp.write_bytes(prepended)
    # Atomic rename
    os.replace(tmp, source)
    # Verify
    reread = source.read_text(encoding="utf-8", errors="ignore")[:200]
    if not reread.startswith("---"):
        return False, "post-write verification failed"
    return True, "ok"


def append_log(log_path: Path, entries: list[dict]):
    if not log_path:
        return
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [f"\n## [{now}] frontmatter-apply | {len(entries)} files"]
    for e in entries:
        lines.append(f"- {e['status']}: `{e['source_rel']}` -- {e['msg']}")
    with log_path.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def cmd_apply(cfg: dict, execute: bool):
    vault = cfg["vault_path"]
    manifest_path = cfg["work_dir"] / "generate_manifest.json"
    if not manifest_path.exists():
        raise SystemExit("no manifest: run `generate` first")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    # Filter: skip entries with no frontmatter content (all-empty LLM failures)
    applyable = []
    for e in manifest:
        fm = e["frontmatter"]
        # Sanity: must have at least `date:` and `tags:`
        if "date:" in fm and "tags:" in fm:
            applyable.append(e)

    print(f"total={len(manifest)} applyable={len(applyable)} skipped={len(manifest) - len(applyable)}")

    if not execute:
        print("\n[DRY RUN] would apply:")
        for e in applyable[:5]:
            print(f"  - {e['source_rel']}")
        print(f"  ... ({len(applyable)} total)")
        print("\nrerun with --execute to actually write")
        return

    # Git snapshot before
    if cfg.get("git_commit", True):
        git_commit(vault, f"fm-generator: snapshot before batch ({len(applyable)} files)")

    log_entries = []
    ok_count = fail_count = 0
    for e in applyable:
        src = Path(e["source_abs"])
        ok, msg = atomic_prepend(src, e["frontmatter"])
        log_entries.append({
            "source_rel": e["source_rel"],
            "status": "OK" if ok else "FAIL",
            "msg": msg,
        })
        if ok:
            ok_count += 1
        else:
            fail_count += 1
            print(f"  FAIL {e['source_rel']}: {msg}")

    # Log
    log_path = cfg.get("log_path")
    if log_path:
        append_log(Path(log_path), log_entries)

    # Git commit after
    if cfg.get("git_commit", True):
        git_commit(vault, f"fm-generator: apply frontmatter to {ok_count} files")

    print(f"\napply: ok={ok_count} fail={fail_count}")
    if log_path:
        print(f"log: {log_path}")


# ─── cmd: retry ──────────────────────────────────────────────────────

def replace_frontmatter(source: Path, new_fm: str) -> tuple[bool, str]:
    """Replace existing frontmatter block atomically. Preserves body bytes."""
    if not source.exists():
        return False, f"source missing: {source}"
    text = source.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return False, "no existing frontmatter"
    m = re.match(r"---\s*\n.*?\n---\s*\n?", text, re.DOTALL)
    if not m:
        return False, "malformed frontmatter"
    body = text[m.end():]
    new_text = new_fm + "\n\n" + body.lstrip("\n")
    tmp = source.with_suffix(source.suffix + ".tmp_fm")
    tmp.write_text(new_text, encoding="utf-8")
    os.replace(tmp, source)
    reread = source.read_text(encoding="utf-8", errors="ignore")[:100]
    if not reread.startswith("---"):
        return False, "post-write verification failed"
    return True, "replaced"


def count_fm_richness(fm_body: str) -> tuple[int, int]:
    """Return (extra_tag_count, concept_count). The first tag is usually the type, hence 'extra'."""
    tag_count = concept_count = 0
    in_tags = in_concepts = False
    for line in fm_body.splitlines():
        s = line.rstrip()
        if s == "tags:":
            in_tags, in_concepts = True, False
        elif s == "concepts:":
            in_concepts, in_tags = True, False
        elif s.startswith("  - ") or s.startswith("- "):
            if in_tags:
                tag_count += 1
            elif in_concepts:
                concept_count += 1
        elif s and not s.startswith(" "):
            in_tags = in_concepts = False
    extra_tags = max(0, tag_count - 1)  # first tag is typically the ftype
    return extra_tags, concept_count


def find_weak_fm_files(vault: Path, skip_dirs: set[str]) -> list[Path]:
    weak = []
    for p in iter_vault_notes(vault, skip_dirs):
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        body = extract_frontmatter_body(text)
        if body is None:
            continue
        extra_tags, concepts = count_fm_richness(body)
        if extra_tags == 0 and concepts == 0:
            weak.append(p)
    return weak


def build_retry_prompt(tag_pool: list[str], content: str, folder: str,
                       filename: str, ftype: str) -> str:
    tag_csv = ", ".join(tag_pool)
    return (
        f"Fill the YAML below for this note.\n\n"
        f"TAG POOL (pick 2-3, EXACT spelling, do NOT pick '{ftype}'):\n"
        f"{tag_csv}\n\n"
        f"CONCEPTS: extract 3-5 proper nouns, project names, or technical terms.\n"
        f"If the content is SPARSE (short, boilerplate, or mostly TODO), INFER concepts from "
        f"the filename '{filename}' and parent folder '{folder}'. Preserve original casing. "
        f"Omit anything you cannot justify from file content + name + folder. Never fabricate.\n\n"
        f"Note folder={folder}, filename=\"{filename}\"\n"
        f"Content (up to 3000 chars):\n{content}\n\n"
        f"Output:\n"
        f"```yaml\ntags:\n  - <tag_from_pool>\nconcepts:\n  - <term>\n```"
    )


def process_retry_one(cfg: dict, tag_pool: list[str], keys: list[str], idx: int, file: Path):
    vault = cfg["vault_path"]
    rel = file.relative_to(vault).as_posix()
    folder = rel.split("/", 1)[0]
    ftype = cfg["folder_type_map"].get(folder, "knowledge")
    status = folder_status(folder, cfg["status_rules"])
    date = datetime.fromtimestamp(file.stat().st_mtime).strftime("%Y-%m-%d")
    # Strip existing FM to avoid feeding stale minimum block as content
    raw = file.read_text(encoding="utf-8", errors="ignore")
    m = re.match(r"---\s*\n.*?\n---\s*\n?", raw, re.DOTALL)
    body = raw[m.end():] if m else raw
    content = body[:3000]
    prompt = build_retry_prompt(tag_pool, content, folder, file.stem, ftype)
    text, elapsed, err = call_llm(cfg["llm"], keys, idx, prompt)
    tags, concepts, rejected = [], [], []
    if text:
        tags, concepts, rejected = parse_llm_output(text, tag_pool)
    return {
        "rel": rel, "abs_path": str(file), "date": date, "status": status, "ftype": ftype,
        "picked_tags": tags, "concepts": concepts, "rejected_tags": rejected,
        "frontmatter": render_frontmatter(date, status, ftype, tags, concepts),
        "llm_elapsed": round(elapsed, 2), "llm_err": err,
        "llm_raw": (text or "")[:400],
    }


def cmd_retry(cfg: dict, execute: bool):
    vault = cfg["vault_path"]
    skip = set(cfg["skip_dirs"])
    tag_pool = load_tag_pool(cfg)
    keys = cfg["llm"]["api_keys"]

    weak = find_weak_fm_files(vault, skip)
    print(f"weak FM files (type-tag only, no concepts): {len(weak)}")
    if not weak:
        print("nothing to retry")
        return

    max_conc = cfg["llm"].get("max_concurrent", 10)
    results = []
    with ThreadPoolExecutor(max_workers=max_conc) as ex:
        futs = [ex.submit(process_retry_one, cfg, tag_pool, keys, i, f)
                for i, f in enumerate(weak)]
        for fut in as_completed(futs):
            results.append(fut.result())

    results.sort(key=lambda x: x["rel"])
    improved = [r for r in results if r["picked_tags"] or r["concepts"]]
    still_weak = [r for r in results if not r["picked_tags"] and not r["concepts"]]
    print(f"retry: improved={len(improved)} still_weak={len(still_weak)} total={len(results)}")

    if not execute:
        print("\n[DRY RUN] would replace FM on:")
        for r in improved[:10]:
            print(f"  - {r['rel']} -> tags={r['picked_tags']} concepts={r['concepts']}")
        if len(improved) > 10:
            print(f"  ... ({len(improved)} total)")
        print("\nrerun with --execute to actually overwrite")
        return

    if cfg.get("git_commit", True):
        git_commit(vault, f"fm-generator: snapshot before retry ({len(improved)} files)")

    log_entries = []
    ok = fail = 0
    for r in improved:
        src = Path(r["abs_path"])
        success, msg = replace_frontmatter(src, r["frontmatter"])
        log_entries.append({
            "source_rel": r["rel"],
            "status": "OK" if success else "FAIL",
            "msg": msg,
        })
        if success:
            ok += 1
        else:
            fail += 1
            print(f"  FAIL {r['rel']}: {msg}")

    log_path = cfg.get("log_path")
    if log_path:
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        with Path(log_path).open("a", encoding="utf-8") as f:
            f.write(f"\n## [{now}] frontmatter-retry | {ok} files\n")
            for e in log_entries:
                f.write(f"- {e['status']}: `{e['source_rel']}` -- {e['msg']}\n")

    if cfg.get("git_commit", True):
        git_commit(vault, f"fm-generator: retry weak FM on {ok} files")

    print(f"\nretry: ok={ok} fail={fail} still_weak_after_retry={len(still_weak)}")


# ─── cmd: audit ──────────────────────────────────────────────────────

DEFAULT_CANONICAL_STATUS = ["inbox", "seed", "active", "archived"]
DEFAULT_CANONICAL_TYPES = [
    "project", "research", "engineering", "daily",
    "trading", "protocol", "template", "infrastructure",
]


def parse_fm_fields(fm_body: str) -> dict:
    """Extract status, type, concepts presence from a FM body."""
    status = note_type = None
    has_concepts = False
    in_concepts = False
    for line in fm_body.splitlines():
        s = line.rstrip()
        m = re.match(r"^status\s*:\s*(.+)$", s)
        if m:
            status = m.group(1).strip().strip('"').strip("'")
            continue
        m = re.match(r"^type\s*:\s*(.+)$", s)
        if m:
            note_type = m.group(1).strip().strip('"').strip("'")
            continue
        if s == "concepts:":
            in_concepts = True
            continue
        if in_concepts and (s.startswith("  - ") or s.startswith("- ")):
            has_concepts = True
            in_concepts = False
        elif s and not s.startswith(" ") and in_concepts:
            in_concepts = False
    return {"status": status, "type": note_type, "has_concepts": has_concepts}


def cmd_audit(cfg: dict):
    vault = cfg["vault_path"]
    skip = set(cfg["skip_dirs"])
    canonical_status = set(cfg.get("canonical_status") or DEFAULT_CANONICAL_STATUS)
    canonical_types = set(cfg.get("canonical_types") or DEFAULT_CANONICAL_TYPES)

    status_non_canonical: dict[str, list[str]] = {}
    type_non_canonical: dict[str, list[str]] = {}
    missing_concepts: list[str] = []
    stats = Counter()

    for p in iter_vault_notes(vault, skip):
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        body = extract_frontmatter_body(text)
        if body is None:
            stats["no_frontmatter"] += 1
            continue
        stats["total_with_fm"] += 1
        rel = p.relative_to(vault).as_posix()
        fields = parse_fm_fields(body)
        if fields["status"]:
            if fields["status"] in canonical_status:
                stats["status_canonical"] += 1
            else:
                status_non_canonical.setdefault(fields["status"], []).append(rel)
        else:
            stats["status_missing"] += 1
        if fields["type"]:
            if fields["type"] in canonical_types:
                stats["type_canonical"] += 1
            else:
                type_non_canonical.setdefault(fields["type"], []).append(rel)
        else:
            stats["type_missing"] += 1
        if fields["has_concepts"]:
            stats["has_concepts"] += 1
        else:
            missing_concepts.append(rel)

    # Render report
    out = cfg["work_dir"] / "legacy_audit_report.md"
    lines = [
        "# Legacy Frontmatter Audit",
        "",
        f"- vault: `{vault}`",
        f"- generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"- canonical status: {sorted(canonical_status)}",
        f"- canonical types: {sorted(canonical_types)}",
        "",
        "## Stats",
        "",
    ]
    for k, v in stats.most_common():
        lines.append(f"- {k}: {v}")

    lines.append("")
    lines.append("## Non-canonical `status` values")
    lines.append("")
    if not status_non_canonical:
        lines.append("_None — all status values are canonical._")
    else:
        for val, files in sorted(status_non_canonical.items(), key=lambda x: -len(x[1])):
            lines.append(f"### `{val}` ({len(files)} files)")
            lines.append("")
            for f in files[:20]:
                lines.append(f"- `{f}`")
            if len(files) > 20:
                lines.append(f"- _...and {len(files) - 20} more_")
            lines.append("")

    lines.append("## Non-canonical `type` values")
    lines.append("")
    if not type_non_canonical:
        lines.append("_None — all type values are canonical._")
    else:
        for val, files in sorted(type_non_canonical.items(), key=lambda x: -len(x[1])):
            lines.append(f"### `{val}` ({len(files)} files)")
            lines.append("")
            for f in files[:20]:
                lines.append(f"- `{f}`")
            if len(files) > 20:
                lines.append(f"- _...and {len(files) - 20} more_")
            lines.append("")

    lines.append("## Files missing `concepts` field")
    lines.append("")
    lines.append(f"**{len(missing_concepts)} files** — top 30:")
    lines.append("")
    for f in missing_concepts[:30]:
        lines.append(f"- `{f}`")
    if len(missing_concepts) > 30:
        lines.append(f"- _...and {len(missing_concepts) - 30} more_")
    lines.append("")

    lines.append("## Remediation Suggestions")
    lines.append("")
    lines.append(
        "- Non-canonical `status` values are free-form strings. "
        "Consider mapping each to a canonical value "
        "(e.g. 'v1.0-shipped' -> 'archived', 'in-progress' -> 'active')."
    )
    lines.append(
        "- Non-canonical `type` values may represent legitimate sub-kinds not in the canonical list. "
        "Decide: promote to canonical, rename to closest canonical, or extend `canonical_types` config."
    )
    lines.append("- Files missing `concepts` can be enriched by a separate `enrich` pass (not yet implemented).")

    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"audit report written: {out}")
    print("\nstats:")
    for k, v in stats.most_common():
        print(f"  {k}: {v}")
    print(f"\nnon-canonical status values: {len(status_non_canonical)}")
    print(f"non-canonical type values:   {len(type_non_canonical)}")
    print(f"files missing concepts:       {len(missing_concepts)}")


# ─── main ────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_vocab = sub.add_parser("vocab", help="scan vault tag frequencies")
    p_vocab.add_argument("--config", required=True)

    p_gen = sub.add_parser("generate", help="LLM-generate frontmatter previews")
    p_gen.add_argument("--config", required=True)
    p_gen.add_argument("--folder", default=None, help="restrict to top-level folder")
    p_gen.add_argument("--limit", type=int, default=0, help="0=all")
    p_gen.add_argument("--seed", type=int, default=None)

    p_app = sub.add_parser("apply", help="atomic prepend previews to source files")
    p_app.add_argument("--config", required=True)
    p_app.add_argument("--execute", action="store_true", help="actually write (default dry-run)")

    p_retry = sub.add_parser(
        "retry",
        help="retry LLM on files with minimum-only frontmatter (type-tag only, no concepts)",
    )
    p_retry.add_argument("--config", required=True)
    p_retry.add_argument("--execute", action="store_true", help="actually overwrite FM (default dry-run)")

    p_audit = sub.add_parser("audit", help="scan existing FM for non-canonical status/type + missing concepts")
    p_audit.add_argument("--config", required=True)

    args = ap.parse_args()
    cfg = load_config(Path(args.config))

    if args.cmd == "vocab":
        cmd_vocab(cfg)
    elif args.cmd == "generate":
        cmd_generate(cfg, args.folder, args.limit, args.seed)
    elif args.cmd == "apply":
        cmd_apply(cfg, args.execute)
    elif args.cmd == "retry":
        cmd_retry(cfg, args.execute)
    elif args.cmd == "audit":
        cmd_audit(cfg)


if __name__ == "__main__":
    main()
