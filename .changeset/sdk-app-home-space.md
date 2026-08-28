---
"@neta-art/cohub": minor
---

App runtime context now exposes the hosting Space as `app.homeSpace` (id and name), so chat backgrounds and apps can theme against the Space they run in. The top-level `space` field is deprecated in favor of `app.homeSpace`, and the legacy `work` projection stays stable as App context gains fields.
