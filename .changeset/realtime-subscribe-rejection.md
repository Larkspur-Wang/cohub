---
"@neta-art/cohub": patch
---

Realtime subscriptions now surface rejected room subscriptions instead of silently receiving nothing. When the gateway rejects the Space room (for example an app session without `space.view`), `session.subscribe()` calls its `error` handler and `space.events.subscribe()` its handler with the `system.subscribe.error` event, so an App can tell the viewer why it is not receiving events.
