#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import platform
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
)

WEB_CLIPPER_ID = "cnjifjpddelmedmihgijeibhnjfabmlf"
WEB_CLIPPER_INSTALL_URL = f"https://chromewebstore.google.com/detail/obsidian-web-clipper/{WEB_CLIPPER_ID}"
DEFAULT_THRESHOLD = 90000
DEFAULT_DAYS = 90


@dataclass(frozen=True)
class BrowserProfile:
    browser: str
    app_name: str
    user_data_dir: Path
    profile: str
    keychain_service: str

    @property
    def profile_dir(self) -> Path:
        return self.user_data_dir / self.profile

    @property
    def cookies_db(self) -> Path:
        return self.profile_dir / "Cookies"

    @property
    def extensions_dir(self) -> Path:
        return self.profile_dir / "Extensions"


@dataclass(frozen=True)
class Account:
    display_name: str
    handle: str
    url: str


@dataclass
class Candidate:
    account: Account
    tweet_id: str
    tweet_url: str
    clip_url: str
    clip_kind: str
    created_at: dt.datetime
    text: str
    views: int
    likes: int
    retweets: int
    replies: int


@dataclass(frozen=True)
class BrowserTab:
    window_index: int
    tab_index: int
    tab_id: str
    url: str


def run(cmd: list[str], *, input_bytes: bytes | None = None, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check)


def browser_profile(browser: str, profile: str) -> BrowserProfile:
    home = Path.home()
    if browser == "chrome":
        return BrowserProfile(
            browser="chrome",
            app_name="Google Chrome",
            user_data_dir=home / "Library/Application Support/Google/Chrome",
            profile=profile,
            keychain_service="Chrome Safe Storage",
        )
    if browser == "dia":
        return BrowserProfile(
            browser="dia",
            app_name="Dia",
            user_data_dir=home / "Library/Application Support/Dia/User Data",
            profile=profile,
            keychain_service="Dia Safe Storage",
        )
    raise ValueError("browser must be chrome or dia")


def read_obsidian_vault() -> Path:
    config = Path.home() / "Library/Application Support/obsidian/obsidian.json"
    if not config.exists():
        raise RuntimeError("Obsidian config not found. Open Obsidian and a vault first.")
    data = json.loads(config.read_text(encoding="utf-8"))
    vaults = data.get("vaults", {})
    open_vaults = [Path(v["path"]) for v in vaults.values() if v.get("open") and v.get("path")]
    if not open_vaults:
        raise RuntimeError("No open Obsidian vault found in obsidian.json.")
    if not open_vaults[0].exists():
        raise RuntimeError(f"Open Obsidian vault path does not exist: {open_vaults[0]}")
    return open_vaults[0]


def check_web_clipper(profile: BrowserProfile) -> Path:
    root = profile.extensions_dir / WEB_CLIPPER_ID
    manifests = sorted(root.glob("*/manifest.json"))
    if not manifests:
        raise RuntimeError(
            f"Obsidian Web Clipper extension not found in {profile.extensions_dir}. "
            "Install the official extension in the selected browser/profile."
        )
    return manifests[-1]


def open_web_clipper_install_page(profile: BrowserProfile) -> None:
    run(["/usr/bin/open", "-a", profile.app_name, WEB_CLIPPER_INSTALL_URL])


def run_setup(profile: BrowserProfile) -> int:
    print(f"Browser: {profile.browser} / {profile.profile}", flush=True)
    try:
        manifest = check_web_clipper(profile)
        print(f"Obsidian Web Clipper: installed ({manifest})", flush=True)
    except RuntimeError:
        print("Obsidian Web Clipper: not installed in the selected browser/profile.", flush=True)
        print(f"Opening install page: {WEB_CLIPPER_INSTALL_URL}", flush=True)
        open_web_clipper_install_page(profile)
        print(
            "\n请在打开的 Chrome Web Store 页面手动完成：\n"
            "1. 点击添加到浏览器 / Add to Chrome。\n"
            "2. 确认扩展权限。\n"
            "3. 打开 Obsidian，并切到要保存的目标 vault。\n"
            "4. 在浏览器扩展快捷键里确认 Obsidian Web Clipper 可用；默认流程需要 Cmd+Shift+O 打开插件，然后 Enter 保存。\n"
            "5. 装好后重新运行 --preflight 验证环境。\n",
            flush=True,
        )
        return 1

    print(
        "\n下一步请确认：\n"
        "1. X 已在这个浏览器 profile 登录。\n"
        "2. Obsidian 已打开目标 vault。\n"
        "3. macOS 已给 Codex/System Events/浏览器/Obsidian 授权辅助功能和自动化权限。\n"
        "4. 运行 --preflight 做最终检查。\n",
        flush=True,
    )
    return 0


def check_automation_permission() -> None:
    if platform.system() != "Darwin":
        raise RuntimeError("Full automation mode is v1 macOS-only.")
    result = run(
        ["/usr/bin/osascript", "-e", 'tell application "System Events" to get UI elements enabled'],
        check=False,
    )
    if result.returncode != 0:
        err = result.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(
            "System Events automation is not available. Grant Accessibility/Automation permissions "
            f"to the app running Codex, then retry. Details: {err}"
        )
    result = run(
        [
            "/usr/bin/osascript",
            "-e",
            'tell application "System Events" to key code 53',
        ],
        check=False,
    )
    if result.returncode != 0:
        err = result.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(
            "System Events is visible but cannot send keystrokes. Grant the app running Codex "
            "permission to control the computer in macOS Privacy & Security > Accessibility/Automation. "
            f"Details: {err}"
        )


