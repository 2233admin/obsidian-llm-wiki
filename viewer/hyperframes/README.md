# hyperframes / intro video

Source for `viewer/assets/intro.mp4` (20-second architecture intro shown on the
landing page). This directory is the authoring surface; the rendered `.mp4`
lives in `../assets/` and is committed to the repo as a static asset so Vercel
can serve it without a build step.

## Re-rendering the video

Prerequisites on the author machine (not needed at runtime):

- Node.js >= 22
- FFmpeg on PATH (`scoop install ffmpeg` on Windows)
- Bundled Chromium: `npx hyperframes browser ensure` (one-time)

Then:

```bash
cd viewer/hyperframes
npm install
npm run render                             # MP4 only
ffmpeg -i ../assets/intro.mp4 -c:v libvpx-vp9 -b:v 800k -deadline realtime \
       -cpu-used 4 -y ../assets/intro.webm # WebM fallback
ffmpeg -ss 00:00:02 -i ../assets/intro.mp4 -vframes 1 -q:v 3 -y \
       ../assets/intro.poster.jpg          # poster frame
```

After re-rendering, commit `viewer/assets/intro.mp4`, `viewer/assets/intro.webm`,
and `viewer/assets/intro.poster.jpg` together.

## Composition structure

- `index.html` -- the main composition. Four scenes over 20 seconds:
  - 0-4s: "Your markdown vault" intro, file names materialise.
  - 4-10s: Files resolve into a concept graph; nodes scale in with stagger,
    edges stroke-dashoffset draw.
  - 10-14s: `/vault-librarian` terminal call, query typed character-by-
    character, search pulse propagates along BFS frontier in terracotta.
  - 14-20s: Cited answer card with wikilinks, fades to brand + URL.
- `hyperframes.json` -- project config (registry, asset paths).
- `meta.json` -- project metadata.
- `package.json` -- npm scripts: `render`, `lint`.

## Notes / known warnings

1. `caption_exit_missing_hard_kill` lint warning: fires because of the
   `tl.to(..., { opacity: 0 })` exit tweens. Not relevant to this composition
   (we are not using karaoke word-level tweens) so the warning is ignored.
2. Font mapping: `PingFang SC`, `SF Mono`, `SF Pro Display` are not in
   hyperframes' deterministic font registry. The renderer substitutes defaults
   which look close enough for a 20-second motion piece. To tighten typography,
   add local font files to `assets/fonts/` and `@font-face` them in
   `index.html`.
3. Render parameters: 30fps, standard quality, default encoder. Output is
   ~800 KB for 20s. Higher quality (`-q high`) roughly doubles file size.
