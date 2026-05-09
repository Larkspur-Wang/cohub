---
"@neta-art/cohub-protocol": minor
"@neta-art/cohub": minor
"@neta-art/cohub-cli": minor
---

feat: unified space prompt scheduling, session patch stream isolation, and SDK/CLI improvements

- Add unified space prompt scheduling with `CreateSpacePromptInput` and `clientMessageId` support
- Add `getSessionTurnPatchStreamKey()` to isolate session patch streams by message
- Add `sourceMessageId` and `messageOrdinal` fields to `SessionTurnPatchEvent`
- SDK: add spaces API, update tasks/cron-jobs APIs, extend types, simplify websocket stream logic
- CLI: add spaces commands, update cron-jobs/tasks commands
- Clean up stale `.d.ts`/`.js` artifacts from protocol source directory