def keychain_password(service: str) -> str:
    result = run(["/usr/bin/security", "find-generic-password", "-w", "-s", service])
    return result.stdout.decode().strip()


def decrypt_cookie(encrypted_value: bytes, host_key: str, key: bytes) -> str:
    if not encrypted_value:
        return ""
    data = encrypted_value
    if data[:3] in (b"v10", b"v11"):
        data = data[3:]
    proc = run(
        [
            "/usr/bin/openssl",
            "enc",
            "-d",
            "-aes-128-cbc",
            "-K",
            key.hex(),
            "-iv",
            (b" " * 16).hex(),
        ],
        input_bytes=data,
    )
    out = proc.stdout
    digest = hashlib.sha256(host_key.encode()).digest()
    if len(out) > 32 and out[:32] == digest:
        out = out[32:]
    return out.decode("utf-8", "replace")


def cookie_header(profile: BrowserProfile) -> tuple[str, str]:
    if not profile.cookies_db.exists():
        raise RuntimeError(f"Cookie DB not found: {profile.cookies_db}")
    password = keychain_password(profile.keychain_service)
    key = hashlib.pbkdf2_hmac("sha1", password.encode(), b"saltysalt", 1003, 16)
    hosts = {".x.com", "x.com", "api.x.com", ".twitter.com", "twitter.com"}
    con = sqlite3.connect(f"file:{profile.cookies_db}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "select host_key, name, value, encrypted_value from cookies "
            "where host_key in ({}) order by host_key, name".format(",".join("?" for _ in hosts)),
            sorted(hosts),
        ).fetchall()
    finally:
        con.close()

    pairs: list[str] = []
    seen: set[str] = set()
    ct0 = ""
    for host_key, name, value, encrypted in rows:
        val = value or ""
        if not val and encrypted:
            val = decrypt_cookie(encrypted, host_key, key)
        if not val:
            continue
        if name not in seen:
            pairs.append(f"{name}={val}")
            seen.add(name)
        if name == "ct0" and not ct0:
            ct0 = val
    if not ct0 or "auth_token=" not in "; ".join(pairs):
        raise RuntimeError("X login cookies were not found/decrypted. Log in to X in the selected browser profile.")
    return "; ".join(pairs), ct0


def http_get(url: str, headers: dict[str, str], *, timeout: int = 45) -> tuple[int, str]:
    marker = "\n__X_TO_OBSIDIAN_HTTP_STATUS__:"
    cmd = [
        "/usr/bin/curl",
        "-sSL",
        "--compressed",
        "--connect-timeout",
        "15",
        "--max-time",
        str(timeout),
    ]
    for key, value in headers.items():
        cmd.extend(["-H", f"{key}: {value}"])
    cmd.extend(["-w", marker + "%{http_code}", url])
    result = run(cmd, check=False)
    out = result.stdout.decode("utf-8", "replace")
    if result.returncode != 0:
        err = result.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(f"HTTP GET failed for {url}: {err or 'curl exited ' + str(result.returncode)}")
    if marker not in out:
        raise RuntimeError(f"HTTP GET failed for {url}: missing status marker")
    body, status_raw = out.rsplit(marker, 1)
    return int(status_raw.strip() or "0"), body


def load_x_frontend(cookie: str) -> tuple[str, dict[str, dict[str, Any]]]:
    status, html = http_get(
        "https://x.com/home",
        {"user-agent": USER_AGENT, "accept-language": "zh-CN,zh;q=0.9,en;q=0.8", "cookie": cookie},
    )
    if status != 200:
        raise RuntimeError(f"X shell returned HTTP {status}")
    scripts = re.findall(r'<script[^>]+src="([^"]+\.js)"', html)
    main_url = next((urllib.parse.urljoin("https://x.com", s) for s in scripts if "/main." in s), None)
    if not main_url:
        raise RuntimeError("Could not locate X main JS bundle.")
    _, main_js = http_get(main_url, {"user-agent": USER_AGENT})
    bearer = re.search(r"Bearer ([A-Za-z0-9%._-]+)", main_js)
    if not bearer:
        raise RuntimeError("Could not extract X bearer token.")

    def extract_operation(op_name: str) -> dict[str, Any]:
        idx = main_js.find(f'operationName:"{op_name}"')
        if idx < 0:
            raise RuntimeError(f"Could not find X operation {op_name}")
        start = main_js.rfind("e.exports={", 0, idx)
        end = main_js.find("}}}", idx) + 3
        chunk = main_js[start:end]
        query_id = re.search(r'queryId:"([^"]+)"', chunk)
        if not query_id:
            raise RuntimeError(f"Could not find query id for {op_name}")

        def arr(key: str) -> list[str]:
            match = re.search(key + r":\[([^\]]*)\]", chunk)
            return re.findall(r'"([^"]+)"', match.group(1)) if match else []

        return {
            "queryId": query_id.group(1),
            "operationName": op_name,
            "featureSwitches": arr("featureSwitches"),
            "fieldToggles": arr("fieldToggles"),
        }

    return bearer.group(1), {
        "UserByScreenName": extract_operation("UserByScreenName"),
        "UserTweets": extract_operation("UserTweets"),
    }


