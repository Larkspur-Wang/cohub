---
"@neta-art/cohub": minor
---

**App management for builders.** Apps are governed by a single `app.manage` permission — create, publish versions, change config/status, read stats, delete your own — granted to `host` and `builder` instead of leaning on `space.edit`, so Space builders can run Apps without gaining host-only Space settings. There is no separate `app.publish` atom.

- `app_source` uploads (used by the local CLI / local agent publish path) now require `app.manage`; `space_avatar` stays on `space.edit`.
- App deletion: hosts may delete any App, builders only the Apps they published themselves.
- App detail responses now report the actual `publisher` (App creator); the public Cohub bar credits that identity instead of always showing the Space owner, and the App authorize dialog names that author.
- The App management page shows Edit / Disable / stats / Update version for `app.manage` holders, and Delete only for hosts or the App's publisher.
- The `Permission` union gains `"app.manage"`.
