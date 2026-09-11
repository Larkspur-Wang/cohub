---
"@neta-art/cohub": minor
---

Add a `session.access.manage` permission so builders can share a session. Session-level access (share/unshare) is now authorized by this permission instead of the host-only `member.manage`; space-level access and member management remain host-only. The permission is part of the public permission vocabulary and is not granted to Apps.
