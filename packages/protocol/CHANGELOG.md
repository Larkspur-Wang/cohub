# @neta-art/cohub-protocol

## 1.6.0

### Minor Changes

- Add multimodal generation protocol types, SDK APIs, and CLI commands.

## 1.5.0

### Minor Changes

- c53aaec: Add direct shell command support for session turns, redesign session fork architecture with segment-based turns

## 1.4.0

### Minor Changes

- 341bfc0: Add turn abort/steer reason, continuedByTurnId to turn summary; add turnId/userMessageId to websocket events

## 1.3.0

### Minor Changes

- c688cc5: feat: unified space prompt scheduling, session patch stream isolation, and SDK/CLI improvements

  - Add unified space prompt scheduling with `CreateSpacePromptInput` and `clientMessageId` support
  - Add `getSessionTurnPatchStreamKey()` to isolate session patch streams by message
  - Add `sourceMessageId` and `messageOrdinal` fields to `SessionTurnPatchEvent`
  - SDK: add spaces API, update tasks/cron-jobs APIs, extend types, simplify websocket stream logic
  - CLI: add spaces commands, update cron-jobs/tasks commands
  - Clean up stale `.d.ts`/`.js` artifacts from protocol source directory

## 1.2.3

### Patch Changes

- Release current package updates.

## 1.2.2

### Patch Changes

- a2cb8ff: 现在在刷新会话页面时会自动接续未完成的 stream

## 1.2.1

### Patch Changes

- 66b4ef8: Add lightweight WebSocket compact frames for session patch streaming, with SDK negotiation and decoding support.

## 1.2.0

### Minor Changes

- 0797485: Add environment-aware SDK and CLI defaults for production and development Cohub endpoints, and publish updated protocol filesystem realtime types.
