---
"@neta-art/cohub": minor
"@neta-art/cohub-cli": minor
---

Add optional `thinkingLevel` to session prompts, scheduled prompts, channel model config, and space hooks. The level is fully optional — omitted values inherit the session default, matching existing provider/model behavior. UI, CLI, and SDK all support per-model thinking level selection driven by models config (`reasoning`, `defaultThinkingLevel`, `thinkingLevelMap`). Effective thinking level is persisted to turn meta and exposed on turn records for multi-client recovery.
