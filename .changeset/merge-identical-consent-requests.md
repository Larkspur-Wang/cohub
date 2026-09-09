---
"@neta-art/cohub": patch
---

The App consent dialog now merges identical authorization requests. When an App calls `auth.request()` again with the same scopes and target while the dialog is still open — for example on every context update — the new request joins the open dialog and receives the same answer, instead of dismissing it with a spurious denial and opening a fresh one. Requests for a different consent still replace the dialog as before.
