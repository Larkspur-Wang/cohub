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

## Replacing an asset

The CDN in front of the bucket caches for 30 days and **ignores query
strings**, so overwriting a file in place keeps serving the old bytes. Upload
under a hashed name instead and record it in the `VERSIONS` map in `media.ts`:

```bash
h=$(md5sum generation.webp | cut -c1-8)
cp generation.webp "$PUBLIC_DIR/cohub-landing/generation.$h.webp"
# then set VERSIONS.generation = "<h>" in media.ts
```

Always re-check `ratio` against the new file. The wrapper uses
`object-fit: cover`, so a stale ratio silently crops the capture.

## Current set

Listed in page order.

| Basename | Section | Shows | Source |
| --- | --- | --- | --- |
| `hero` | 1 · Hero | People online, live messages drifting past, forked sessions, file tree | 1440×900 |
| `multiplayer` | 3 · Same room | A second person picking up the same chat | 1200×675 |
| `work` | 4 · Live Works | A published Work at its public URL | 1300×812 |
| `mobile` | 5 · Everywhere | A Space on a phone | 390×844 |
| `generation` | 6 · Any medium | A generated poster returned inline, saved into the Space | 800×730 |
| `context` | 7 · Context network | `@space` mention picker open in the composer | 1290×801 |

`generation` and `context` are shot at narrow viewports (1000px and 430px) at
raised DPR, because both are composer-level detail that has to stay legible in
a half-width column — a 1440px capture scaled into 435px is not.

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
  for sharpness — DPR adds sharpness, it does not change the scale factor.
- **Crop on content edges.** A capture that ends mid-line of text reads as a
  broken image. Measure the element bounds in the page rather than guessing
  offsets.
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
