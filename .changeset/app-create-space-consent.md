---
"@neta-art/cohub": minor
---

Add `client.auth.requestCreateSpace()` so Apps can create a viewer-owned Space in one consent. The host uses the viewer's account token against the existing create API, then grants the requested scopes on the new Space.
