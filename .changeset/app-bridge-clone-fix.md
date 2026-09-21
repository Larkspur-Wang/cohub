---
"@neta-art/cohub": patch
---

Clone the nested invocation context before it is posted over the App bridge, so an invocation that originates in reactive host state no longer makes `postMessage` fail with a data clone error.

在通过 App bridge 发送前深拷贝嵌套的 invocation 上下文，避免来自响应式宿主状态的 invocation 让 `postMessage` 触发数据克隆错误。
