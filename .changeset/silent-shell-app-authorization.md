---
"@neta-art/cohub": minor
---

Apps mounted in the trusted Shell can silently authorize its current Space for the approved read-only scopes (`space.view`, `file.view`, `file.view.filtered`, `session.view`, `taskrun.view`, and `checkpoint.view`). The Host decides this by comparing the request against the Space it is showing, so the API keeps its single authorize endpoint and other permission requests stay interactive. Embedded Apps follow the same rule through the Shell hosting them.

挂载在可信 Shell 中的 App 可以针对当前 Space 静默授权指定的只读权限（`space.view`、`file.view`、`file.view.filtered`、`session.view`、`taskrun.view` 和 `checkpoint.view`）。该判断由 Host 通过比对当前展示的 Space 完成，因此 API 保持单一的 authorize 端点，其他权限请求仍使用交互式授权；嵌入 App 由承载它的 Shell 按同一规则处理。
