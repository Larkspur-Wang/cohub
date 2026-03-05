# 生产部署最小配置清单（Cloudflare + ACK + Gitea + Hono）


> 适用于「Web 在 Cloudflare Workers、Hono 与 Gitea 在阿里云 ACK」的部署拓扑。

## 1) 生产域名建议（示例）

| 角色 | 示例域名 | 部署位置 | 说明 |
| --- | --- | --- | --- |
| Web | `https://web.netaverses.cc` | Cloudflare Workers | SvelteKit Web + SSR + 同源 `/api/*` 反代 |
| API | `https://api.netaverses.cc` | Alibaba Cloud ACK | Hono BFF（对接鉴权 + Gitea API） |
| Gitea | `https://gitea.netaverses.cc` | Alibaba Cloud ACK | Git Server + 仓库托管 |
| Git SSH | `git.netaverses.cc:22` | Alibaba Cloud ACK | 可选，仅 SSH clone/push 使用 |
| Auth | `https://auth.talesofai.cn` | 现有服务 | 复用已有鉴权服务（示例） |

> 上述域名仅示例，请替换为你们真实域名。

## 2) Cloudflare Workers（apps/web）

### 环境变量（Wrangler / Dashboard）

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `BFF_ORIGIN` | `https://api.netaverses.cc` | 服务器端反代目标（Hono） |
| `VITE_API_BASE_URL` | （留空） | 若留空则走同源 `/api/*`，如需浏览器直连可填写 |

### 关键配置

- `apps/web/wrangler.toml`
  - `main = .svelte-kit/cloudflare/_worker.js`
  - `[assets] directory = .svelte-kit/cloudflare/assets`
  - `[assets] binding = ASSETS`

## 3) Hono BFF（apps/api，ACK）

### 环境变量

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `AUTH_BASE_URL` | `https://auth.talesofai.cn` | 现有鉴权服务 base URL |
| `GITEA_BASE_URL` | `https://gitea.netaverses.cc` | Gitea base URL |
| `GITEA_TOKEN` | `xxx` | 可选：用于访问私有仓库或提高限额 |
| `WEB_ORIGIN` | `https://web.netaverses.cc` | 用于 CORS 允许来源 |
| `TOKEN_COOKIE_NAME` | `x_token` | Cookie 名称（默认 `x_token`） |
| `PORT` | `8787` | 服务端口 |

### 需要保证的行为

- CORS 允许 `WEB_ORIGIN`
- `credentials: true`
- `/api/auth/token` 写入 HttpOnly cookie
- `/api/me` 使用 cookie / header 校验

## 4) Gitea（ACK）

### 关键配置建议

- `ROOT_URL`: `https://gitea.netaverses.cc`
- `DOMAIN`: `gitea.netaverses.cc`
- `SSH_DOMAIN`: `git.netaverses.cc`
- `START_SSH_SERVER: true`
- 数据库、Redis、对象存储按实际资源配置


> 如需与主站统一登录，可后续在 Gitea 侧配置 OIDC / OAuth 或反向代理鉴权（不在本期范围）。

## 5) 证书 / Ingress

- 建议使用 Ingress + TLS 终端统一对外暴露：
  - `gitea.netaverses.cc`
  - `api.netaverses.cc`
- Cloudflare 侧可做全站 HTTPS 强制。

---

如需我补充 ACK Helm values / Ingress 示例或 CI/CD pipeline，也可以直接告诉我。
