---
"@neta-art/cohub": minor
---

Normalize Board item geometry across semantic authoring and storage:

- Draw points and arrow start/end points are now consistently world-space; authoring items use optional `position`/`size` and the persisted frame is derived automatically.
- Export `computeArrowFrame` (previously internal arrow geometry) so arrow item frames can be computed outside the renderer.
- Share geometry helpers between the API, CLI, and renderers, and fix draw renderer performance by computing geometry once per item.
