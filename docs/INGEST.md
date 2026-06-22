# Ingest preflight: OPENCLI + media/transcribe toolchain

LLMwiki is not a platform scraper. It is the local Markdown knowledge layer after capture.

The core contract is intentionally small:

```text
link -> ingest.link.preflight -> OPENCLI or the media/transcribe toolchain -> Markdown in vault -> LLMwiki search / summarize / cite / review
```

## Entrypoints

| Entrypoint | Best for | Required output |
|---|---|---|
| `OPENCLI` | Web pages, articles, OpenCLI + BBX/browser-assisted captures, X, WeChat Official Account, Xiaohongshu, generic web pages. | Markdown note in the vault with source URL and capture metadata. |
| `MEDIA_TRANSCRIBE` | Audio/video parsing, download, subtitles, transcription, YouTube, Bilibili, Douyin, Xiaohongshu video notes, podcasts, direct media files. | Transcript Markdown note in the vault with media URL, source URL, parser/download provenance, and transcription provenance. |

Configure commands with:

```bash
VAULT_MIND_OPENCLI_CMD=opencli
VAULT_MIND_MEDIA_CMD=media-transcribe
```

Fallback env names:

```bash
OPENCLI_CMD=opencli
MEDIA_TRANSCRIBE_CMD=media-transcribe
```


## Default dependency boundary

The default path is `OpenCLI + BBX/browser bridge`. OpenTabs is not required for normal users.

OpenTabs can be useful for advanced MCP-native browser/plugin orchestration, but LLMwiki should not assume it is installed. If a workflow can be done through OpenCLI plus the user's logged-in browser bridge, prefer that route.
## MCP tools

### `ingest.providers`

Lists the two supported local ingest providers, their configured command, env vars, purpose, and Markdown output contract.

### `ingest.link.preflight`

Classifies one absolute URL and returns:

| Field | Meaning |
|---|---|
| `platform` | Detected source family, such as `youtube`, `bilibili`, `x`, `wechat-official-account`, or `generic-web`. |
| `provider` | Primary routed local entrypoint: `OPENCLI` or `MEDIA_TRANSCRIBE`. |`r`n| `pipeline` | Ordered local steps when one source needs both browser/page resolving and media parse/download/transcription. Douyin and Xiaohongshu video notes commonly return `OPENCLI -> MEDIA_TRANSCRIBE`. |
| `status` | `ready`, `needs_provider`, `needs_browser_or_login`, or `manual_required`. |
| `can_auto_ingest` | True only when LLMwiki believes the local provider is configured and the platform does not obviously need manual/browser fallback. |
| `needs` | Concrete dependencies or access conditions. |
| `limitations` | Access-control and reliability caveats. |
| `next_action` | The next honest action for the agent. |

Example:

```json
{
  "url": "https://www.youtube.com/watch?v=abc123",
  "platform": "youtube",
  "provider": {
    "id": "media",
    "name": "MEDIA_TRANSCRIBE",
    "configured": true
  },
  "status": "ready",
  "can_auto_ingest": true,
  "next_action": "Run MEDIA_TRANSCRIBE via the configured media command; once Markdown lands in the vault, use query.unified for cited analysis."
}
```

## Platform routing

| Source | Default route | Notes |
|---|---|---|
| YouTube | `MEDIA_TRANSCRIBE` | Good target when subtitles or transcription are available. Login-gated videos may need cookies. |`r`n| Bilibili | `MEDIA_TRANSCRIBE` | Parser/download/transcription route; subtitles/cookies may matter. |`r`n| TikTok | `OPENCLI -> MEDIA_TRANSCRIBE` | Resolve short links/page state with browser bridge, then parse/download/transcribe media. |
| Podcasts / direct audio | `MEDIA_TRANSCRIBE` | Best when provider can resolve episode audio or direct media URL. |
| Bilibili | `MEDIA_TRANSCRIBE` | Often feasible, but cookies/subtitles may matter. |
| Douyin | `MEDIA_TRANSCRIBE` | Needs video URL parsing/download before transcription; browser/login/manual fallback is normal. |
| X / Twitter | `OPENCLI` | Public posts and browser-assisted capture work better than pretending API-free scraping is reliable. |`r`n| Weibo | `OPENCLI` + optional `MEDIA_TRANSCRIBE` | Text/social capture first; video posts may need parser/download/transcription. |`r`n| Zhihu | `OPENCLI` | Article/question/answer capture; browser fallback for folded or login-gated answers. |
| WeChat Official Account | `OPENCLI` | Public articles are text-first; blocked/private pages need browser fallback. |
| Xiaohongshu | `OPENCLI` + optional `MEDIA_TRANSCRIBE` | Browser-assisted capture is the honest default; video notes may need parser/download/transcription through the reference toolchain. |
| Generic web | `OPENCLI` | Normal web/article capture route. |

## Success rule

Do not claim "the link was analyzed" just because preflight succeeded.

The success condition is:

1. `OPENCLI` or `MEDIA_TRANSCRIBE` produced Markdown.
2. The Markdown is inside the configured vault.
3. `vault.search` or `query.unified` can find it.
4. LLMwiki answers cite the local Markdown, not the remote platform.

Legacy env aliases VAULT_MIND_OPENTTPE_CMD and OPENTTPE_CMD are accepted for compatibility with earlier drafts, but new docs use the neutral media/transcribe name.

## Source Registry handoff

`ingest.link.preflight` is read-only planning. `source.register` is the durable registration step. It stores the source in `_llmwiki/source-registry.json`, creates a Source Note in `00-Inbox/Sources/<platform>/` or `10-Projects/<project>/sources/<platform>/`, and embeds the preflight result for review.

This keeps platform analysis honest: registering a Douyin, Bilibili, YouTube, X, Xiaohongshu, WeChat, podcast, or vault note source is not the same as claiming the capture/transcript exists. The ingest succeeds only after a provider writes Markdown back into the vault and search can find it.
