---
"@neta-art/cohub-cli": minor
---

Streamline Board CLI commands:

- Add `boards batch` to apply an atomic batch of semantic Board changes in one round-trip.
- Add `boards connections` (list/get) for managing typed connections between Board items.
- Split effect, composition, animation, and item commands into `list`/`get` subcommands with consistent JSON and table output.
- Remove the low-level `boards nodes` command in favor of the semantic item commands.
- Import board helpers from the public SDK.
