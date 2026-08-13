# Landing media

Product captures for the marketing homepage. The files are **not** in this
repo — they are re-shot whenever the UI moves, and binaries that churn are a
bad fit for git history. They live at the base URL in `media.ts`, and
`LandingMedia.svelte` resolves a basename against it.

To point the page at a different set (a staging bucket, or a self-hosted
mirror for a fork), set `PUBLIC_LANDING_MEDIA_BASE`.

## Wiring an asset

In `routes/(public)/+page.svelte`, give the slot its basename:

```svelte
<LandingMedia src="hero" alt="..." />
```

`landingMediaUrl` then resolves:

- image → `<base>/hero.webp`
- video → `<base>/hero.webm`, `<base>/hero.mp4`, poster `<base>/hero.webp`

Leave `src` unset and the slot renders a labelled placeholder frame, so the
layout holds while an asset is still missing.

## Current set

Listed in page order.

| Basename | Section | Shows |
| --- | --- | --- |
| `hero` | 1 · Hero | People online, live messages drifting past, forked sessions, file tree |
| `multiplayer` | 3 · Same room | A second person picking up the same chat |
| `work` | 4 · Live Works | A published Work at its public URL |
| `mobile` | 5 · Everywhere | A Space on a phone |
| `generation` | 6 · Any medium | A generated image returned inline in chat |
| `context` | 7 · Context network | `@space` mention and `/skill` in the composer |

Two sections deliberately use no capture:

- **5 · Everywhere** pairs the phone capture with the CLI rendered as real text
  (`LandingTerminal.svelte`) rather than a screenshot — it stays sharp at any
  width and reflows on a phone. The copy also mentions Discord and WeChat,
  which are real surfaces; they simply have no capture yet.
- **8 · Cloud sandbox** is text-only. A screenshot cannot express isolation,
  process execution, or long-running jobs.

## Capture rules

- **Light theme.** The homepage is pinned to light, so a dark capture will
  look broken in place.
- **Shoot at the size the slot renders.** A 1440px-wide capture dropped into a
  435px column is unreadable no matter how many pixels it has. Measure the
  slot first, then frame the capture to roughly that CSS width and raise DPR
  for sharpness.
- **Real content only** — real files, real output, real timestamps. If a
  command is shown, it must be a command that actually runs.
- **No third-party data** — no other users' Space names, handles, or emails.
- Images: `.webp`, quality ~82.
- Video: `.webm` (VP9) **and** `.mp4` (H.264) for Safari, silent, clean loop,
  plus a `.webp` poster. Keep it under ~3 MB; the homepage is also the
  authenticated redirect target, so marketing media must never compete with
  that path.

```bash
# poster frame from a recording
ffmpeg -i hero.mov -vframes 1 -q:v 2 hero.webp

# encode both codecs
ffmpeg -i hero.mov -c:v libvpx-vp9 -crf 34 -b:v 0 -an hero.webm
ffmpeg -i hero.mov -c:v libx264 -crf 22 -pix_fmt yuv420p -an hero.mp4
```
