---
"@neta-art/cohub": patch
"@neta-art/cohub-cli": patch
---

Recover WebSocket sessions from a transient authentication failure by forcing one access-token refresh, reconnecting once, and restoring room subscriptions without entering an infinite retry loop.
