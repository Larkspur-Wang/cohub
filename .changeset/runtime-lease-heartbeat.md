---
"@neta-art/cohub-cli": patch
---

Runtime reconnects retake their own lease deterministically (same runtimeId replaces the stale entry instead of waiting out the TTL) and control-plane heartbeats are decoupled from lease I/O, so a slow authorize or Redis renew can never starve the client into a timeout.

Runtime 重连可确定性接管自己的租约（同一 runtimeId 直接替换过期条目而非等待 TTL），控制面心跳与租约 I/O 解耦，慢速 authorize 或 Redis 续租不会再让客户端活活饿到超时。
