# Changelog

## v1.1.1 (2026-04-26)

### Bug Fixes

- **observability**: ensure OTel instrumentation runs before modules are loaded
- **agent**: set anchorUserMessageId in stream_update events

### Refactoring

- **web**: move mobile session rename action sheet to global layout

## v1.1.0 (2026-04-26)

### Features

- **session**: add inline rename support
- **api**: add space usage endpoint with auth and permission check
- **api**: add layered prompt templates support
- **web**: reconcile session state after websocket reconnect

### Bug Fixes

- **api**: change access routes from PUT to PATCH for partial updates
- **packages**: correct GitHub repository URLs to talesofai/cohub

### Refactoring

- **api**: remove unused space field from GET /sessions/:id/messages
- **api**: optimize space sessions list endpoint with batch permission filtering
- rename role 'maker' to 'builder' across the codebase

## v0.10.1 (2026-04-26)

### Bug Fixes

- **api**: strip correct sentinel row in message pagination
- mount usage route under /api/spaces/:id/usage

## v0.10.0 (2026-04-25)

### Features

- **agent**: recover stale processing messages on startup; improve gateway node lifecycle
- **api**: add space usage endpoint with auth, permission check, and error handling
- always show scroll-to-bottom button, clean up dead scroll state

### Bug Fixes

- **api**: propagate actor user id in web session prompts
- restore scroll-to-bottom affordance off bottom
- **api**: eliminate N+1 query risks across multiple endpoints
- **agent**: prevent stale websocket connections from leaking in sandbox client
- **web**: reset tool blocks when next preview starts
- improve session scroll restoration stability and bottom CTA positioning
- correct user attribution in message persistence and trending spaces

### Refactoring

- **agent**: extract assistant stream state into dedicated immutable state machine
- **api**: remove unused space field from GET /sessions/:id/messages
- simplify scroll-to-bottom button with unread state

### Performance

- **web**: skip unnecessary message fetch for new sessions

### Chores

- remove attachment-layout-analysis debug document
