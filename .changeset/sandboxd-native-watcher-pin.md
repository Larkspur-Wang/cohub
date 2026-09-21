---
"@neta-art/cohub-cli": patch
---

Pin the bundled sandboxd to `v2.53.1`, the first published release with the native FSEvents file-monitoring backends and the `runtimeId` control frame, so `cohub runtime up` no longer runs the stale `v1.82.4` daemon that exhausted file descriptors on macOS.

把内置 sandboxd 固定到 `v2.53.1`——首个包含原生 FSEvents 文件监听后端与 `runtimeId` 控制帧的已发布版本，避免 `cohub runtime up` 继续运行会在 macOS 上耗尽文件描述符的旧版 `v1.82.4`。