class XClient:
    def __init__(self, cookie: str, ct0: str, bearer: str, operations: dict[str, dict[str, Any]]):
        self.cookie = cookie
        self.ct0 = ct0
        self.bearer = bearer
        self.operations = operations

    def gql(self, op_name: str, variables: dict[str, Any], referer: str) -> dict[str, Any]:
        op = self.operations[op_name]
        params = {
            "variables": json.dumps(variables, separators=(",", ":")),
            "features": json.dumps({k: True for k in op["featureSwitches"]}, separators=(",", ":")),
            "fieldToggles": json.dumps({k: True for k in op["fieldToggles"]}, separators=(",", ":")),
        }
        url = f"https://x.com/i/api/graphql/{op['queryId']}/{op['operationName']}?" + urllib.parse.urlencode(params)
        headers = {
            "authorization": f"Bearer {self.bearer}",
            "cookie": self.cookie,
            "x-csrf-token": self.ct0,
            "x-twitter-active-user": "yes",
            "x-twitter-auth-type": "OAuth2Session",
            "x-twitter-client-language": "zh-cn",
            "user-agent": USER_AGENT,
            "accept": "*/*",
            "referer": referer,
        }
        status, body = http_get(url, headers)
        data = json.loads(body)
        if status >= 400 or data.get("errors"):
            raise RuntimeError(f"X API {op_name} error {status}: {data.get('errors') or body[:300]}")
        return data

    def user_id(self, handle: str) -> str:
        data = self.gql(
            "UserByScreenName",
            {"screen_name": handle, "withSafetyModeUserFields": True},
            f"https://x.com/{handle}",
        )
        result = data.get("data", {}).get("user", {}).get("result")
        if not result or not result.get("rest_id"):
            raise RuntimeError(f"Could not resolve user id for @{handle}")
        return result["rest_id"]

    def user_tweets_page(self, user_id: str, handle: str, cursor: str | None, count: int) -> dict[str, Any]:
        variables: dict[str, Any] = {
            "userId": user_id,
            "count": count,
            "includePromotedContent": True,
            "withQuickPromoteEligibilityTweetFields": True,
            "withVoice": True,
        }
        if cursor:
            variables["cursor"] = cursor
        return self.gql("UserTweets", variables, f"https://x.com/{handle}")


def unwrap_tweet(obj: Any) -> dict[str, Any] | None:
    if not isinstance(obj, dict):
        return None
    if obj.get("__typename") == "Tweet" and obj.get("rest_id") and obj.get("legacy"):
        return obj
    for key in ("tweet", "tweet_results", "result"):
        child = obj.get(key)
        if isinstance(child, dict):
            found = unwrap_tweet(child)
            if found:
                return found
    return None


def walk_tweets(obj: Any, out: list[dict[str, Any]]) -> None:
    if isinstance(obj, dict):
        tweet = unwrap_tweet(obj)
        if tweet:
            out.append(tweet)
        for value in obj.values():
            if isinstance(value, (dict, list)):
                walk_tweets(value, out)
    elif isinstance(obj, list):
        for item in obj:
            walk_tweets(item, out)


def bottom_cursor(obj: Any) -> str | None:
    if isinstance(obj, dict):
        if obj.get("cursorType") == "Bottom" and obj.get("value"):
            return obj["value"]
        for value in obj.values():
            found = bottom_cursor(value)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = bottom_cursor(item)
            if found:
                return found
    return None


