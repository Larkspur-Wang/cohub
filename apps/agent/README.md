# Agent Runtime Supervisor (@netaverses/agent)

这是 Netaverses 的 Sandbox 守护进程（Supervisor）。它主要负责在隔离容器中启动并管理 `pi-coding-agent`，并通过 Redis Streams 与主后端 `apps/api` 进行双向流式交互（基于 RPC 模式）。

## 目录结构

- `src/index.ts`: 守护进程核心入口，负责处理 Redis I/O，并以子进程方式运行 `pi --mode rpc`。
- `Dockerfile`: 构建用于 K8s Sandbox 隔离环境运行的轻量级镜像。

## 镜像与环境设计

为了优化镜像体积与启动速度，我们放弃了庞大的官方 Playwright 镜像，改为**从零构建的轻量级方案**：
1. **基础镜像**：基于 `node:20-bookworm-slim`。
2. **按需依赖**：手动安装了 Python 3 运行环境以及运行无头浏览器必需的底层系统依赖（用于支持 Agent 的 Browser Skill）。
3. **浏览器精简**：仅通过 Playwright 安装了 **Chromium**，舍弃了 Firefox 和 WebKit，大幅缩减了镜像体积。

## 核心流控机制 (Redis Streams)

守护进程通过 Redis Streams 与 API 服务通信，解决网络闪断和负载均衡状态同步问题：
- `session:{id}:in`：监听来自用户的输入指令（如 `prompt`, `abort`, `rpc`）。
- `session:{id}:out`：将 Agent 的所有事件（如 `message_update`, `agent_end`, `stdout`, `stderr`）实时写回，供后端 API 消费并推送给前端。

## 镜像构建与本地测试

### 1. 准备 Pi Agent
如果你要在镜像里集成开发中的 `pi-coding-agent`（来自 `~/repositories/pi-mono`）：
- **方式 A（本地打包）**：在 `pi-mono` 下执行 `npm pack`，将生成的 `.tgz` 放到本目录，并在 `Dockerfile` 里替换为本地安装。
- **方式 B（外挂目录）**：开发期可以通过 K8s/Docker 的 hostPath 把本机的包直接挂载进去。
- **方式 C（正式发布）**：当包发布到 npm 后，`Dockerfile` 默认会执行 `npm install -g @mariozechner/pi-coding-agent`。

### 2. 执行构建
在**项目根目录**下运行以下命令构建 Sandbox 镜像：
```bash
docker build -f apps/agent/Dockerfile -t netaverses-agent:latest .
```

### 3. 本地 Redis 测试运行
你可以通过本地运行 Redis 来单独测试这个 Sandbox 容器：
```bash
# 启动本地 Redis
docker run -p 6379:6379 -d redis:7

# 准备一个测试工作区
mkdir -p test-workspace

# 运行 Sandbox 镜像
docker run --rm -it \
  -e REDIS_URL="redis://host.docker.internal:6379" \
  -e SESSION_ID="test-001" \
  -v $(pwd)/test-workspace:/workspace \
  netaverses-agent:latest
```
*(注：Linux 用户请将 `host.docker.internal` 替换为主机真实的局域网 IP 或 Docker 网关 IP。)*
