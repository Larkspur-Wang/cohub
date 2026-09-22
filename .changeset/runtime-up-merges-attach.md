---
"@neta-art/cohub-cli": minor
---

Merge `cohub runtime attach` into `runtime up`: native chat sync is now installed by default after one explicit consent (default yes), with all interactive prompts defaulting to yes. `up` is idempotent — an already-enabled configuration is skipped silently, and after `detach` the next `up` asks again — while declining or a capability failure keeps the Runtime running without native sync. `runtime status` now reports native sync enablement (`nativeSync`) and per-Harness pending Turns/archives. The standalone `attach` command is removed.

`cohub runtime attach` 并入 `runtime up`：原生对话同步默认在单独确认一次（默认 yes）后安装，所有交互询问默认 yes。`up` 幂等——已启用则静默跳过，`detach` 后下次再询问；拒绝或能力不满足时 Runtime 照常运行。`runtime status` 新增原生同步开关（`nativeSync`）与各 Harness 的待同步 Turn / 归档明细。移除独立的 `attach` 命令。
