---
"@neta-art/cohub": minor
---

**Board connections**: relations between nodes are now first-class entities instead of arrow bindings. Add `spaces.connect()` / `spaces.disconnect()` operations and `spaces.connections()` / `spaces.connectionsForNode()` queries, export the `BoardConnection` type, and resolve geometry live from node frames so connections stay in sync as the layout changes. Shape capabilities rename `canBind` to `canConnect`.
