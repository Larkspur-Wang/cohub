---
"@neta-art/cohub": major
---

Rename the Work vocabulary to App/Desktop across the SDK, and make the App wire surface canonical.

**Breaking changes**

- Realtime App events and `/api/apps` responses now always speak the canonical App vocabulary (`app` / `apps` / `appScopes` / `appId`). Consumers of the legacy realtime `workId` / `workScopes` / `work` field names must read the canonical fields from now on.
- `client.desktop` (DesktopCommandsApi) and `client.apps` (AppsApi) are the canonical accessors; the work-era `client.ui` and `client.works` accessors are retained as deprecated aliases.
- Published App records and version records expose `app` / `apps` / `appScopes` / `appId`; the deprecated `Work*` type aliases now describe these canonical fields (a one-time field rename for consumers that read the raw wire shape).

**Compatibility**

- The legacy wire surface stays available for existing consumers: `/api/works*` REST mounts, `/api/ui/commands`, `/w/` public URLs and asset keys, and `work://` refs are preserved until the next breaking version.
- The embedded App runtime bridge accepts both `cohub.app.*` and the legacy `cohub.work.*` messages and replies on the matching namespace, so older published Works keep working without a rebuild.
- App session JWTs keep the legacy `workScopes` claim alongside the canonical `appScopes`.
