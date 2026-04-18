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
| `AGENT_WS_BASE_URL` | `ws://cohub-agent.cohub.svc.cluster.local:8788` | sandbox 连接 agent 的内部 WS 基地址 |
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
- `cohub-sandbox`：按 space 动态创建的 Pod
- sandbox 通过 `AGENT_WS_BASE_URL` 主动连接 agent
- agent 在 sandbox 建连后主动执行 `workspace.prepare`
- `space_sandboxes.status=ready` 由 agent 在 prepare 成功后上报

### 建议的内部地址

| 环境 | Agent WS 基地址 |
| --- | --- |
| dev | `ws://cohub-agent-dev.cohub-dev.svc.cluster.local:8788` |
| prod | `ws://cohub-agent.cohub.svc.cluster.local:8788` |

### Sandbox Pod 约定

- 挂载 `/workspace`
- 不挂载 `/sessions`
- 注入：
  - `SANDBOX_WS_URL=${AGENT_WS_BASE_URL}/sandbox`
  - `WORKSPACE_DIR=/workspace`
  - `SPACE_REPO_URL`
  - `SPACE_GIT_USERNAME`
  - `SPACE_GIT_EMAIL`

---

如需我补充 ACK Helm values / Ingress 示例或 CI/CD pipeline，也可以直接告诉我。