def parse_created_at(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%a %b %d %H:%M:%S %z %Y")


def tweet_author_handle(tweet: dict[str, Any]) -> str:
    user = tweet.get("core", {}).get("user_results", {}).get("result", {})
    return user.get("core", {}).get("screen_name") or user.get("legacy", {}).get("screen_name", "")


def article_url(tweet: dict[str, Any]) -> str | None:
    legacy = tweet.get("legacy", {})
    for item in legacy.get("entities", {}).get("urls", []) or []:
        expanded = item.get("expanded_url") or item.get("url") or ""
        if "/i/article/" in expanded:
            parsed = urllib.parse.urlparse(expanded)
            if parsed.scheme in ("http", "https") and parsed.netloc:
                return urllib.parse.urlunparse(("https", parsed.netloc, parsed.path, "", "", ""))
    return None


def safe_path_part(value: str, max_len: int = 80) -> str:
    value = re.sub(r"[\\/:*?\"<>|#^\[\]\n\r\t]", "-", value)
    value = re.sub(r"\s+", " ", value).strip().strip(". ")
    return (value[:max_len].rstrip() if len(value) > max_len else value) or "untitled"


def parse_accounts_text(text: str) -> list[Account]:
    accounts: list[Account] = []
    pending_name: str | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        urls = re.findall(r"https?://(?:x|twitter)\.com/([A-Za-z0-9_]+)(?:\b|/)?", line)
        if urls:
            handle = urls[0]
            url = f"https://x.com/{handle}"
            name = re.sub(r"https?://\S+", "", line).strip() or pending_name or handle
            name = name.strip("-:： \t") or handle
            accounts.append(Account(display_name=safe_path_part(name), handle=handle, url=url))
            pending_name = None
        elif re.fullmatch(r"@?[A-Za-z0-9_]{1,20}", line):
            handle = line.lstrip("@")
            accounts.append(Account(display_name=handle, handle=handle, url=f"https://x.com/{handle}"))
            pending_name = None
        else:
            pending_name = line
    return dedupe_accounts(accounts)


def load_accounts(path: Path | None, text: str | None) -> list[Account]:
    if text:
        return parse_accounts_text(text)
    if not path:
        raise RuntimeError("Provide --accounts-file or --accounts-text.")
    raw = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        data = json.loads(raw)
        accounts = []
        for item in data:
            handle = (item.get("handle") or "").lstrip("@")
            url = item.get("url") or f"https://x.com/{handle}"
            name = item.get("display_name") or item.get("name") or handle
            accounts.append(Account(safe_path_part(name), handle, url))
        return dedupe_accounts(accounts)
    if "," in raw.splitlines()[0]:
        reader = csv.DictReader(raw.splitlines())
        accounts = []
        for row in reader:
            handle = (row.get("handle") or "").lstrip("@")
            if not handle and row.get("url"):
                match = re.search(r"https?://(?:x|twitter)\.com/([A-Za-z0-9_]+)", row["url"])
                handle = match.group(1) if match else ""
            if handle:
                accounts.append(Account(safe_path_part(row.get("display_name") or row.get("name") or handle), handle, row.get("url") or f"https://x.com/{handle}"))
        return dedupe_accounts(accounts)
    return parse_accounts_text(raw)


def dedupe_accounts(accounts: list[Account]) -> list[Account]:
    seen: set[str] = set()
    out: list[Account] = []
    for account in accounts:
        key = account.handle.lower()
        if key and key not in seen:
            seen.add(key)
            out.append(account)
    return out


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"processed": {}, "runs": []}
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def append_report(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    exists = path.exists()
    with path.open("a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "run_at",
                "account",
                "handle",
                "tweet_id",
                "views",
                "created_at",
                "tweet_url",
                "clip_url",
                "clip_kind",
                "status",
                "note_path",
                "message",
            ],
        )
        if not exists:
            writer.writeheader()
        writer.writerows(rows)


def markdown_files(vault: Path) -> dict[Path, float]:
    result: dict[Path, float] = {}
    for path in vault.rglob("*.md"):
        try:
            result[path] = path.stat().st_mtime
        except OSError:
            pass
    return result


def applescript_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def active_tab_url(app_name: str) -> str:
    script = f'tell application {applescript_string(app_name)} to get URL of active tab of front window'
    result = run(["/usr/bin/osascript", "-e", script], check=False)
    if result.returncode != 0:
        return ""
    return result.stdout.decode("utf-8", "replace").strip()


def browser_tabs(app_name: str) -> list[BrowserTab]:
    script = f'''
tell application {applescript_string(app_name)}
  set out to ""
  repeat with wIndex from 1 to count of windows
    repeat with tIndex from 1 to count of tabs of window wIndex
      try
        set tabId to id of tab tIndex of window wIndex
      on error
        set tabId to ""
      end try
      try
        set tabUrl to URL of tab tIndex of window wIndex
      on error
        set tabUrl to ""
      end try
      set out to out & wIndex & "||" & tIndex & "||" & tabId & "||" & tabUrl & linefeed
    end repeat
  end repeat
  return out
end tell
'''
    result = run(["/usr/bin/osascript", "-e", script], check=False)
    if result.returncode != 0:
        return []
    tabs: list[BrowserTab] = []
    for raw in result.stdout.decode("utf-8", "replace").splitlines():
        parts = raw.split("||", 3)
        if len(parts) != 4:
            continue
        try:
            tabs.append(BrowserTab(int(parts[0]), int(parts[1]), parts[2], parts[3]))
        except ValueError:
            continue
    return tabs


def open_url_in_browser(profile: BrowserProfile, url: str) -> BrowserTab | None:
    before_ids = {tab.tab_id for tab in browser_tabs(profile.app_name) if tab.tab_id}
    script = f'''
tell application {applescript_string(profile.app_name)}
  activate
  if (count of windows) = 0 then make new window
  tell window 1
    make new tab with properties {{URL:{applescript_string(url)}}}
  end tell
end tell
'''
    result = run(["/usr/bin/osascript", "-e", script], check=False)
    if result.returncode != 0:
        fallback = f'''
tell application {applescript_string(profile.app_name)}
  activate
  open location {applescript_string(url)}
end tell
'''
        fallback_result = run(["/usr/bin/osascript", "-e", fallback], check=False)
        if fallback_result.returncode != 0:
            err = fallback_result.stderr.decode("utf-8", "replace").strip() or result.stderr.decode("utf-8", "replace").strip()
            raise RuntimeError(f"Could not navigate {profile.app_name} to {url}: {err}")
    expected = urllib.parse.urlparse(url).path.rstrip("/")
    deadline = time.time() + 12
    while time.time() < deadline:
        current = active_tab_url(profile.app_name)
        if urllib.parse.urlparse(current).path.rstrip("/") == expected:
            time.sleep(3.0)
            after = browser_tabs(profile.app_name)
            matching = [tab for tab in after if same_url_path(tab.url, url)]
            new_matching = [tab for tab in matching if tab.tab_id and tab.tab_id not in before_ids]
            return new_matching[-1] if new_matching else None
        time.sleep(0.4)
    raise RuntimeError(f"{profile.app_name} did not navigate to target URL. Expected {url}; active tab is {active_tab_url(profile.app_name) or 'unknown'}")


