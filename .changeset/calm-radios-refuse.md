---
"@neta-art/cohub-protocol": patch
"@neta-art/cohub": patch
---

fix: isolate session patch streams by message

Add `getSessionTurnPatchStreamKey()` to derive a deterministic stream key from
turn, message, or session identity, ensuring patch operations are scoped to the
correct stream. Add `sourceMessageId` and `messageOrdinal` fields to
`SessionTurnPatchEvent` for richer patch identity resolution. Clean up stale
`.d.ts` / `.js` artifacts from protocol source directory.

SDK `WebsocketClient` now uses the shared `getSessionTurnPatchStreamKey()`
instead of inline fallback logic. Add `clientMessageId` to
`SessionSendMessageInput` and `CreateSpacePromptInput` for better
client-side message correlation.
