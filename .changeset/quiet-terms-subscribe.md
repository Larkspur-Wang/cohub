---
"@neta-art/cohub": patch
---

Make `session.subscribeGeneration(...)` keep independent stream reducer state per subscription, preventing cached session clients from sharing generation progress, patch, and intermediate-message state across repeated subscribers.
