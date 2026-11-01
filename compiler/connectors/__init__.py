"""Connectors -- pull external data sources into raw/ as frontmatter markdown.

Each connector module exposes a single entry point:

    fetch(output_dir: Path, **kwargs) -> list[Path]

`fetch` reaches out to one external source, converts whatever it finds into
frontmatter-tagged markdown files (source-type / captured-at / origin --
matching the format used across raw/, e.g.
examples/collab-vault/research-compiler/raw/team-memory-os.md), writes them
under `output_dir`, and returns the list of paths written. The compile
pipeline (compiler/compile.py) then treats those files exactly like any
other hand-authored raw/ note -- connectors are a data-acquisition step that
happens *before* compile.py, not a replacement for it.

Available connectors:
    hackernews   -- Hacker News top stories via the public Firebase API.
                     No credentials required; enabled by default.
    chubby       -- ChubbySkills multi-channel Chinese ingest pack wrapper
                     (upstream chubbyguan/chubbyskills at ~/chubbyskills).
                     The `radar` channel (HN + V2EX + Chinese RSS) runs
                     unattended; other channels are HITL-gated.
    gmail        -- SCAFFOLD. Disabled until GMAIL_OAUTH_TOKEN is configured.
    x            -- SCAFFOLD. Disabled until X_API_BEARER_TOKEN is configured.
    web_search   -- SCAFFOLD. Disabled until TAVILY_API_KEY is configured.

Run a single connector standalone with:
    python -m connectors hackernews
(from the compiler/ directory -- see connectors/__main__.py)

Scheduled operation: `python scheduler.py --connectors` sweeps every source
configured in the `connectors:` block of vault-mind.yaml on its own
interval (see vault-mind.example.yaml), records last-run state, and exits.

See connectors/base.py for the shared Connector protocol and markdown writer.
"""
