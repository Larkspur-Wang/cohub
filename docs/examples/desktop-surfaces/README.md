# Desktop Surfaces — Example Apps

Two example Apps that demonstrate the `overlay` surface role.

## mascot

A character that walks across the screen and reacts to what's happening in the
workspace.  It uses `configure.request` to update its hit region frame by frame,
`cohub.app.requestClose()` to exit when the walk finishes, and several SDK
features at once:

- **Realtime room** — shares a "wave back" presence state with any other viewer
  who has the same overlay open.
- **Composer chip** — tells the agent what the character just said when it speaks.
- **Navigation** — the character can open a file when the agent names one.

```bash
# Publish from a Space that has the file
cohub desktop open app://<username>/<space>/mascot --as overlay
```

## hud

A heads-up display that floats in the corner and shows live agent status,
the current turn's tool calls, and a quick-action bar.  Demonstrates:

- `inputRegion` with explicit `Rect[]` so the workspace stays fully clickable
  outside the HUD panel.
- `cohub.app.surface.handle("hud.ping")` so an agent can push a status
  update into the overlay.
- Auto-dismiss via `requestClose()` when the agent finishes a run.

```bash
cohub desktop open app://<username>/<space>/hud --as overlay
```

## Running locally

Both files are self-contained HTML published as directory Apps.  Publish
`mascot/` or `hud/` as an App in any Space, then open with `--as overlay`.

Requires the Cohub SDK (loaded from `esm.sh` — no build step needed).
