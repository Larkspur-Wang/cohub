---
"@neta-art/cohub": minor
---

Remove `SessionMessagesClient.send()` method and related `SessionSendMessageInput` type. Messages are now sent exclusively through the websocket-based generation stream API.
