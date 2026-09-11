---
"@neta-art/cohub-cli": minor
---

Show pricing in `cohub models ls` and `cohub models show`.

- `models ls` prints each LLM's per-million-token cost, e.g. `$3 /M input · $15 /M output · $0.30 /M cache read`.
- `models ls --model-type multimodal` and `models show` render a compact unit price such as `$0.04 / image` or `$0.10–$0.50 / second · resolution`.
- `models ls --model-type multimodal --json` now includes the raw `pricing` object for machines.
- `models ls` now hides models marked `hidden` (matching the web picker) for both human and `--json` output, and omits providers left with no visible models.
