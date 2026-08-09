---
"@neta-art/cohub": minor
"@neta-art/cohub-cli": minor
---

Add Work previews in the workspace and let an Agent drive them.

Works become a fourth preview domain alongside files, Boards, and ports, so a
published Work can run as a workspace tab (`?preview=work:<workId>`). The Work
detail page gains a **Preview** action beside **New tab**.

`cohub ui preview <work>` shows that preview in the Cohub tab the current chat
started from, and `--call <method>` invokes a method the Work registered with
`client.work.surface.handle()`. Showing is idempotent, so a repeat re-activates the
same tab. Retrying with the same command id re-delivers it, which recovers a
dispatch that never reached the browser; delivery is at-least-once, so callable
methods should be safe to repeat.

Routing uses a new `RequestSource.clientId`, propagated from the browser through
prompts, agent turns, and the Sandbox (`COHUB_SOURCE_CLIENT_ID`). Commands reach
only the acting user's own frontend instance, and a Work exposes nothing beyond the
methods it registers.

A Work can also attach one custom context chip to the Cohub composer with
`client.work.composer.setChip()`. The compact label opens a lightweight full-text
preview, while the original content is preserved in the sent message for the
Agent and timeline.

A Work answers surface calls and sends composer context only to an explicit list
of Cohub app origins (or its own), never a `*.cohub.run` suffix match, so neither
a third-party embedder nor a Work served from a Cohub content subdomain can invoke
another Work's methods or alter the Cohub composer. A result that cannot be
serialized or exceeds the payload cap is rejected with a reason instead of
leaving the caller to time out.
