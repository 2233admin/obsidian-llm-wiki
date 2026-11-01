"""Web-search connector (Tavily) -- SCAFFOLD, disabled by default.

Same fetch(output_dir, **kwargs) -> list[Path] shape as the other
connectors (see connectors/base.py, connectors/hackernews.py), so it can
be wired into connectors/__main__.py and, later, scheduler.py without any
call-site changes once it's real.

Intended shape (NOT implemented here -- do not assume this works):
    - call the Tavily search API with a query (or list of standing
      queries) using an API key
    - write each result as a frontmatter markdown file
      (source-type: web-search, origin: the result's source URL)
    under output_dir.

This module deliberately does NOT call the Tavily API. Building that
requires a real API key and a decision about which query/queries this
connector should run, neither of which exist yet. It only checks for a
credential env var and logs; wiring up the real API call is future work
once credentials are actually available.
"""

from __future__ import annotations

import os
from pathlib import Path

CREDENTIAL_ENV_VAR = "TAVILY_API_KEY"


def fetch(output_dir: Path, **kwargs) -> list[Path]:
    """Would run Tavily web searches and write results as markdown. Currently a no-op scaffold.

    Never raises. Returns [] until both a credential is configured AND the
    real Tavily API integration is implemented.
    """
    api_key = os.environ.get(CREDENTIAL_ENV_VAR)
    if not api_key:
        print(
            f"[web_search] {CREDENTIAL_ENV_VAR} not set -- connector disabled, "
            "skipping (no credentials configured)"
        )
        return []

    print(
        "[web_search] credential env var is set, but this connector is "
        "still a scaffold -- the real Tavily API call has not been "
        "implemented. Skipping rather than fabricating output."
    )
    return []
