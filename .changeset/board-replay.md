---
"@neta-art/cohub": minor
"@neta-art/cohub-cli": minor
---

Board edit history is now replayable. `createBoardReplayPlayer()` (SDK) turns a Board's transaction log into render documents — it rewinds through the server-computed inverses and plays forward through payloads, handling version gaps and paging in both directions — and `cohub boards transactions <board>` (CLI, alias `history`) pages through the same log. The API exposes `GET /spaces/:id/boards/:boardId/transactions`, which returns newest-first pages read under one repeatable-read snapshot with the current rows as the replay anchor. Read-only: nothing is ever written to the Board. In the web workspace, "Replay history" opens a private read-only stage with a scrubber, play/pause, speed control, step, camera follow and live tail appends.
