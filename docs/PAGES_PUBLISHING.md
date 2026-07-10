# Publishing the wiki as a static web site (Gitea)

This document describes the `main` -> static HTML -> `pages` branch publish
pipeline defined in `.gitea/workflows/publish-wiki.yml`, and what an admin
still has to do by hand to make the result actually browsable.

## What this is

`compiler/html_export/` already knows how to turn a compiled `wiki/`
directory (the `concepts/` and `summaries/` output of `compile.py`) into
static HTML using Pandoc -- see `compiler/html_export/exporter.py`
(`export_to_html()`) and `compiler/compile.py`'s optional `--export-html`
step. Until now that was a manual, local-only step.

`.gitea/workflows/publish-wiki.yml` wires that exporter into Gitea Actions:
on every push to `main` (and via manual "Run workflow"), it

1. checks out the repo,
2. installs Pandoc,
3. runs `python -m html_export.exporter <source> --output public-wiki-html --theme reading`,
4. writes a minimal `index.html` landing page if the source has no
   `_index.md` (see "Known gap" below),
5. force-pushes the `public-wiki-html/` output as the *entire contents* of a
   branch named `pages` (`git init` + `git commit` + `git push -f` into that
   one branch -- it does not touch `main`'s history).

That `pages` branch is the artifact a Gitea Pages-style server is expected
to serve. This workflow does not itself serve anything; see "What you still
have to enable" below.

## What gets published (and why it is safe)

The export source is controlled by the `PUBLIC_WIKI_SOURCE_PATH` env var at
the top of `.gitea/workflows/publish-wiki.yml`:

```yaml
env:
  PUBLIC_WIKI_SOURCE_PATH: "examples/collab-vault/research-compiler/wiki"
```

`examples/collab-vault/` is an in-repo demo vault -- its own README says
explicitly "This directory is an example, not a user vault." The
`research-compiler/wiki/` subfolder is the *already-compiled* wiki shape
(`concepts/`, `summaries/`) that `html_export` expects as input, checked
into the repo alongside the raw source it was compiled from.

**This is demo data, not your real vault.** The workflow only ever reads
paths that are checked into this git repository -- there is no code path
that reaches a local filesystem vault (e.g. a `D:\knowledge`-style path
outside the repo). A guard step in the workflow additionally rejects
absolute paths (`/...`, `C:...`) and `..` path traversal in
`PUBLIC_WIKI_SOURCE_PATH` before exporting, as defense in depth.

To publish a different in-repo example (e.g. `fixtures/vault-iii/...`, if
it is reshaped to have `concepts/`/`summaries/` subdirs), edit that one env
var line. **Never** point it at a real vault path -- doing so would publish
private notes to a world-readable branch.

## Known gap: no `_index.md` in the demo source

`html_export.exporter.export_to_html()` looks for `wiki_dir/_index.md` to
produce the site's `index.html`; none of the example/fixture vaults in this
repo currently ship a `_index.md`. There is also an unused
`_generate_index()` helper already in `exporter.py` that looks like it was
meant to auto-build an index from `concepts/`+`summaries/` but is never
called -- wiring that up properly (matching a theme, listing all pages) is
a real follow-up for `compiler/html_export`, not something this workflow
should improvise.

Until that's fixed upstream, the workflow's own "Ensure a landing page
exists" step writes a minimal fallback `index.html` (plain links to every
exported `concepts/*.html` and `summaries/*.html` page) whenever the
exporter didn't produce one, so the published site always has a working
root page instead of a 404.

## Fixed in this change: asset paths under `concepts/`/`summaries/`

While verifying this pipeline we found `exporter.py`'s injected `<link>`/
`<script>` tags for `css/style.css`, `static/wiki.css`, and `static/wiki.js`
were always written as document-relative paths with no `../` prefix. That
is correct for the root `index.html` but broken for every page under
`concepts/` or `summaries/` (a browser would resolve `css/style.css` from
`concepts/foo.html` as `concepts/css/style.css`, which doesn't exist). This
has been fixed in `exporter.py` (`_run_pandoc`/`_inject_assets` now take an
`asset_prefix` computed from output depth) and verified by serving the
exported output over a local HTTP server and confirming every asset URL a
browser would actually request returns 200.

## What you still have to enable (Gitea admin, manual)

Two things are **not** automated by this workflow and are outside what a
repo-level workflow file can configure:

1. **Actions must be enabled for this repository.** Gitea Actions is
   disabled per-repo by default even when the instance has Actions turned
   on globally. An admin/owner needs to enable it under the repository's
   Settings. The exact menu path and any required runner registration
   depend on your Gitea version and how git.xart.top's runners are set up
   -- check your Gitea instance's own admin/version docs for the precise
   steps rather than trusting a generic description here.

2. **Gitea core has no built-in "Pages" feature** (unlike GitHub Pages).
   Serving a `pages` branch as a static site requires a separate
   companion service pointed at your Gitea instance (the common
   community option is a "Pages Server" that watches each repo's `pages`
   branch and serves its contents, e.g. the project at
   `gitea.com/6543/pages-server` or a similar fork). Whether such a
   service is already deployed for git.xart.top, what domain/path it
   serves this repo's `pages` branch under, and how it's configured
   (per-repo enablement, custom domain file, etc.) is specific to your
   instance -- an admin needs to check what (if anything) is deployed and
   set it up if not. Do not assume a URL like
   `https://<user>.git.xart.top/<repo>/` works until an admin confirms
   the Pages server is actually running and pointed at this repo.

Until both of the above are done by an admin, the workflow will still run
and produce a correct `pages` branch (that part is self-contained and
requires no admin action beyond enabling Actions + granting the built-in
token write access -- see below) -- there just won't be anything serving it
over HTTP yet.

## Auth: the built-in `GITEA_TOKEN`

The publish step uses `${{ secrets.GITEA_TOKEN }}`, the token Gitea Actions
automatically injects into every job (no manual secret setup needed). By
default its permissions depend on the instance's configured token mode
(`permissive` grants read/write to most repo units; `restricted` does not
grant `contents: write`). The workflow declares:

```yaml
permissions:
  contents: write
```

at the top level, which is required for `GITEA_TOKEN` to be allowed to push
the `pages` branch regardless of the instance's default mode. If your
instance runs `restricted` mode and does not honor this override, the
"Publish to pages branch" step will fail on the `git push`; in that case an
admin needs to either switch the repo/instance token mode or provide a
personal access token with `write:repository` scope as a repo secret named
`GITEA_TOKEN` (overriding the built-in one is not possible by that name --
use a different secret name and update the workflow's `env:` block to
match if you need this fallback).

## Manually triggering a publish

Push to `main`, or use Gitea's Actions tab -> "Publish Wiki Pages" ->
"Run workflow" (the workflow also listens for `workflow_dispatch`).

## Local verification (what was actually run, not just designed)

```
python -m html_export.exporter examples/collab-vault/research-compiler/wiki --output <out> --theme reading
```

was run from `compiler/` against this repo's real Pandoc + Python, producing:

```
<out>/index.html            (workflow-style fallback landing page)
<out>/concepts/team-memory-os.html
<out>/summaries/team-memory-os.html
<out>/css/style.css
<out>/static/wiki.css
<out>/static/wiki.js
```

The output was then served with `python -m http.server` and every page and
asset URL (including the `../css/...`, `../static/...` links a browser
resolves from inside `concepts/`/`summaries/`) was checked with `curl` and
returned `200`.
