---
"@neta-art/cohub": patch
---

Palette: scope the overview-backed default list strictly to the space picker "Recent" tab.

- Plain palette default list (no query, no `a:`) and the All / Mine / Pinned tabs return to the pre-overview local derivation: first frame from the same IndexedDB / space-list caches as before, no overview snapshot, no overview refetch, no snapshot-driven re-sort.
- Recent tab keeps the overview path: fresh snapshot applies instantly; a stale snapshot renders a locally synthesized overview (same ordering semantics — pinned, then viewer-authored activity) instead of the "All"-ordered legacy list that visibly re-sorted once the refetched overview landed.
- The overview refetch is no longer tied to the palette's search abort signal, which previously cancelled it mid-flight and delayed the correct list by a re-request cycle.
