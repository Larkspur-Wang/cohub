# @neta-art/cohub-board

## 0.2.0

### Minor Changes

- 7140fbe: Add board image export, shared between the web editor and the CLI.

  The board renderers, geometry and codec now live in a new `@neta-art/cohub-board`
  package, so the same PixiJS card renderers draw a board on screen and in a
  headless Node export. `cohub boards export <board> -o out.png` renders a board id
  or `.board` path, with `--frame`, `--items` and `--rect` regions, `--scale`,
  `--theme`, `--background transparent` and PNG/JPEG/WebP output. In the editor,
  Shift+Cmd/Ctrl+E (or the context menu) opens an export dialog that can download
  or copy the image, reusing the live renderer and the current theme.

  Two rendering fixes came out of this: non-Latin text (CJK) rendered as
  missing-glyph boxes because the renderers asked for a Latin-only font with no
  fallback, and shape label colors in the hard-coded fallback palette had drifted
  from the CSS tokens, making note text dark-on-dark wherever the CSS was not
  available.

- fd41a7f: Render cached video first-frame previews on boards while preserving lightweight placeholders at far zoom levels.

### Patch Changes

- 7135f11: Add rotation-aware selection geometry and semantic resize capability helpers.
