---
"@neta-art/cohub": minor
---

`space.create` is now a user-level permission: creating a Space is authorized by holding it rather than by the caller's principal type. `POST /api/spaces` accepts execution tokens again, so `cohub spaces create` works inside a Sandbox; app sessions need a `space.create` viewer grant, preview sessions are denied, and real account sessions are unchanged. Auto-minting the first-time Home space is now an unconditional parameterless system default.
