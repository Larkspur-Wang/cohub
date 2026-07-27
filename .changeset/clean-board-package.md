---
"@neta-art/cohub": minor
"@neta-art/cohub-cli": patch
---

Move the Board document model, renderers, and image exporters into the Cohub SDK, organised by dependency so each entry only carries what it needs:

- `@neta-art/cohub/board` — document schema, geometry, shapes, timeline compilation, and export planning. No PixiJS, so it runs on servers, agents, and edge workers.
- `@neta-art/cohub/board/render` — the PixiJS card renderers, themes, and palette the editor draws with.
- `@neta-art/cohub/board/export` — rendering a planned export to a canvas in the browser.
- `@neta-art/cohub/board/headless` — Node.js image export on `@napi-rs/canvas`.

`pixi.js` and `@napi-rs/canvas` stay optional peers, needed only for the rendering and export entries. Board modules also keep their build boundaries, so consumers tree-shake unused schemas and renderers instead of pulling in the whole model.
