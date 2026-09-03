---
"@neta-art/cohub": minor
---

Turn browsing and intermediate archives in the SDK:

- `session.turns.intermediate.get(turnId)` reads a turn's persisted intermediate messages straight from its CDN archive — resolving the messages object key and signed URLs automatically — and `intermediate.getToolCalls(turnId, message)` returns the matching tool calls, extracting them from message content when no archive object exists.
- Export the archive shapes `TurnIntermediateMessagesFile`, `MessageToolCallsFile`, `StoredIntermediateMessage`, and `StoredToolCall` for typing archive reads.
