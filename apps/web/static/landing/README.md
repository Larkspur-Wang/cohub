# Landing assets

Product media for the marketing homepage. Files here are served from
`/landing/<name>` and referenced by `LandingMedia.svelte`.

Until a file exists, the slot renders a labelled placeholder frame — the page
layout is already final, so assets can drop in one at a time without any code
change beyond setting `src`.

## Wiring an asset

In `routes/(public)/+page.svelte`, give the slot its basename:

```svelte
<LandingMedia src="hero" kind="video" ... />
```

`LandingMedia` then resolves:

- video → `/landing/hero.webm`, `/landing/hero.mp4`, poster `/landing/hero.webp`
- image → `/landing/hero.webp`

## Expected files

Listed in page order.

| Basename | Kind | Section | Shows |
| --- | --- | --- | --- |
| `hero` | video | 1 · Hero | Agent edits a file, preview updates |
| `multiplayer` | video | 3 · Same room | A second person picking up the same chat; danmaku drifting past |
| `work` | image | 4 · Live Works | A published Work at its public URL |
| `generation` | image | 6 · Any medium | A generated image returned inline in chat |
| `mobile` | image | 5 · Everywhere | A Space on a phone |
| `channels` | image | 5 · Everywhere | An agent replying in Discord |
| `cli` | image | 5 · Everywhere | `cohub spaces` in a terminal |
| `context` | image | 7 · Context network | `@space` mention and `/skill` in the composer |

Section 8 (Cloud sandbox) is intentionally text-only — a preview screenshot
cannot express isolation, process execution, or long-running jobs, and the
hero already shows the sandbox working.

On mobile, section 5 renders `mobile` only; `channels` and `cli` are desktop
supporting proof.

## Capture rules

- **Light theme.** The homepage is pinned to light so every capture is shot
  once. A dark-mode screenshot will look broken in place.
- **1600px+ wide**, 2x DPR where possible.
- **Real content only** — real names, real files, real output. Placeholder text
  defeats the point of using real UI.
- Images: `.webp`, quality ~82.
- Video: `.webm` (VP9) **and** `.mp4` (H.264) for Safari, silent, clean loop,
  plus a `.webp` poster frame. Hero 15–25s, multiplayer 8–12s.

```bash
# poster frame from a recording
ffmpeg -i hero.mov -vframes 1 -q:v 2 hero.webp

# encode both codecs
ffmpeg -i hero.mov -c:v libvpx-vp9 -crf 34 -b:v 0 -an hero.webm
ffmpeg -i hero.mov -c:v libx264 -crf 22 -pix_fmt yuv420p -an hero.mp4
```

Keep each video under ~3 MB. The homepage is also the authenticated redirect
target, so marketing media must never compete with that path — `LandingMedia`
already lazy-loads and pauses offscreen, but the file size still matters.
