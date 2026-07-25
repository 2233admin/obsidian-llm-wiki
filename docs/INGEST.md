# Source registration and ingest execution

LLM Wiki is the governed Markdown layer after capture. It does not treat a URL registration, a successful provider probe, or a remote response as durable knowledge.

```text
register -> plan -> run/resume -> inspect/verify -> Evidence Note -> maintenance queue
```

The filesystem-only path is always supported. Optional capture providers improve coverage but are never required to start the MCP server, register a Source, inspect an existing run, or search normal Markdown.

## Supported Source inputs

Phase 1 Source Registration accepts only:

- `url` — the canonical remote identity;
- `vaultPath` — an existing vault-relative file.

`repoPath`, `filePath`, `directoryPath`, and `text` remain reserved and must not be passed to `source.register`. For a local repository, register its canonical URL and cite local inspection artifacts as Evidence.

Registration writes `_llmwiki/source-registry.json` and a Source Note under `00-Inbox/Sources/<platform>/`, or under `10-Projects/<project>/sources/<platform>/` for a Project Source. It does not capture the URL or alter the registered vault note.

## Operations

| Operation | Effect |
|---|---|
| `ingest.providers` | Lists configured capture entrypoints and their Markdown contract. |
| `ingest.link.preflight` | Classifies a URL and reports required access/providers without invoking them. |
| `source.register` | Records the durable Source identity and creates a reviewable Source Note. |
| `source.ingest.plan` | Returns a deterministic, report-only plan and content-bound `planId`. |
| `source.ingest.run` | Executes that exact plan and persists a versioned Ingest Run, immutable artifacts, receipts, and an Evidence Note. |
| `source.ingest.resume` | Continues the first incomplete stage after a failure or expired lease. |
| `source.ingest.inspect` | Reads a run and its immutable receipts without executing providers. |
| `source.ingest.verify` | Re-hashes artifacts and verifies completed stages without writing. |

Always call `source.ingest.plan` immediately before `source.ingest.run`. A stale `planId` is rejected if the Source revision, local file bytes, or capability plan changed.

## Filesystem baseline

For `inputType=vaultPath`, capture reads the registered file from inside the vault. The run normalizes line endings, writes immutable captures and derivatives, materializes a searchable Evidence Note, and enqueues maintenance only when the active normalized digest changed.

State is stored under:

```text
_llmwiki/ingest-runs/v1/       run records and receipts
_llmwiki/ingest-artifacts/v1/  immutable captures and derivatives
_llmwiki/ingest-active/v1/     active digest per Source
00-Inbox/Evidence/             searchable Evidence Notes
_llmwiki/maintenance/          durable maintenance queue and receipts
```

Replaying a successful idempotency key returns the existing run. Unchanged content creates no new maintenance work.

## Optional capture providers

| Entrypoint | Best for | Configuration |
|---|---|---|
| OpenCLI | Pages, articles, browser-assisted capture, X, WeChat, Zhihu, and generic web content. | `VAULT_MIND_OPENCLI_CMD` (legacy `OPENCLI_CMD`). |
| Media/transcribe | Audio/video, subtitles, transcription, podcasts, YouTube, Bilibili, Douyin, and direct media. | `VAULT_MIND_MEDIA_CMD` (legacy `MEDIA_TRANSCRIBE_CMD`). |

OpenCLI is a capture Provider only. It cannot register Sources, write arbitrary vault paths, promote memory, or make knowledge authoritative. Provider output must contain valid text/Markdown plus provider and profile provenance; invalid, empty, oversized, timed-out, or unavailable output produces bounded diagnostics rather than partial authority.

The default browser path is OpenCLI plus a compatible logged-in browser bridge. OpenTabs and platform-specific scrapers are optional.

## Platform preflight

`ingest.link.preflight` returns the detected platform, provider route, status, access needs, limitations, and honest next action. Typical routing is:

| Source | Default route |
|---|---|
| YouTube, Bilibili, podcasts, direct audio/video | Media/transcribe |
| X, WeChat, Zhihu, generic web | OpenCLI |
| Douyin, TikTok, Xiaohongshu video | OpenCLI/browser resolution, then media/transcribe when needed |

Login, cookies, paywalls, deleted content, or anti-bot checks may make a run `needs_access` or `manual_required`. Preflight success is not ingest success.

## Completion rule

An ingest is complete only when:

1. the exact reviewed plan ran successfully;
2. immutable capture and derivative hashes verify;
3. an accepted Evidence Note exists in the vault;
4. maintenance was enqueued only if active content changed;
5. retrieval can cite the local Evidence Note.

Use `settings.agent_wiki.features` to inspect rollout state. `VAULT_MIND_AGENT_WIKI_INGEST=disabled` blocks `run` and `resume` for rollback while leaving `plan`, `inspect`, `verify`, and retained state readable. See [Agent Wiki toolchain](AGENT_WIKI_TOOLCHAIN.md) and [Migration and rollback](MIGRATIONS.md).
