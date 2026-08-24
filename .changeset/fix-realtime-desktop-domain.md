---
"@neta-art/cohub": patch
---

Align the realtime event domain for desktop commands: introduce a dedicated `desktop` domain in `REALTIME_DOMAINS` (distinct from `ui`) so `DesktopCommandDispatchedEvent` routes correctly, and add a compile-time assertion that every realtime server event carries a valid domain.
