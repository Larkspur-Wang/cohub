# 生产部署最小配置清单（Cloudflare + ACK + Gitea + Hono）


> 适用于「Web 在 Cloudflare Workers、Hono 与 Gitea 在阿里云 ACK」的部署拓扑。

## 1) 生产域名建议（示例）

| 角色 | 示例域名 | 部署位置 | 说明 |
| --- | --- | --- | --- |
| Web | `https://cohub.run` | Cloudflare Workers | SvelteKit Web |
| API | `https://api.cohub.run` | Alibaba Cloud ACK | Hono API（对接鉴权 + Gitea API） |
| Gitea | `https://gitea.cohub.run` | Alibaba Cloud ACK | Git Server + 仓库托管 |
| Git SSH | `git.cohub.run:22` | Alibaba Cloud ACK | 可选，仅 SSH clone/push 使用 |
| Auth | `https://auth.talesofai.cn` | 现有服务 | 复用已有鉴权服务（示例） |

> 上述域名仅示例，请替换为你们真实域名。

## 2) Cloudflare Workers（apps/web）

### 构建环境变量

| 变量 | dev 示例 | prod 示例 | 说明 |
| --- | --- | --- | --- |
| `PUBLIC_API_ORIGIN` | `https://api-dev.cohub.run` | `https://api.cohub.run` | 前端构建时注入的 API 基础地址 |

### 关键配置

- `apps/web/wrangler.toml`
  - `main = .svelte-kit/cloudflare/_worker.js`
  - `[assets] directory = .svelte-kit/cloudflare/assets`
  - `[assets] binding = ASSETS`

## 3) Hono API（apps/api，ACK）

### 环境变量

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `AUTH_BASE_URL` | `https://auth.talesofai.cn` | 现有鉴权服务 base URL |
| `GITEA_BASE_URL` | `https://gitea.cohub.run` | Gitea base URL |
| `GITEA_TOKEN` | `xxx` | 可选：用于访问私有仓库或提高限额 |
| `WEB_ORIGIN` | `https://cohub.run` | 用于 CORS 允许来源 |
| `AGENT_WS_BASE_URL` | `http://cohub-agent.cohub.svc.cluster.local:8787` | 内部用，sandbox 回调 API 的基地址 |
| `SANDBOX_IMAGE` | `git.talesofai.com/.../cohub-sandbox:latest` | sandbox 镜像 |
| `TOKEN_COOKIE_NAME` | `x_token` | Cookie 名称（默认 `x_token`） |
| `PORT` | `8787` | 服务端口 |

### 需要保证的行为

- CORS 允许 `WEB_ORIGIN`
- `credentials: true`
- `/api/auth/token` 写入 HttpOnly cookie
- `/api/me` 使用 cookie / header 校验

## 4) Gitea（ACK）

### 关键配置建议

- `ROOT_URL`: `https://gitea.cohub.run`
- `DOMAIN`: `gitea.cohub.run`
- `SSH_DOMAIN`: `git.cohub.run`
- `START_SSH_SERVER: true`
- 数据库、Redis、对象存储按实际资源配置


> 如需与主站统一登录，可后续在 Gitea 侧配置 OIDC / OAuth（不在本期范围）。

## 5) 证书 / Ingress

- 建议使用 Ingress + TLS 终端统一对外暴露：
  - `gitea.cohub.run`
  - `api.cohub.run`
- Cloudflare 侧可做全站 HTTPS 强制。

## 6) Agent / Sandbox（ACK 内部服务）

### 推荐长期形态

- `cohub-agent`：独立 Deployment / Service
- `cohub-sandbox`：按 space 动态创建的 Pod（提供 WS server）
- agent 作为 WS 客户端主动连接 sandbox
- sandbox 连接建立后立即发送首帧 `sandbox.heartbeat`，携带能力与文件系统快照
- workspace 内容初始化统一由 worker 完成
- `space_sandboxes.status` 由 sandbox heartbeat 与控制面共同维护

### 连接模型

```
agent (WS client)  ──connect──>  sandbox pod (WS server)
```

- sandbox Pod 监听 `SANDBOX_WS_HOST:SANDBOX_WS_PORT`（默认 `0.0.0.0:8788`）
- agent 通过 K8s 内部地址 `ws://sandbox-{spaceId}.{namespace}.svc.cluster.local:8788/sandbox` 连接
- 每个 sandbox Pod 配有 headless Service 供 agent 发现

### Sandbox Pod 约定

- 挂载 `/workspace`
- 不挂载 `/sessions`
- 注入：
  - `SANDBOX_WS_HOST=0.0.0.0`
  - `SANDBOX_WS_PORT=8788`
  - `WORKSPACE_DIR=/workspace`
  - `IMAGE_VERSION`

---

如需我补充 ACK Helm values / Ingress 示例或 CI/CD pipeline，也可以直接告诉我。
