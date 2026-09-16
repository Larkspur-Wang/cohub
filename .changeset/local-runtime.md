---
"@neta-art/cohub-cli": major
"@neta-art/cohub": minor
---

Add local Runtime support: `cohub runtime up|status` connects a local workspace and
dispatches turns to local Pi or Codex Harnesses. Sessions, turns, messages, streaming
and resumption stay on the existing Cohub pipeline, and disconnections reconcile
automatically.

The previous `cohub sandbox up|status` commands are removed; use `cohub runtime` instead.
