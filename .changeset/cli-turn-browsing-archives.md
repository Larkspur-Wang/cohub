---
"@neta-art/cohub-cli": minor
---

Turn browsing now matches the Web session view:

- `spaces turns ls --session <sessionId>` lists full turns from one session (the same endpoint the Web session view uses), with `--cursor <sequence>` and `--direction older|newer` pagination.
- New `spaces turns intermediate <sessionId> <turnId>` command reads a turn's persisted intermediate messages from its CDN archive; `--json` returns the raw archive without reducing its content blocks.
