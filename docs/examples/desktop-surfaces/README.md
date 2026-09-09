# Desktop Surfaces — Example Apps

Two example Apps that demonstrate the `overlay` surface role.

## mascot

A character that walks across the screen and reacts to what's happening in the
workspace.  It uses `requestConfigure` to update its hit region frame by frame,
`cohub.app.requestClose()` to exit when the walk finishes, and several SDK
features at once:

- **Realtime room** — shares a "wave back" presence state with any other viewer
  who has the same overlay open.
- **Composer chip** — tells the agent what the character just said when it speaks.
- **Surface method** — an agent can make it speak with `--call mascot.say`.

```bash
cohub desktop open app://<username>/<space>/mascot --as overlay
# Make it say something while it walks
cohub desktop open app://<username>/<space>/mascot --as overlay --call mascot.say --data '{"text":"Ship it!"}'
```

## hud

A heads-up display that floats in the corner and follows the current Chat:
live agent status, the running turn's tool calls, and a quick-action bar.
Demonstrates:

- `geometry` + `inputRegion: "all"` — the overlay shrinks to the panel, so it
  is fully interactive (mouse and touch) while the rest of the workspace stays
  clickable.
- Asking the viewer for `space.view` + `session.view` on the Space they are
  looking at (`cohub.auth.request({ spaceId })`), then subscribing to the
  Chat's realtime stream. Realtime rooms are gated on `space.view`.
- `cohub.app.surface.handle("hud.ping")` so an agent can push a status
  update into the overlay.
- Auto-dismiss via `requestClose()` when the agent finishes a run.

```bash
cohub desktop open app://<username>/<space>/hud --as overlay
# Push a status line from a script or an agent
cohub desktop open app://<username>/<space>/hud --as overlay --call hud.ping --data '{"message":"Deploying…"}'
```

## How an overlay works

An overlay App fills the whole workspace with a transparent, chrome-free
iframe.  By default it receives no pointer events, so the desktop underneath
stays fully usable.  The App claims the parts it wants to be clickable through
`cohub.app.requestConfigure({ inputRegion })`:

- `"none"` (default) — purely decorative, click-through everywhere
- `"all"` — the whole overlay is interactive
- `Rect[]` — only these rectangles, in the overlay's own CSS pixel coordinates

Because the overlay covers the window, overlay coordinates and
`getBoundingClientRect()` inside the App line up one-to-one.

The region only decides where pointer events go; it never clips what the
overlay paints. Decorative parts — bubbles, tooltips, effects — can stay outside
it and remain visible.

Fixed panels (like the HUD) should shrink the overlay with `geometry` and use
`"all"`; rect lists suit things that move across the screen (like the mascot).
Rects activate on hover, so they respond to a mouse but not to the first tap on
a touch screen.

Declare `<meta name="color-scheme" content="light dark">` so the App follows the
host theme. A color-scheme mismatch between the host and the frame makes
Chromium paint an opaque backdrop behind the frame, and the overlay would lose
its transparency.

Keep overlays cheap to composite: no `backdrop-filter` (the content underneath
changes every frame while the agent streams, so a blur never stops re-rendering),
and do per-token work in the realtime handlers only for what actually changed —
the HUD updates its status strip per patch and rebuilds the list only when a tool
call starts or ends.

Overlays have no chrome of their own. An App closes itself with
`cohub.app.requestClose()`; the viewer can always press `Escape` in the
workspace to dismiss every open overlay.

Overlays keep every other App capability: context, authorization, Space APIs,
realtime rooms, `surface.handle()` + `--call`, composer chips (the most
recently set overlay chip is the one shown), navigation and commerce. The one
overlay-only call is `requestConfigure()`; `invocation.surface` reads
`"overlay"` so an App can tell how it was opened.

## Publishing

Each folder is a self-contained directory App. Both declare
`<meta name="cohub:surface" content="overlay">`, which Cohub reads at publish
time into `meta.presentation.surface` — so `cohub desktop open <app>` opens
them as overlays without `--as`. Pass `--as window` to override. The HUD asks
the viewer for access at runtime, so it needs no app-side scopes when
publishing. No build step — the SDK is loaded from `esm.sh`.
