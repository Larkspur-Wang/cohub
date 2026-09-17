---
"@neta-art/cohub": patch
"@neta-art/cohub-cli": patch
---

**Event-driven local Runtime recovery.** Recovery is Session-scoped and triggered by real
events: the local Runtime reports pending executions in bounded batches after connecting,
Gateway peer disconnects and transport uncertainty enqueue reconciliation for that Session,
and only the affected Chat exposes stop confirmation. Realtime and channel notifications are
best effort; committed messages and terminal turns stay authoritative. `runtime.hello` drops
`pendingExecutions`, `RuntimeStatus` drops the Space-wide `recovery` / `canManage` fields, and
`confirmRuntimeStopped(sessionId, …)` requests `expectedTurnId`. The local Runtime was never
live, so these type changes ship as a patch.

**事件驱动的本地 Runtime 恢复。** 恢复改为 Session 粒度并由真实事件触发：本地 Runtime 连接后
分批上报待恢复执行，Gateway peer 断开与传输结果不确定都会为该 Session 入队协调，仅受影响的
Chat 暴露停止确认。实时与渠道通知降级为 best effort，已提交的消息与终态 turn 仍是权威数据。
`runtime.hello` 移除 `pendingExecutions`，`RuntimeStatus` 移除 Space 级 `recovery` / `canManage`，
`confirmRuntimeStopped(sessionId, …)` 需要 `expectedTurnId`。本地 Runtime 从未上线，因此这些类型
变更为 patch。
