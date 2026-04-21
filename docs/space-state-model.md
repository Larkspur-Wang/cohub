# Space / Sandbox / Bootstrap 状态说明

本文档说明当前长期方案下，space 本体、sandbox 运行时、workspace bootstrap 三者的职责边界与状态语义。

## 设计原则

- `space` 是资源实体，不承担异步流程聚合状态。
- `sandbox` 表示运行环境状态。
- `bootstrap` 表示 workspace / 内容初始化状态。
- `sandbox` 与 `bootstrap` 并行推进，互不阻塞。

## 一、Space

`space` 表示：

- 资源存在
- 归属明确
- 可被访问

当前不再让 `space.status` 承担复杂业务语义。
如需占位，可统一视为 `active`。

## 二、Sandbox

`sandbox` 表示空间运行环境是否可交互。

当前主要状态：

- `pending`
- `provisioning`
- `ready`
- `error`

### 语义

- `ready`：环境可用，可以创建新的 session。
- `error`：环境拉起失败或运行异常。
- `provisioning`：环境正在启动。

### 协议语义

当前 agent / sandbox 长期协议只保留 `sandbox.heartbeat`：

- 首帧 heartbeat：包含 capabilities / filesystem / metadata 快照
- 后续 heartbeat：包含轻量状态更新

不再使用 `sandbox.hello` / `sandbox.hello_ack`。

## 三、Bootstrap

`bootstrap` 表示 workspace 内容初始化状态。

当前挂在：

- `space.meta.bootstrap`

状态：

- `pending`
- `running`
- `ready`
- `failed`

常见 stage：

- `prepare`
- `import`
- `checkpoint_restore`
- `push`
- `finalize`

### 语义

- `ready`：workspace 内容已准备完成。
- `failed`：workspace 初始化失败，但不代表 sandbox 不可用。

## 四、创建流程

创建 space 后：

1. API 创建最小 `space` 记录
2. API 并行触发 sandbox provisioning
3. API 入队 `create_space` worker 任务
4. worker 执行 bootstrap（blank / public repo / checkpoint）
5. 前端进入 `/spaces/:id`，作为状态页 + 详情页

## 五、前端行为

在 `/spaces/:id`：

- 展示 sandbox 状态
- 展示 workspace initialization 状态
- 只要 sandbox `ready`，就允许 `New session`
- bootstrap `ready` 仅表示初始内容准备完成，不阻塞 session 创建

## 六、职责边界

### API

负责：

- 鉴权
- 控制面校验
- 最小 space 落库
- sandbox provisioning
- 任务入队

不负责：

- git clone
- checkpoint restore
- workspace 内容初始化

### Worker

负责：

- repo 创建
- workspace 初始化
- public repo 导入
- checkpoint 恢复
- git commit / push
- bootstrap 状态推进

### Agent

负责：

- session / ownership / persistence
- 连接 sandbox
- 转发 WebSocket RPC
- 同步 sandbox runtime 状态

不负责：

- git clone
- workspace bootstrap

### Sandbox

负责：

- 提供 fs / process 能力
- 上报 sandbox heartbeat
- 保证 workspace 挂载目录可用

不负责：

- git clone
- commit / push
- workspace 内容初始化
