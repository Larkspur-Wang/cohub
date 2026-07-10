---
"@neta-art/cohub": patch
"@neta-art/cohub-cli": patch
---

Record multimodal generation usage against the shared credit balance after successful provider calls. Add `generation.music` usage type, resolve image/video/music kinds for billing gates, and surface post-success `billing` metadata on generation task results.

Also add hourly generation usage stats (mirroring LLM token rollups) so multimodal usage appears in trending and usage endpoints.
