# Changelog

All notable changes to Cohub are documented in this file.

<!-- Generated from apps/web/src/lib/changelog/entries.json. Do not edit. -->

## v1.98 — 2026-07-14

- **Cross-space New chat**: Starting a chat from `/sessions` now stays on the sessions inbox (`/sessions/new?space=…`) with a command-palette space picker, draft chrome, and in-place space switching instead of jumping into a space workspace.
- **Sessions shell architecture**: Shared `sessions/+layout` keeps the inbox page mounted across list, draft, and detail routes so the left list no longer remounts or jumps; draft targets use `newChatSpaceId` so they never fight global sidebar layout prefs.
- **Settings exit navigation**: Entering settings records the prior page, tab switches use `replaceState`, and leave uses `history.back()` (or the last space) so return is one step and no longer drops you on the public home.

### Bug Fixes

- Long turn navigator previews truncate to ~180 chars with a full-text tooltip instead of overflowing the rail and bottom sheet.
- Settings deep links (billing, referrals, channels) preserve the `from` return path across sub-routes.

## v1.97 — 2026-07-14

- **Skill slash commands**: Type `/skill:name` in the composer to expand platform, mod, user, and project skills on send — cataloged in the slash menu with Redis-backed discovery, plus `skills.list` in the SDK and CLI.
- **Workspace motion shell**: Desktop left/right panels and preview columns clip open and closed with shared motion tokens; mobile `/sessions` opens chats with an IM-style view transition, while resize and reduced-motion stay instant.
- **File tree drag-move**: Drag files and folders onto targets in the tree to `fs.move`, with hardened panel hide/collapse so previews stay mounted and interactions remain reliable.
- **Sessions continuity**: Desktop `/sessions` restores the last chat (or newest fallback), re-entry keeps scroll position, and session bootstrap skips double-fetches and no-op turn/presence refreshes.

### Bug Fixes

- Turn rail markers map by document position and chat chrome height so the minimap aligns with the timeline
- Label as picker anchors near its trigger on desktop and uses a safe-area bottom sheet on mobile
- Files column collapsed state persists across reloads; first-press header collapse is reliable
- HTML preview no longer loops createPreviewSession; file preview opens before a URL race can close it
- Sessions composer pins to the bottom; Focus my chats (⌘⇧U) works while typing

## v1.96 — 2026-07-14

- **Main/Files workspace columns**: Space shell splits into independent Main and Files columns with deep-linkable `?preview=` state, unified file/canvas/port tabs, and bi-directional URL sync so chat switches keep the open preview.
- **Shared session-chat module**: Full chat host, generation, scroll, and realtime lifecycle extracted into `features/session-chat` for Space and Sessions—refcounted space rooms, multi-host-safe generation leases, and a slimmer workspace page.
- **Richer turn navigator**: Turn index exposes intent and author profiles; the rail and bottom sheet show compact labels, timestamps, image placeholders, and multi-author names without heavier payloads.
- **Unlimited owned spaces**: Free-plan owned-space quota and entitlement gate removed so any account can create unlimited spaces.
- **Account-scoped work viewers**: `user.space.list` / `user.session.list` / `user.usage.read` still gate on the work grant, but data loads via `asAccountIdentity` so cross-space lists no longer collapse to the Work space.

### Bug Fixes

- Sanitize auth tokens in SDK transport and web client so Safari no longer throws on Authorization headers with CR/LF from corrupted storage.
- Hardened dual-host generation: lease under-release no-ops, stale stream `patchSeq` drops, mid-send draft persistence, and space-switch composer reset.
- Stopped session-chat effect loops freezing mobile UI; drawer pointer-events only while open or dragging.
- Portaled floating menus escape workspace stacking/overflow; preview Focus/Float menu no longer mis-dismisses or anchors at top-left.

## v1.88 — 2026-07-08

- **Sandbox compute specs**: Choose Standard, Boost, or Ultra CPU/memory tiers per space, with plan-gated entitlements, live Kubernetes pod resize (no restart when possible), and full API/CLI/SDK support.
- **Space settings redesign**: Two-pane section navigation, settings-row layout, skeleton loading, and a focused sandbox spec picker for clearer, faster configuration.
- **Work PWA polish**: Dedicated Work icons, maskable assets, and richer web manifest metadata so published Works install more cleanly as progressive apps.
- **Work runtime guide**: New agent-oriented SDK docs that make Work runtime capabilities easier to discover and integrate.
- **Search & Discord reliability**: Faster global search via materialized CTEs and trigram operators; Discord outbound splits preserve fenced code blocks, suppress unintended mentions, and send typing indicators.

### Bug Fixes

- Correct Kubernetes pod resize subresource usage when applying sandbox specs
- Gate higher sandbox specs by billing benefit keys and fall back cleanly when resize cannot apply immediately
- Limit turn search to substring matching to avoid noisy similarity hits

## v1.87 — 2026-07-08

- **Cross-space turn notifications**: When an agent turn finishes in any space, you get a compact in-app toast with space identity, status, duration, step count, and a preview of your prompt — open the turn in the current or a new tab, or dismiss it.
- **Desktop & PWA alerts**: Optional browser notifications fire when the tab is in the background, with a gentle permission prompt and service-worker click handling that focuses or navigates to the finished turn reliably.
- **User-scoped realtime notify channel**: Agent and API emit a new `session.turn.notify` event to the user's personal room on turn finalize, and the SDK exposes `onUserEvent` so clients can subscribe without binding to a single space.
- **Smart suppress & multi-tab presence**: Notifications are suppressed when you are already focused on that session; BroadcastChannel + localStorage presence keeps other tabs quiet if one tab is actively viewing it.

### Bug Fixes

- Browser notification clicks now correctly focus an existing window or open the target session URL via the PWA service worker.
