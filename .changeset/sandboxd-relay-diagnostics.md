---
"@neta-art/cohub-cli": patch
---

Bundle `sandboxd` `v2.54.1`, a diagnostics-only follow-up that keeps the same wire protocol: relay data-channel pairing now outlives the runner's dial timeout, sandbox dial failures distinguish a timeout from an explicit rejection, and teardown-time websocket write failures log at debug instead of warn. No new capability is required, so older binaries stay usable through the compatibility readiness/restart path.

内置 `sandboxd` 升级至 `v2.54.1`——保持同一线协议的纯诊断增强：中继数据通道配对不再受运行器拨号超时限制，sandbox 拨号失败可区分超时与显式拒绝，拆除阶段的 websocket 写失败由 warn 降为 debug。不引入新能力，较旧二进制仍走兼容的就绪检查／重启路径。
