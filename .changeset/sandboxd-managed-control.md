---
"@neta-art/cohub-cli": patch
---

Bundle `sandboxd` `v2.54.0`, the first published runner with the private managed Runtime control pipe, so `cohub runtime up` reads connection lifecycle events straight from the daemon instead of polling the API every five seconds. Older binaries keep working through the compatibility readiness/restart path.

内置 `sandboxd` 升级至 `v2.54.0`——首个带有私有托管 Runtime 控制管道的已发布运行器。`cohub runtime up` 现在直接从守护进程读取连接生命周期事件，不再每五秒轮询 API。较旧的二进制仍走兼容的就绪检查／重启路径。
