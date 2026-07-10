---
"@neta-art/cohub": minor
"@neta-art/cohub-cli": patch
---

Add raw space LLM completions that skip the agent turn queue. Callers fully control message history and an optional space-relative system prompt file.

SDK: `space.completion()` (JSON) and `space.streamCompletion()` (SSE deltas with abort-safe streaming).
CLI: `cohub completion` / `cohub spaces completion` with `--stream`, `--system-prompt`, model/provider, temperature, max tokens, and thinking level.
