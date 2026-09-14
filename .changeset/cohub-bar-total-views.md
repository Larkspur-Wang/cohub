---
"@neta-art/cohub": minor
---

Public app detail responses (`AppDetailResponse`) now expose `totalViews`, the app's all-time view count. `by-slug`, `:id/public` and `:id` all return it, so hosts can surface a view count without a separate stats request. It is `null` when the rollup total is temporarily unavailable — a view count never fails a detail response.
