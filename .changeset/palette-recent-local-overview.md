---
"@neta-art/cohub": patch
---

Palette: scope the overview-backed default list to the space picker "Recent" tab and order it strictly by personal activity.

- Plain palette default list (no query, no `a:`) and the All / Mine / Pinned tabs return to the pre-overview local derivation: first frame from the same IndexedDB / space-list caches as before, no overview snapshot, no overview refetch, no snapshot-driven re-sort.
- Recent tab keeps the overview path: fresh snapshot applies instantly; a stale snapshot renders a locally synthesized overview with the same ordering semantics instead of the "All"-ordered legacy list that visibly re-sorted once the refetched overview landed.
- Recent ordering drops the pinned-first tier on both the client build and the overview API: spaces are ordered strictly by personal activity time (visits + viewer-authored turns + server participation), so a stale pinned space no longer floats above recently used ones. Pinning still marks the item; the dedicated Pinned tab is unchanged.
- The overview refetch is no longer tied to the palette's search abort signal, which previously cancelled it mid-flight and delayed the correct list by a re-request cycle.
