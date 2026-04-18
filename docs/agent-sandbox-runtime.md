# Agent / Sandbox 运行说明

本文档描述当前长期方案下的运行方式、环境变量，以及本地联调方式。

## 当前架构

- `apps/agent`
  - 控制面
  - 运行 `pi-coding-agent`
  - 管理 session / Redis / persistence
  - 作为 WebSocket 客户端主动连接 sandbox
  - 将 tools 调用通过 WebSocket RPC 转发给 sandbox
- `apps/sandbox`
  - 执行面
  - 提供 WebSocket server 等待 agent 连接
  - 执行 workspace / fs / process primitive

## 当前 transport 模式

当前系统只保留一种模式：

- `apps/sandbox` 提供 WebSocket server（默认监听 `0.0.0.0:8788`）
- `apps/agent` 作为客户端主动连接 sandbox
- sandbox 连接建立后先发送 `sandbox.hello`，agent 回复 `sandbox.hello_ack`
- agent 主动调用 `workspace.prepare`
- 所有 tools 都通过 WebSocket RPC 转发给 sandbox

## 关键环境变量

### Agent

- `LOCAL_SANDBOX_SPACE_ID` — 本地调试时指定 sandbox 的 space ID
- `LOCAL_SANDBOX_WS_URL` — 本地调试时 sandbox 的 WebSocket 地址（如 `ws://127.0.0.1:8788/sandbox`）
- `SPACE_ID`
- `REDIS_URL`
- `SPACE_DIR`
- `SESSIONS_DIR`
- `ENV`
- `WORKER_SECRET`

### Sandbox

- `SANDBOX_WS_HOST=0.0.0.0`
- `SANDBOX_WS_PORT=8788`
- `SPACE_ID`
- `SANDBOX_ID`
- `WORKSPACE_DIR`
- `HEARTBEAT_INTERVAL_SECS`
- `SPACE_REPO_URL`
- `SPACE_GIT_USERNAME`
- `SPACE_GIT_EMAIL`
- `IMAGE_VERSION`

## 本地联调

### 启动 sandbox（服务端）

```bash
cd apps/sandbox
SANDBOX_WS_HOST=0.0.0.0 \
SANDBOX_WS_PORT=8788 \
SPACE_ID=00000000-0000-0000-0000-000000000001 \
SANDBOX_ID=sandbox-dev \
WORKSPACE_DIR=/tmp/cohub-sandbox-workspace \
go run .
```

默认监听：`ws://0.0.0.0:8788/sandbox`

### 启动 agent（客户端）

```bash
cd apps/agent
LOCAL_SANDBOX_SPACE_ID=00000000-0000-0000-0000-000000000001 \
LOCAL_SANDBOX_WS_URL=ws://127.0.0.1:8788/sandbox \
pnpm dev
```

## 当前 remote tools 覆盖面

- `read` -> `fs.read`
- `write` -> `fs.write`
- `edit` -> agent 侧 diff + remote read/write
- `bash` -> `process.start` / `process.abort`
- `ls` -> `fs.stat` + `fs.ls`
- `find` -> `fs.stat` + `fs.find`
- `grep` -> `fs.grep`

## 当前状态语义

1. API 先上报 `provisioning`
2. 创建 sandbox Pod，sandbox 启动 WS server
3. agent 作为客户端主动连接 sandbox
4. sandbox 发送 `sandbox.hello`，agent 回复 `sandbox.hello_ack`
5. agent 主动调用 `workspace.prepare`
6. prepare 成功后再上报 `ready`

## 当前限制 / 后续事项

- 目前 active sandbox connection 还是单连接模型
- API / deployment 层仍需补 agent Deployment / Service 的最终定义
- `space_sandboxes` 的 status / heartbeat / endpoint 还需要进一步整理
