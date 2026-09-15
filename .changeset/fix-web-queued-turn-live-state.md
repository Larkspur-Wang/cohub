---
"@neta-art/cohub": patch
---

Queued follow-up turns no longer render (or resume) as running generation. A session's newest unfinished turn can be a queued follow-up waiting behind a running one, so live generation is now resumed only from `running` / `abort_requested` turns: a queued turn stays in the follow-up queue instead of being cloned as the streaming turn, and an empty pending snapshot is never persisted or restored.
