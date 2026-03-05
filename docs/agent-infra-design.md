# Agent 基础设施架构设计方案

基于项目现有的技术栈（阿里云 ACK、Cloudflare、Hono、Svelte、Gitea），为满足**强隔离环境**、**实时长连接交互**以及**文件系统变更同步**的需求，设计的 Agent Infra 架构方案如下。

## 1. 整体架构概览

请求链路：
`User (Browser)` <--> `Cloudflare` <--> `API Gateway (Hono)` <--> `ACK (Kubernetes Cluster)` <--> `Agent Pod`

由于基础设施在阿里云 ACK 上，管理隔离环境最成熟的做法是利用 Kubernetes 的调度能力，结合**阿里云 ECI（弹性容器实例）**来实现强隔离。

## 2. 核心组件设计

### A. Agent 运行环境 (Agent Runtime K8s Pod)

每一个用户启动运行 Agent 时，Hono 后端通过调用 K8s API 动态创建一个独立的 Pod。
为了保证安全和按量计费，建议这个 Pod 调度到 **阿里云 ECI（通过 ACK Serverless / 虚拟节点）** 上。ECI 提供了底层虚拟机级别的强隔离（基于 Kata Containers），非常适合跑不受信的 Agent 代码。

这个 Pod 内采用 **多容器 (Multi-container)** 模式设计：
1. **Init Container (准备阶段)**: 
   - 负责从 Gitea 中 Clone 当前 Workspace 的代码到一个共享的 Volume（如 `emptyDir`）。
2. **Agent Container (业务/模型容器)**: 
   - 实际执行 Agent 逻辑的环境，挂载 Workspace Volume。限制网络出站（按需开放）。
3. **Supervisor Sidecar (监控与通信边车)**: 
   - 一个轻量级的服务（Go 或 Node.js 编写）。
   - **文件监听**：监控 Workspace 目录（基于 `inotify`），将文件的新增、修改、删除事件转化为消息投递出去。
   - **进程守护**：管理 Agent 进程的生命周期，收集 stdout/stderr，接收外部的中断信号。
   - **代理通信**：暴露一个内部 API，允许外部拉取文件内容或向 Agent 发送 Chat 消息。

### B. 长连接与通信网关 (Control Plane)

由于 Cloudflare 对 WebSocket 和 SSE 的支持都很好，推荐使用 **WebSocket** 来维持双向通信。

为了避免网络穿透的复杂性，推荐采用**中心化的消息中枢（如 Redis Pub/Sub 或 NATS）**配合 Hono API：
1. **API 网关 (Hono)** 提供 `/ws/agent/:run_id` 的 WebSocket 接口。
2. Frontend 和 Supervisor Sidecar **同时**连接到 Hono 提供的 WebSocket（或者 Sidecar 把状态推给内部的高速消息队列，Hono 去订阅）。
3. 这样 Hono 就变成了一个“路由器”，负责鉴权，并把用户的 Chat 消息转发给特定 Pod 的 Sidecar，把 Sidecar 的文件变化和 Agent 输出转发给前端。

## 3. 三大核心需求的具体实现路径

### 1. 随时看到 Agent 进度 & 随时发消息 (Chat 通信)
- **协议**：定义一套统一的 JSON over WebSocket 协议，如 `{ "type": "chat", "payload": "..." }`, `{ "type": "status", "payload": "running" }`。
- **Agent 端接入**：
  - 如果 Agent 是可控的 SDK，可以让 Agent 直接与 Sidecar 通信（比如通过 localhost 的 HTTP/WS 或者本地域套接字 IPC）。
  - 如果是任意 Agent，Sidecar 可以拦截其标准输入/输出 (stdin/stdout) 作为消息流。

### 2. 随时看到 Workspace 的变化 (File Sync)
- **增量同步 (推荐)**：
  - Supervisor Sidecar 运行类似 `chokidar` (Node) 或 `fsnotify` (Go) 的库监听挂载的 Workspace 目录。
  - 一旦发生变化，Sidecar 发送 `{ "type": "file_change", "path": "/src/main.ts", "action": "modify" }` 消息。
  - 前端收到后，在虚拟文件树中标记更新。如果用户在前端点击查看该文件，前端通过 HTTP/WS 请求 Hono API -> Sidecar 获取最新文件内容。
- 这样避免了全量传输文件，性能和流量（Cloudflare 带宽）都能控制得很好。

### 3. 隔离环境 (Isolation & Security)
- **计算隔离**：阿里云 ACK + ECI 虚拟节点，每个运行实例独享底层 MicroVM。
- **网络隔离**：配置 K8s `NetworkPolicy`，默认拒绝 Agent Pod 访问云上内网其他服务（如 Gitea 内部 API、数据库），仅允许访问公网（如果 Agent 需要查资料）以及通过特定端口访问 Hono API 的反向通道。
- **存储隔离**：挂载生命周期随 Pod 销毁的 `emptyDir`（如果要持久化保存结果，可以在 Pod 结束前由 Sidecar 执行 `git commit & push` 回 Gitea，或者打包上传到 OSS）。

## 4. 架构实施阶段建议

考虑到复杂性，建议分步骤来：

- **Phase 1 (MVP)**：
  - 用普通的 ACK 节点跑 Docker 容器（暂不上 ECI 以降低初期调试成本）。
  - 暂时不写 Sidecar，直接让 Hono 启动一个 Pod，并通过 K8s API 的 `port-forward` 或 `exec` 机制读取日志和执行命令。
- **Phase 2 (长连接与实时交互)**：
  - 引入 Sidecar 模式和 WebSocket 消息转发层，跑通实时打字机效果和文件树实时变动监听。
- **Phase 3 (生产级安全)**：
  - 接入 ECI，配置严格的 NetworkPolicy，接入 Redis 做 WebSocket 的多实例集群路由。
