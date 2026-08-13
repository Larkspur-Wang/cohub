---
"@neta-art/cohub-cli": patch
---

Print file modification times as ISO timestamps in `spaces files ls` and `spaces checkpoints ls-tree`, instead of the raw epoch float the API returns (`1786553072104.8674`). Table columns accept an optional `format` mapper, so `--json` output keeps the machine-readable value.
