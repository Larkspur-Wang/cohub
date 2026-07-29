---
"web": patch
---

Fix Board preview not playing animations triggered via CLI shared playback.

Shared playback starts immediately when its server timestamp is ahead of the
client clock, while preserving the original snapshot and a stable local render
anchor. Local autoplay keeps its intentional delay behavior.
