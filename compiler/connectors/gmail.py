"""Gmail connector -- SCAFFOLD, disabled by default.

Same fetch(output_dir, **kwargs) -> list[Path] shape as the other
connectors (see connectors/base.py, connectors/hackernews.py), so it can
be wired into connectors/__main__.py and, later, scheduler.py without any
call-site changes once it's real.

Intended shape (NOT implemented here -- do not assume this works):
    - authenticate to the Gmail API using an OAuth2 token/refresh flow
    - list/search messages (e.g. a saved query or label)
    - write each message as a frontmatter markdown file
      (source-type: gmail, origin: the message's Gmail permalink or id)
    under output_dir.

This module deliberately does NOT call the Gmail API. Building that
requires real OAuth credentials and a decision about which scopes/query
this connector should use, neither of which exist yet. It only checks
for a credential env var and logs; wiring up the real API call is future
work once credentials are actually available.
"""

from __future__ import annotations

import os
from pathlib import Path

# Name is a placeholder -- adjust to whatever the real OAuth integration
# ends up needing (e.g. a refresh token, a service-account json path, ...).
CREDENTIAL_ENV_VAR = "GMAIL_OAUTH_TOKEN"


def fetch(output_dir: Path, **kwargs) -> list[Path]:
    """Would fetch Gmail messages and write them as markdown. Currently a no-op scaffold.

    Never raises. Returns [] until both a credential is configured AND the
    real Gmail API integration is implemented.
    """
    token = os.environ.get(CREDENTIAL_ENV_VAR)
    if not token:
        print(
            f"[gmail] {CREDENTIAL_ENV_VAR} not set -- connector disabled, "
            "skipping (no credentials configured)"
        )
        return []

    print(
        "[gmail] credential env var is set, but this connector is still a "
        "scaffold -- the real Gmail API call has not been implemented. "
        "Skipping rather than fabricating output."
    )
    return []
