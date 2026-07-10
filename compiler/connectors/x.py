"""X (Twitter) connector -- SCAFFOLD, disabled by default.

Same fetch(output_dir, **kwargs) -> list[Path] shape as the other
connectors (see connectors/base.py, connectors/hackernews.py), so it can
be wired into connectors/__main__.py and, later, scheduler.py without any
call-site changes once it's real.

Intended shape (NOT implemented here -- do not assume this works):
    - call the X API v2 (e.g. recent search, list timeline, or a saved
      query/bookmark endpoint) using a bearer token
    - write each post as a frontmatter markdown file
      (source-type: x, origin: the post's x.com permalink)
    under output_dir.

This module deliberately does NOT call the X API. Building that requires
a real API bearer token/app and a decision about which query/timeline
this connector should poll, neither of which exist yet. It only checks
for a credential env var and logs; wiring up the real API call is future
work once credentials are actually available.
"""

from __future__ import annotations

import os
from pathlib import Path

# Name is a placeholder -- adjust to whatever the real API integration
# ends up needing.
CREDENTIAL_ENV_VAR = "X_API_BEARER_TOKEN"


def fetch(output_dir: Path, **kwargs) -> list[Path]:
    """Would fetch X posts and write them as markdown. Currently a no-op scaffold.

    Never raises. Returns [] until both a credential is configured AND the
    real X API integration is implemented.
    """
    token = os.environ.get(CREDENTIAL_ENV_VAR)
    if not token:
        print(
            f"[x] {CREDENTIAL_ENV_VAR} not set -- connector disabled, "
            "skipping (no credentials configured)"
        )
        return []

    print(
        "[x] credential env var is set, but this connector is still a "
        "scaffold -- the real X API call has not been implemented. "
        "Skipping rather than fabricating output."
    )
    return []
