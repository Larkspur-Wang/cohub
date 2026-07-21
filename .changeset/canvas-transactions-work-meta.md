---
"@neta-art/cohub": minor
"@neta-art/cohub-cli": minor
---

Expose structured canvas transaction conflicts and richer published Work metadata through the Cohub SDK and CLI dependency bundle.

- Export `CanvasTransactionError` with status, code, and `isVersionConflict` so clients can rebase and retry rejected canvas transactions.
- Add `lang` and `themeColor` to published Work metadata types.
