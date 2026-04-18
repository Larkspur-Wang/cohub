# Cohub Sandbox (Go)

内部 sandbox 执行器，通过单一 WebSocket 主动连接 agent。

## 当前已实现

- `sandbox.hello`
- `sandbox.heartbeat`
- `workspace.prepare`
- `fs.read`
- `fs.write`
- `fs.stat`
- `fs.ls`
- `fs.find`
- `fs.grep`
- `process.start`
- `process.abort`

## 目录结构

```txt
apps/sandbox/
  main.go
  go.mod
  env/
  process/
  protocol/
  rpc/
  workspace/
  ws/
```

## 本地开发与验证

### 本地检查

```bash
cd apps/sandbox
gofmt -w .
go vet ./...
go test ./...
go build ./...
```

### 1. 启动 agent

```bash
cd apps/agent
SANDBOX_WS_HOST=0.0.0.0 \
SANDBOX_WS_PORT=8788 \
pnpm dev
```

默认监听：`ws://0.0.0.0:8788/sandbox`

### 2. 启动 sandbox

```bash
cd apps/sandbox
SANDBOX_WS_URL=ws://127.0.0.1:8788/sandbox \
SPACE_ID=00000000-0000-0000-0000-000000000001 \
SANDBOX_ID=sandbox-dev \
WORKSPACE_DIR=/tmp/cohub-sandbox-workspace \
go run .
```

## Docker 构建

在项目根目录执行：

```bash
docker build -f apps/sandbox/Dockerfile -t cohub-sandbox:latest apps/sandbox
```

当前运行时基础环境参考现有 agent 镜像，保留了较完整的工具链，包括：

- node
- pnpm
- typescript / tsx
- git / curl / jq
- ripgrep / fd / file
- python / pip / venv
- ffmpeg / imagemagick / exiftool
- vim / tmux / htop / tree
- build-essential / strace / lsof
- fonts-noto-cjk
- bun

## CI

已新增 GitHub Actions：

- `.github/workflows/sandbox-docker-build-push.yml`

包含：

- `gofmt`
- `go vet`
- `go test`
- `go build`
- Docker build & push
