# Agent 部署约定（长期方案）

本文档描述 `apps/agent` 在长期架构中的部署角色与约定。

## 角色定位

`apps/agent` 是控制面服务，职责包括：

- 运行 `pi-coding-agent`
- 管理 session / persistence / Redis I/O
- 提供 sandbox WebSocket server
- 将 tool 调用通过 ws rpc 转发给 sandbox
- 在 sandbox 建连后主动执行 `workspace.prepare`
- 在 prepare 成功后上报 `space_sandboxes.status=ready`

## 运行模型

- agent 为独立 Deployment / Service
- sandbox 为按 space 动态创建的 Pod
- sandbox 主动连接 agent
- agent 不再承担 workspace 初始化
- agent 不再挂载 `/workspace`
- session 归 agent，自行管理 `SESSIONS_DIR`

## 推荐命名

### Dev

- Deployment: `cohub-agent-dev`
- Service: `cohub-agent-dev`
- Namespace: `cohub-dev`
- WS Base URL: `ws://cohub-agent-dev.cohub-dev.svc.cluster.local:8788`

### Prod

- Deployment: `cohub-agent`
- Service: `cohub-agent`
- Namespace: `cohub`
- WS Base URL: `ws://cohub-agent.cohub.svc.cluster.local:8788`

## Agent 关键环境变量

- `SPACE_ID`
- `REDIS_URL`
- `SESSIONS_DIR`
- `ENV`
- `WORKER_SECRET`
- `SANDBOX_WS_HOST`
- `SANDBOX_WS_PORT`
- `AGENT_VERSION`

## Sandbox 连接约定

sandbox 通过以下环境变量主动连接 agent：

- `SANDBOX_WS_URL=${AGENT_WS_BASE_URL}/sandbox`

Agent 启动后：

1. 上报 `provisioning`
2. 启动 sandbox ws server
3. 等待 sandbox 建连
4. 调用 `workspace.prepare`
5. prepare 成功后上报 `ready`

## Agent / Sandbox 边界

### Agent

- session
- Redis
- persistence
- tool 编排
- sandbox ws server

### Sandbox

- workspace.prepare
- fs.read / fs.write / fs.stat / fs.ls / fs.find / fs.grep
- process.start / process.abort

## 当前待补项

- agent Deployment / Service 的 K8s 模板
- agent 的 secrets / configmap 规范
- sandbox status / heartbeat 更细粒度更新
