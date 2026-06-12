---
"web": patch
---

Fix space page stuck in loading by adopting stale-while-revalidate for bootstrap cache

- Start remote `/api/spaces/:id` request immediately instead of blocking on IndexedDB cache reads
- Add 180ms timeout to bootstrap cache reads so slow/hanging IndexedDB never blocks the page
- Guard against stale cache overwriting fresh remote data
- Make session list cache always revalidate against remote even when local cache exists
- Log session list refresh failures instead of silently swallowing errors