def close_browser_tab(profile: BrowserProfile, tab: BrowserTab) -> None:
    current = next((item for item in browser_tabs(profile.app_name) if item.tab_id == tab.tab_id), None)
    if not current:
        raise RuntimeError("target tab is no longer present")
    if not same_url_path(current.url, tab.url):
        raise RuntimeError(f"target tab URL changed from {tab.url} to {current.url}")
    script = f'''
tell application {applescript_string(profile.app_name)}
  repeat with w in windows
    repeat with t in tabs of w
      if (id of t as text) is {applescript_string(tab.tab_id)} then
        close t
        return "closed"
      end if
    end repeat
  end repeat
  return "not_found"
end tell
'''
    result = run(["/usr/bin/osascript", "-e", script], check=False)
    output = result.stdout.decode("utf-8", "replace").strip()
    if result.returncode != 0 or output != "closed":
        err = result.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(err or output or "could not close target tab")


def send_shortcut(mode: str, app_name: str) -> None:
    if mode == "quick":
        script = f'''
tell application "{app_name}" to activate
delay 0.3
tell application "System Events"
  keystroke "o" using {{option down, shift down}}
end tell
'''
    elif mode == "popup":
        script = f'''
tell application "{app_name}" to activate
delay 0.3
tell application "System Events"
  keystroke "o" using {{command down, shift down}}
  delay 1.0
  key code 36
end tell
'''
    else:
        raise ValueError("mode must be quick or popup")
    result = run(["/usr/bin/osascript", "-e", script], check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", "replace").strip())


def wait_for_new_note(vault: Path, before: dict[Path, float], timeout: float) -> Path:
    deadline = time.time() + timeout
    while time.time() < deadline:
        after = markdown_files(vault)
        candidates = [path for path, mtime in after.items() if path not in before or mtime > before.get(path, 0) + 0.01]
        if candidates:
            return max(candidates, key=lambda p: p.stat().st_mtime)
        time.sleep(0.5)
    raise RuntimeError("Could not locate a new/modified Obsidian note after Web Clipper ran.")


def upsert_frontmatter(content: str, metadata: dict[str, Any]) -> str:
    lines = content.splitlines()
    if lines and lines[0].strip() == "---":
        end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
        if end:
            fm = lines[1:end]
            body = lines[end:]
        else:
            fm = []
            body = ["---", *lines[1:]]
    else:
        fm = []
        body = ["", *lines]

    remove_keys = {f"{key}:" for key in metadata}
    kept = [line for line in fm if line.split("#", 1)[0].strip().split(" ", 1)[0] not in remove_keys]
    additions = []
    for key, value in metadata.items():
        if isinstance(value, (int, float)):
            additions.append(f"{key}: {value}")
        else:
            additions.append(f"{key}: {json.dumps(str(value), ensure_ascii=False)}")
    return "\n".join(["---", *kept, *additions, *body]).rstrip() + "\n"


def split_frontmatter(content: str) -> tuple[str, str]:
    lines = content.splitlines()
    if lines and lines[0].strip() == "---":
        end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
        if end:
            return "\n".join(lines[: end + 1]), "\n".join(lines[end + 1 :])
    return "", content


def frontmatter_value(content: str, key: str) -> str:
    frontmatter, _ = split_frontmatter(content)
    if not frontmatter:
        return ""
    for line in frontmatter.splitlines()[1:]:
        if line.startswith(f"{key}:"):
            value = line.split(":", 1)[1].strip()
            if len(value) >= 2 and value[0] == value[-1] == '"':
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    return value.strip('"')
            return value
    return ""


def same_url_path(left: str, right: str) -> bool:
    l = urllib.parse.urlparse(left)
    r = urllib.parse.urlparse(right)
    return l.netloc.lower().removeprefix("www.") == r.netloc.lower().removeprefix("www.") and l.path.rstrip("/") == r.path.rstrip("/")


def article_path_ids(url: str) -> set[str]:
    path = urllib.parse.urlparse(url).path.strip("/")
    match = re.fullmatch(r"(?:i/article|[^/]+/article)/(\d+)", path)
    return {match.group(1)} if match else set()


def source_matches_candidate(source: str, candidate: Candidate) -> bool:
    if same_url_path(source, candidate.clip_url):
        return True
    if candidate.clip_kind != "article":
        return False
    source_ids = article_path_ids(source)
    expected_ids = article_path_ids(candidate.clip_url) | {candidate.tweet_id}
    return bool(source_ids & expected_ids)


def quarantine_note(vault: Path, account: Account, note: Path, reason: str) -> Path:
    quarantine = vault / safe_path_part(account.display_name) / "_clipper_failed"
    quarantine.mkdir(parents=True, exist_ok=True)
    dest = quarantine / f"{reason}-{note.name}"
    index = 2
    while dest.exists():
        dest = quarantine / f"{reason}-{note.stem} {index}{note.suffix}"
        index += 1
    shutil.move(str(note), str(dest))
    return dest


def text_anchor(text: str) -> str:
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= 18:
        return text
    return text[:18]


def clean_x_web_clipper_noise(content: str, candidate: Candidate) -> str:
    if candidate.clip_kind != "tweet":
        return content

    frontmatter, body = split_frontmatter(content.replace("\r\n", "\n"))
    cut_markers = [
        "发布你的回复",
        "\n## 发现更多",
        "\n## 当前趋势",
        "\n## 有什么新鲜事",
        "\n## 相关用户",
        "\n源自于整个 X",
    ]
    positions = [body.find(marker) for marker in cut_markers if body.find(marker) >= 0]
    if positions:
        body = body[: min(positions)]

    anchor = text_anchor(candidate.text)
    if anchor:
        lines = body.splitlines()
        anchor_line = next((i for i, line in enumerate(lines) if anchor in re.sub(r"\s+", " ", line)), None)
        if anchor_line and anchor_line > 0:
            body = "\n".join(lines[anchor_line:])

    cleaned_lines: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if stripped in {"## 帖子", "## 对话", "# 帖子", "# 对话", "帖子", "对话"}:
            continue
        if re.fullmatch(r"点击\s+订阅\s+到\s+\S+", stripped):
            continue
        if stripped.startswith("[查看引用]("):
            continue
        cleaned_lines.append(line.rstrip())

    cleaned_body = "\n".join(cleaned_lines).strip()
    cleaned_body = re.sub(r"\n{3,}", "\n\n", cleaned_body)
    if len(cleaned_body) < 20:
        return content
    if frontmatter:
        return f"{frontmatter}\n{cleaned_body}\n"
    return f"{cleaned_body}\n"


def postprocess_note(vault: Path, note: Path, candidate: Candidate) -> Path:
    content = note.read_text(encoding="utf-8", errors="replace")
    clipped_source = frontmatter_value(content, "source")
    if clipped_source and not source_matches_candidate(clipped_source, candidate):
        quarantined = quarantine_note(vault, candidate.account, note, "wrong-source")
        raise RuntimeError(f"Web Clipper saved the wrong page. Expected {candidate.clip_url}; clipped {clipped_source}. Quarantined: {quarantined.relative_to(vault)}")

    dest_dir = vault / safe_path_part(candidate.account.display_name)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / note.name
    if note.resolve() != dest.resolve():
        stem, suffix = dest.stem, dest.suffix
        index = 2
        while dest.exists():
            dest = dest_dir / f"{stem} {index}{suffix}"
            index += 1
        shutil.move(str(note), str(dest))

    content = clean_x_web_clipper_noise(dest.read_text(encoding="utf-8", errors="replace"), candidate)
    updated = upsert_frontmatter(
        content,
        {
            "tweet_id": candidate.tweet_id,
            "views": candidate.views,
            "original_tweet_url": candidate.tweet_url,
            "clipped_url": candidate.clip_url,
            "clip_kind": candidate.clip_kind,
            "author": candidate.account.display_name,
            "handle": candidate.account.handle,
            "x_published": candidate.created_at.isoformat(),
            "x_likes": candidate.likes,
            "x_retweets": candidate.retweets,
            "x_replies": candidate.replies,
        },
    )
    dest.write_text(updated, encoding="utf-8")
    return dest


def trigger_web_clipper(profile: BrowserProfile, vault: Path, url: str, mode: str, timeout: float) -> tuple[Path, BrowserTab | None]:
    target_tab = open_url_in_browser(profile, url)
    before = markdown_files(vault)
    if mode in ("quick", "popup"):
        send_shortcut(mode, profile.app_name)
        return wait_for_new_note(vault, before, timeout), target_tab
    if mode == "auto":
        errors: list[str] = []
        for actual_mode in ("popup", "quick"):
            try:
                send_shortcut(actual_mode, profile.app_name)
                return wait_for_new_note(vault, before, timeout), target_tab
            except Exception as exc:
                errors.append(f"{actual_mode}: {exc}")
                before = markdown_files(vault)
        raise RuntimeError("; ".join(errors))
    raise ValueError("--clip-mode must be quick, popup, or auto")


def collect_candidates(client: XClient, accounts: list[Account], threshold: int, days: int, max_pages: int, api_delay: float) -> tuple[list[Candidate], list[dict[str, Any]]]:
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    candidates: list[Candidate] = []
    summaries: list[dict[str, Any]] = []
    for account in accounts:
        print(f"\n== {account.display_name} (@{account.handle}) ==", flush=True)
        summary = {"account": account.display_name, "handle": account.handle, "pages": 0, "recognized": 0, "matched": 0, "skipped_unreadable": 0, "skipped_old": 0, "failed": 0}
        summaries.append(summary)
        try:
            user_id = client.user_id(account.handle)
            cursor = None
            seen_ids: set[str] = set()
            stop_for_age = False
            for _ in range(max_pages):
                data = client.user_tweets_page(user_id, account.handle, cursor=cursor, count=40)
                summary["pages"] += 1
                tweets: list[dict[str, Any]] = []
                walk_tweets(data, tweets)
                for tweet in tweets:
                    tid = tweet.get("rest_id")
                    legacy = tweet.get("legacy", {})
                    if not tid or tid in seen_ids:
                        continue
                    seen_ids.add(tid)
                    if tweet_author_handle(tweet).lower() != account.handle.lower():
                        continue
                    created_raw = legacy.get("created_at")
                    views_raw = tweet.get("views", {}).get("count")
                    if not created_raw or not views_raw:
                        summary["skipped_unreadable"] += 1
                        continue
                    created = parse_created_at(created_raw)
                    if created < cutoff:
                        summary["skipped_old"] += 1
                        stop_for_age = True
                        continue
                    summary["recognized"] += 1
                    views = int(views_raw)
                    if views <= threshold:
                        continue
                    tweet_url = f"https://x.com/{account.handle}/status/{tid}"
                    article = article_url(tweet)
                    candidates.append(
                        Candidate(
                            account=account,
                            tweet_id=tid,
                            tweet_url=tweet_url,
                            clip_url=article or tweet_url,
                            clip_kind="article" if article else "tweet",
                            created_at=created,
                            text=legacy.get("full_text") or legacy.get("text") or "",
                            views=views,
                            likes=int(legacy.get("favorite_count") or 0),
                            retweets=int(legacy.get("retweet_count") or 0),
                            replies=int(legacy.get("reply_count") or 0),
                        )
                    )
                    summary["matched"] += 1
                    print(f"  match {views:>8} views  {article or tweet_url}", flush=True)
                cursor = bottom_cursor(data)
                if stop_for_age or not cursor:
                    break
                time.sleep(api_delay)
        except Exception as exc:
            summary["failed"] += 1
            print(f"  account failed: {exc}", flush=True)
    return candidates, summaries


def sort_candidates(candidates: list[Candidate]) -> list[Candidate]:
    return sorted(candidates, key=lambda item: (item.views, item.created_at), reverse=True)


def unprocessed_candidate_count(candidates: list[Candidate], processed: dict[str, Any]) -> int:
    return sum(1 for candidate in candidates if candidate.tweet_id not in processed)


def main() -> int:
    parser = argparse.ArgumentParser(description="Find high-view X posts and save them with Obsidian Web Clipper.")
    parser.add_argument("--browser", choices=["chrome", "dia"], default="dia")
    parser.add_argument("--profile", default=None, help="Chrome default is Default; Dia default is Profile 1.")
    parser.add_argument("--accounts-file", type=Path)
    parser.add_argument("--accounts-text")
    parser.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD)
    parser.add_argument("--allow-low-view-save", action="store_true", help="Allow save mode below the default 90000 view threshold. Use only when the user explicitly requested a lower threshold.")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS)
    parser.add_argument("--save", action="store_true", help="Trigger Web Clipper and modify the Obsidian vault. Omit for dry-run.")
    parser.add_argument("--save-required", action="store_true", help="Fail fast unless --save is also provided. Use for Obsidian-import tasks to prevent export/dry-run-only completion.")
    parser.add_argument("--clip-mode", choices=["quick", "popup", "auto"], default="popup")
    parser.add_argument("--max-pages", type=int, default=25)
    parser.add_argument("--auto-expand-days", type=int, default=0, help="If fewer candidates than requested are found, retry with this larger day window while keeping the same view threshold.")
    parser.add_argument("--auto-expand-max-pages", type=int, default=80, help="Max pages to use during --auto-expand-days retry.")
    parser.add_argument("--limit-saves", type=int, default=0)
    parser.add_argument("--api-delay", type=float, default=1.2)
    parser.add_argument("--clip-timeout", type=float, default=20.0)
    close_group = parser.add_mutually_exclusive_group()
    close_group.add_argument("--close-after-save", dest="close_after_save", action="store_true", default=True, help="Close the script-opened X tab after a verified successful save.")
    close_group.add_argument("--no-close-after-save", dest="close_after_save", action="store_false", help="Keep the X tab open after saving for debugging.")
    parser.add_argument("--state", type=Path, default=Path.cwd() / "work/x_to_obsidian_state.json")
    parser.add_argument("--report", type=Path, default=Path.cwd() / "outputs/x_to_obsidian_report.csv")
    parser.add_argument("--preflight", action="store_true", help="Only validate environment; do not fetch or save.")
    parser.add_argument("--setup", action="store_true", help="Run setup guidance. Opens the Web Clipper install page if the extension is missing; does not fetch X or write Obsidian.")
    parser.add_argument("--open-web-clipper-install", action="store_true", help="Open the official Obsidian Web Clipper install page in the selected browser and exit.")
    args = parser.parse_args()

    if args.save_required and not args.save:
        raise RuntimeError(
            "--save-required was provided without --save. This is an Obsidian import task; "
            "dry-run/export output is only a preview and must not be treated as completion."
        )
    if args.save and args.threshold < DEFAULT_THRESHOLD and not args.allow_low_view_save:
        raise RuntimeError(
            f"Refusing to save with --threshold {args.threshold}, which is below the default "
            f"{DEFAULT_THRESHOLD}. Do not relax the view threshold automatically. If the user "
            "explicitly requested this lower threshold, rerun with --allow-low-view-save."
        )

    if platform.system() != "Darwin":
        raise RuntimeError("v1 supports macOS only.")
    default_profile = "Profile 1" if args.browser == "dia" else "Default"
    profile = browser_profile(args.browser, args.profile or default_profile)
    if args.open_web_clipper_install:
        print(f"Opening install page in {profile.app_name}: {WEB_CLIPPER_INSTALL_URL}", flush=True)
        open_web_clipper_install_page(profile)
        return 0
    if args.setup:
        return run_setup(profile)
    print(f"Browser: {profile.browser} / {profile.profile}", flush=True)
    check_web_clipper(profile)
    vault = read_obsidian_vault()
    print(f"Obsidian vault: {vault}", flush=True)
    cookie, ct0 = cookie_header(profile)
    print("X login cookies: ok", flush=True)
    if args.save or args.preflight:
        check_automation_permission()
        print("System automation permission: ok", flush=True)
    if args.preflight:
        return 0

    accounts = load_accounts(args.accounts_file, args.accounts_text)
    if not accounts:
        raise RuntimeError("No accounts parsed.")
    print(f"Accounts: {len(accounts)}", flush=True)

    bearer, operations = load_x_frontend(cookie)
    client = XClient(cookie, ct0, bearer, operations)
    state = load_state(args.state)
    processed = state.setdefault("processed", {})
    candidates, summaries = collect_candidates(client, accounts, args.threshold, args.days, args.max_pages, args.api_delay)
    candidates = sort_candidates(candidates)
    target_candidates = args.limit_saves if args.limit_saves > 0 else 1
    if (
        args.auto_expand_days
        and args.auto_expand_days > args.days
        and unprocessed_candidate_count(candidates, processed) < target_candidates
    ):
        expanded_pages = max(args.max_pages, args.auto_expand_max_pages)
        print(
            "\nNot enough candidates above the current view threshold; expanding only "
            f"the time/page window to {args.auto_expand_days} days and {expanded_pages} pages. "
            f"Threshold remains > {args.threshold}.",
            flush=True,
        )
        candidates, summaries = collect_candidates(
            client,
            accounts,
            args.threshold,
            args.auto_expand_days,
            expanded_pages,
            args.api_delay,
        )
        candidates = sort_candidates(candidates)

    run_at = dt.datetime.now(dt.timezone.utc).isoformat()
    report_rows: list[dict[str, Any]] = []
    saved = 0
    attempts = 0

    for candidate in candidates:
        status = "dry_run_match"
        note_path = ""
        message = ""
        if candidate.tweet_id in processed:
            status = "already_processed"
            note_path = processed[candidate.tweet_id].get("note_path", "")
        elif args.save:
            attempts += 1
            try:
                new_note, target_tab = trigger_web_clipper(profile, vault, candidate.clip_url, args.clip_mode, args.clip_timeout)
                final_note = postprocess_note(vault, new_note, candidate)
                note_path = str(final_note.relative_to(vault))
                processed[candidate.tweet_id] = {
                    "account": candidate.account.display_name,
                    "handle": candidate.account.handle,
                    "views": candidate.views,
                    "tweet_url": candidate.tweet_url,
                    "clip_url": candidate.clip_url,
                    "clip_kind": candidate.clip_kind,
                    "note_path": note_path,
                    "saved_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                }
                save_state(args.state, state)
                status = "saved"
                saved += 1
                print(f"  saved {candidate.views:>8} views  {note_path}", flush=True)
                if args.close_after_save:
                    if target_tab:
                        try:
                            close_browser_tab(profile, target_tab)
                            print(f"  closed target tab  {candidate.clip_url}", flush=True)
                        except Exception as exc:
                            message = f"close_after_save_failed: {exc}"
                            print(f"  warning {candidate.tweet_url}: {message}", flush=True)
                    else:
                        message = "close_after_save_skipped: no dedicated target tab was detected"
                        print(f"  warning {candidate.tweet_url}: {message}", flush=True)
            except Exception as exc:
                status = "failed"
                message = str(exc)
                print(f"  failed {candidate.tweet_url}: {message}", flush=True)

        report_rows.append(
            {
                "run_at": run_at,
                "account": candidate.account.display_name,
                "handle": candidate.account.handle,
                "tweet_id": candidate.tweet_id,
                "views": candidate.views,
                "created_at": candidate.created_at.isoformat(),
                "tweet_url": candidate.tweet_url,
                "clip_url": candidate.clip_url,
                "clip_kind": candidate.clip_kind,
                "status": status,
                "note_path": note_path,
                "message": message,
            }
        )
        if args.limit_saves and (saved >= args.limit_saves or (args.save and attempts >= args.limit_saves)):
            break

    state.setdefault("runs", []).append({"run_at": run_at, "save": args.save, "summaries": summaries})
    save_state(args.state, state)
    append_report(args.report, report_rows)
    print("\nSummary", flush=True)
    print(json.dumps(summaries, ensure_ascii=False, indent=2), flush=True)
    print(f"Candidates: {len(candidates)}; saved: {saved}", flush=True)
    print(f"Report: {args.report}", flush=True)
    print(f"State: {args.state}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
