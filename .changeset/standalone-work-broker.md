---
"@neta-art/cohub": minor
---

Added support for standalone (non-iframe) work deployments via a new auth broker transport (`PopupBrokerTransport`). Works can now run on their own origin and open a Cohub broker popup for auth, authorization, and purchase — with a ready-handshake and one-shot `window.close()`.

- **New exports**: `PopupBrokerTransport`, `resolveWorkTransport`, `WorkRuntimeModeConfig`.
- **`CohubClientOptions.work`**: configure `mode: "broker" | "bridge"`, `brokerOrigin`, and `workId`. Auto-detection falls back to bridge when in an iframe.
- **Token persistence**: `WorkRuntimeApi` now caches restricted tokens in `localStorage` when a `workId` is provided, surviving page reloads; `forceRefresh` clears the cache.
- **`WorksApi.getPublicById(id)`**: loads a published work's metadata by id without requiring space membership.
- Non-interactive messages (`context`, `checkout-state`) are answered locally in broker mode without opening a popup.
