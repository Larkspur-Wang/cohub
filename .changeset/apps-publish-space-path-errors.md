---
"@neta-art/cohub-cli": patch
---

Apps publish: explain Space-path targets instead of failing with a bare 404.

- `apps publish` / `apps update` now preflight `--file` / `--dir` targets against the target Space's workspace and fail before publishing with an explicit message, e.g. `"dist" does not exist in the Space workspace (--dir takes a Space workspace path, not a local path).`
- When the publish worker still rejects a target (e.g. removed between check and snapshot), the bare worker error is translated to the same explicit wording.
- Help text and docs now state that `--file` / `--dir` take Space workspace paths, not local paths.
