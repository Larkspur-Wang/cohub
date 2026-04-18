# Cohub Agent Control Service (@cohub/agent)

这是 Cohub 的 Agent 控制服务。它负责运行 `pi-coding-agent`、管理 session、处理 Redis I/O，并主动连接 sandbox 提供的 WebSocket server。

## 目录结构

- `src/index.ts`: Agent 主入口，负责 Redis 输入输出、session 生命周期和 agent runtime
- `src/sandbox/ws-client.ts`: sandbox WebSocket client
- `src/sandbox/tools.ts`: remote sandbox tools 适配层
- `Dockerfile`: Agent 镜像

## 运行方式

当前 `apps/agent` 只有一种运行方式：

- sandbox 启动 ws server
- agent 主动连接 sandbox
- agent 主动调用 `workspace.prepare`
- 所有 tools 都通过 ws rpc 转发给 sandbox

```bash
# 开发
cd apps/agent
SANDBOX_WS_URL=ws://127.0.0.1:8788/sandbox pnpm dev

# 构建
pnpm build

# 类型检查
pnpm typecheck

# 运行构建产物
pnpm start
```

## Redis 流控机制

Agent 通过 Redis 与 API 服务通信：
- 输入队列：`spaces:{id}:input_queue`
- 处理中队列：`spaces:{id}:processing_queue`
- 死信队列：`spaces:{id}:dead_letter_queue`
- 输出流：`spaces:{id}:output_stream`
- 元信息：`spaces:{id}:meta`

## 镜像构建

在项目根目录执行：

```bash
docker build -f apps/agent/Dockerfile -t cohub-agent:latest .
```
