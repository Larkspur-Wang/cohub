---
"@neta-art/cohub": minor
"@neta-art/cohub-cli": minor
---

Apps can open as an **overlay**: a transparent, chrome-free layer above the Space workspace instead of a preview tab. `cohub desktop open <app> --as overlay` requests it, and a page published with `<meta name="cohub:surface" content="overlay">` opens that way by default. Inside the App, `context.invocation.surface` reads `"overlay"`, and `cohub.app.requestConfigure({ geometry, inputRegion })` controls where the overlay sits and which rectangles accept pointer events — everything else (context, auth, Space APIs, realtime, `surface.handle()` + `--call`, composer chips, navigation, commerce) works as in a tab. Overlays close through `cohub.app.requestClose()` or `Escape` in the workspace.

Republishing now updates page-derived metadata (title, description, icon, image, lang, theme color, surface) when the current value is the one extraction last wrote; values a publisher set by hand that differ from the page are kept.
