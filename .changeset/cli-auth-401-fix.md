---
"@neta-art/cohub-cli": patch
---

Clear full auth session on 401 responses instead of only the device code, preventing stale tokens from causing repeated auth failures.
