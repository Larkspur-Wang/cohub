---
"@neta-art/cohub": minor
"@neta-art/cohub-cli": minor
---

**App version history and provenance.** Published apps now expose their immutable version history, and every version carries the session it was published from.

- Public app pages gain a Cohub bar version switcher: `?cohub_v=<n>` selects a version, `getBySlug(…, { version })` fetches that version's content, and `listPublicVersions()` returns the history. SSR resolves the requested version; switching is a client-side fetch that keeps the URL shareable.
- `AppVersionRecord.source` and `AppVersionSource` describe provenance (`sessionId`, `turnId`, `turnSequence`, `via`). The raw `meta.source` stamped at publish time is no longer exposed, provenance is validated against the app's own space, and session identity/title is included only when the caller holds `session.view` for the source session — so a private session never leaks through a published app, and viewer-scoped responses are never shared-cached.
- `cohub apps versions` prints a Source column: the source session title when visible, otherwise the publishing channel.
- The public page docks the Cohub bar above the App instead of floating over it, keeps the Cohub wordmark in that bar, and opens a version's source session in a new tab. Version history loads off the public page's critical path, so the first render never waits for it.
