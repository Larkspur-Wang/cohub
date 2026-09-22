---
"@neta-art/cohub-cli": patch
"@cohub/gateway": minor
---

Runtime reconnects retake their own lease deterministically (same runtimeId replaces the stale entry instead of waiting out the TTL), control-plane heartbeats are decoupled from lease I/O, relay data-channel pairing outlives the runner dial timeout, and relay dial failures now distinguish timeouts from rejections.

Runtime 重连可确定性接管自己的租约（同一 runtimeId 直接替换过期条目而非等待 TTL），控制面心跳与租约 I/O 解耦，relay 数据通道配对窗口长于 runner 拨号超时，拨号失败日志区分超时与拒绝。
