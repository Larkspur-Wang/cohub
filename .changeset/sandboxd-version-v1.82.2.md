---
"@neta-art/cohub-cli": patch
---

Bump the pinned `sandboxd` binary version to v1.82.2. This is the first
release whose archives were actually published to the public CDN — the
`publish-cdn` job had been failing on every tag since the managed-download
workflow landed, so the previous pin (v1.80.2) 404'd on download. With this
bump, `sandbox up` resolves a version that exists on the CDN.
