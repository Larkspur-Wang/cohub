---
"@neta-art/cohub": minor
---

Add app workspace navigation bridge: apps and chat backgrounds can navigate the embedding Cohub workspace via `client.navigation.open(target)` and `appRuntime.navigationOpen(target, call)`. Targets are validated `AppNavigationTarget` payloads from `@cohub/protocol/app-navigation` (a string is accepted as an app ref), responses report `handled` with a `reason` (`unsupported`/`timeout`) when the host cannot navigate, and `PopupBrokerTransport` reports navigation as unsupported.
