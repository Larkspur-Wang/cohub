---
"@neta-art/cohub": patch
---

Space `@` mentions in the composer now share the command palette's space search instead of maintaining a second scorer. An empty query lists recently visited Spaces in the palette's Recent order, and a typed query goes through the same merge (fuzzy text match weighted against viewer tier and recency), so a mention and the palette can no longer disagree about which Space ranks first — and the removed duplicate logic drops the per-keystroke scan over cached session lists.
